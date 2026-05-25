import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '../../../lib/auth'
import { listNamespaces, createNamespace } from '../../../lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return new NextResponse('Unauthorized', { status: 401 })
  return NextResponse.json(listNamespaces())
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return new NextResponse('Unauthorized', { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const { id, name } = body as { id?: string; name?: string }
  if (!id?.trim() || !name?.trim()) return NextResponse.json({ error: 'id (slug) and name required' }, { status: 400 })
  const slug = id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
  if (!slug) return NextResponse.json({ error: 'Invalid slug — use lowercase letters, numbers, hyphens' }, { status: 400 })
  try {
    const ns = createNamespace(slug, name.trim())
    return NextResponse.json(ns)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to create namespace'
    return NextResponse.json({ error: msg.includes('UNIQUE') ? `Slug "${slug}" already taken` : msg }, { status: 400 })
  }
}
