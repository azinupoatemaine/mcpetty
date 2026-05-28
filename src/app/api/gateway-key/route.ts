import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest, getSessionUsernameFromRequest } from '../../../lib/auth'
import { getMasterGatewayKey, rotateMasterGatewayKey, writeAuditEvent } from '../../../lib/db'
import { withActor } from '../../../lib/audit'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ key: getMasterGatewayKey() })
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const key = rotateMasterGatewayKey()
  withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
    writeAuditEvent('master_gateway_key_rotated', 'master')
  })
  return NextResponse.json({ key })
}
