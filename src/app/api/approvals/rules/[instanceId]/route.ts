import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '../../../../../lib/auth'
import { getApprovalRules, setApprovalRules } from '../../../../../lib/db'

export async function GET(req: NextRequest, { params }: { params: Promise<{ instanceId: string }> }) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { instanceId } = await params
  return NextResponse.json(getApprovalRules(instanceId))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ instanceId: string }> }) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { instanceId } = await params
  const rules = await req.json() as Array<{ pattern: string; enabled: boolean }>
  if (!Array.isArray(rules)) return NextResponse.json({ error: 'rules must be an array' }, { status: 400 })
  setApprovalRules(instanceId, rules)
  return NextResponse.json({ ok: true })
}
