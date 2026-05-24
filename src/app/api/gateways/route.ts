import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '../../../lib/auth'
import { createGateway, listGateways, deleteGateway, renameGateway, setGatewayInstances } from '../../../lib/db'
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
  return NextResponse.json({ ...gw, instanceIds, key })
}

export async function DELETE(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  deleteGateway(id)
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, name } = await req.json()
  if (!id || !name?.trim()) return NextResponse.json({ error: 'id and name required' }, { status: 400 })
  renameGateway(id, name.trim())
  return NextResponse.json({ ok: true })
}
