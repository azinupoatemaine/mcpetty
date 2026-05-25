import { NextRequest, NextResponse } from 'next/server'
import { getInsights, getSchemaTokenTrend, getLatestSchemaTokenBreakdown } from '../../../lib/db'
import { isAuthorizedRequest } from '../../../lib/auth'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const days     = Number(req.nextUrl.searchParams.get('days') ?? 7)
  const platform = req.nextUrl.searchParams.get('platform') ?? undefined
  const insights = getInsights(Math.min(days, 30), platform)
  const schemaTrend   = getSchemaTokenTrend(days)
  const latestSchema  = getLatestSchemaTokenBreakdown(null)
  return NextResponse.json({ ...insights, schemaTrend, latestSchema })
}
