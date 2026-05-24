import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '../../../lib/auth'
import { getGatewayApiKey } from '../../../lib/crypto'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ key: getGatewayApiKey() })
}
