import { NextRequest, NextResponse } from 'next/server'
import { getInsights } from '../../../lib/db'
import { isAuthorizedRequest } from '../../../lib/auth'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const days     = Number(req.nextUrl.searchParams.get('days') ?? 7)
  const platform = req.nextUrl.searchParams.get('platform') ?? undefined
  return NextResponse.json(getInsights(Math.min(days, 30), platform))
}
