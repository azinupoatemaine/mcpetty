import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest, getSessionUsernameFromRequest } from '../../../../lib/auth'
import { updateGatewayKeyHash, writeAuditEvent } from '../../../../lib/db'
import { generateGatewayKey, hashGatewayKey } from '../../../../lib/crypto'
import { withActor } from '../../../../lib/audit'

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const key = generateGatewayKey()
  updateGatewayKeyHash(id, hashGatewayKey(key))
  withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
    writeAuditEvent('gateway_rotate_key', id)
  })
  return NextResponse.json({ key })
}
