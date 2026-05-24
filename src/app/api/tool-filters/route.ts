import { NextRequest, NextResponse } from 'next/server'
import { getToolFilters, setToolFilters, clearToolFilters } from '../../../lib/db'
import { isAuthorizedRequest } from '../../../lib/auth'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  return NextResponse.json(getToolFilters(id))
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, filters, clearFirst } = await req.json()
  if (!id || !filters) return NextResponse.json({ error: 'id and filters required' }, { status: 400 })
  if (clearFirst) clearToolFilters(id)
  if (Object.keys(filters as Record<string, boolean>).length > 0) setToolFilters(id, filters as Record<string, boolean>)
  return NextResponse.json({ ok: true })
}
