import { NextRequest, NextResponse } from 'next/server'
import { getDescriptionOverrides, setDescriptionOverride, clearDescriptionOverride } from '../../../lib/db'
import { isAuthorizedRequest } from '../../../lib/auth'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  return NextResponse.json(getDescriptionOverrides(id))
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, toolName, description } = await req.json() as { id: string; toolName: string; description: string }
  if (!id || !toolName) return NextResponse.json({ error: 'id and toolName required' }, { status: 400 })
  if (description === '' || description == null) {
    clearDescriptionOverride(id, toolName)
  } else {
    setDescriptionOverride(id, toolName, description)
  }
  return NextResponse.json({ ok: true })
}
