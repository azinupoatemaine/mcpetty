import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest, getSessionUsernameFromRequest } from '../../../lib/auth'
import { withActor } from '../../../lib/audit'
import { writeAuditEvent } from '../../../lib/db'
import { createGateway, listGateways, deleteGateway, renameGateway, setGatewayInstances, setGatewayContextPrefix } from '../../../lib/db'
import { generateGatewayKey, hashGatewayKey } from '../../../lib/crypto'
import { randomBytes } from 'crypto'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(listGateways())
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { name, instanceIds = [] } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  const id  = randomBytes(4).toString('hex')
  const key = generateGatewayKey()
  const gw  = createGateway(id, name.trim(), hashGatewayKey(key))
  setGatewayInstances(id, instanceIds)
  withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
    writeAuditEvent('gateway_create', id, { name: name.trim() })
  })
  return NextResponse.json({ ...gw, instanceIds, key })
}

export async function DELETE(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
    writeAuditEvent('gateway_delete', id)
  })
  deleteGateway(id)
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json() as { id: string; name?: string; contextPrefix?: string }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const actor = { actorType: 'user' as const, actorId: getSessionUsernameFromRequest(req) }
  if (body.name !== undefined) {
    if (!body.name.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    renameGateway(body.id, body.name.trim())
    withActor(actor, () => { writeAuditEvent('gateway_rename', body.id, { name: body.name!.trim() }) })
  }
  if (body.contextPrefix !== undefined) {
    setGatewayContextPrefix(body.id, body.contextPrefix)
  }
  return NextResponse.json({ ok: true })
}
