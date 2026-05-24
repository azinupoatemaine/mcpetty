import { NextRequest, NextResponse } from 'next/server'
import { setInstanceTags, getDistinctTags } from '../../../lib/db'
import { isAuthorizedRequest } from '../../../lib/auth'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(getDistinctTags())
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { instanceId, tags } = await req.json() as { instanceId: string; tags: string[] }
  if (!instanceId) return NextResponse.json({ error: 'instanceId required' }, { status: 400 })
  setInstanceTags(instanceId, tags ?? [])
  return NextResponse.json({ ok: true })
}
