import { NextRequest, NextResponse } from 'next/server'
import { getChangelog } from '../../../lib/db'
import { isAuthorizedRequest } from '../../../lib/auth'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const days = Number(req.nextUrl.searchParams.get('days') ?? 30)
  return NextResponse.json(getChangelog(Math.min(days, 90)))
}
