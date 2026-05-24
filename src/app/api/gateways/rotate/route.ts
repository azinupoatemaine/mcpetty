import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '../../../../lib/auth'
import { updateGatewayKeyHash } from '../../../../lib/db'
import { generateGatewayKey, hashGatewayKey } from '../../../../lib/crypto'

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const key = generateGatewayKey()
  updateGatewayKeyHash(id, hashGatewayKey(key))
  return NextResponse.json({ key })
}
