import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '../../../../lib/auth'

function isBlockedWebhookHost(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl)
    if (hostname === 'localhost' || hostname === '::1') return true
    if (/^127\./.test(hostname)) return true
    if (/^169\.254\./.test(hostname)) return true  // link-local / cloud metadata
    return false
  } catch {
    return true
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { url } = await req.json() as { url?: string }
  if (!url?.trim()) return NextResponse.json({ ok: false, error: 'url required' }, { status: 400 })
  if (isBlockedWebhookHost(url.trim()))
    return NextResponse.json({ ok: false, error: 'Webhook URL points to a blocked host (loopback or link-local)' }, { status: 400 })
  try {
    const res = await fetch(url.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'test', timestamp: new Date().toISOString(), source: 'MCPetty settings test' }),
    })
    return NextResponse.json({ ok: true, status: res.status })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'fetch failed' })
  }
}
