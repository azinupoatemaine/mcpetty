import { NextRequest, NextResponse } from 'next/server'
import { getSessions, getSessionCalls } from '../../../../lib/db'
import { isAuthorizedRequest } from '../../../../lib/auth'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sessionId = req.nextUrl.searchParams.get('session_id')
  if (sessionId) return NextResponse.json(getSessionCalls(sessionId))
  const days = Number(req.nextUrl.searchParams.get('days') ?? 7)
  return NextResponse.json(getSessions(Math.min(days, 30)))
}
