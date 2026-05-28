import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '../../../lib/auth'
import { getAuditLog } from '../../../lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limit  = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit')  ?? 200)))
  const offset = Math.max(0,              Number(req.nextUrl.searchParams.get('offset') ?? 0))
  return NextResponse.json(getAuditLog(limit, offset))
}
