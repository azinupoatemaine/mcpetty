import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest, getSessionUsernameFromRequest } from '../../../lib/auth'
import { getApproverKey, rotateApproverKey, writeAuditEvent } from '../../../lib/db'
import { withActor } from '../../../lib/audit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ key: getApproverKey() })
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const key = rotateApproverKey()
  withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
    writeAuditEvent('approver_key_rotated', 'approver')
  })
  return NextResponse.json({ key })
}
