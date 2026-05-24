import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '../../../../lib/auth'
import { duplicateGateway } from '../../../../lib/db'
import { generateGatewayKey, hashGatewayKey } from '../../../../lib/crypto'
import { randomBytes } from 'crypto'

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, name } = await req.json()
  if (!id || !name?.trim()) return NextResponse.json({ error: 'id and name required' }, { status: 400 })
  const newId = randomBytes(4).toString('hex')
  const key   = generateGatewayKey()
  const gw    = duplicateGateway(id, newId, name.trim(), hashGatewayKey(key))
  return NextResponse.json({ ...gw, key })
}
