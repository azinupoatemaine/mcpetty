import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '../../../../lib/auth'
import { getGatewayInstances, setGatewayInstances } from '../../../../lib/db'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  return NextResponse.json(getGatewayInstances(id))
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, instanceIds } = await req.json()
  if (!id || !Array.isArray(instanceIds)) return NextResponse.json({ error: 'id and instanceIds required' }, { status: 400 })
  setGatewayInstances(id, instanceIds)
  return NextResponse.json({ ok: true })
}
