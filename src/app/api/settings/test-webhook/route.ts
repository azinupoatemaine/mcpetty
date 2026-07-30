import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '../../../../lib/auth'
import { webhookUrlError } from '../../../../lib/webhook-url'

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { url } = await req.json() as { url?: string }
  if (!url?.trim()) return NextResponse.json({ ok: false, error: 'url required' }, { status: 400 })
  const invalid = webhookUrlError(url.trim())
  if (invalid) return NextResponse.json({ ok: false, error: invalid }, { status: 400 })
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
