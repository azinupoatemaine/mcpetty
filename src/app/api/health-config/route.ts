import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '../../../lib/auth'
import { updateHealthCheckConfig, isInstanceInstalled } from '../../../lib/db'

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { instanceId, intervalSeconds, failThreshold } = await req.json() as { instanceId: string; intervalSeconds: number; failThreshold: number }
  if (!instanceId || !isInstanceInstalled(instanceId)) return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
  updateHealthCheckConfig(instanceId, Number(intervalSeconds) || 0, Math.max(1, Math.min(10, Number(failThreshold) || 3)))
  return NextResponse.json({ ok: true })
}
