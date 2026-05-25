import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest, getSessionUsernameFromRequest } from '../../../lib/auth'
import { withActor } from '../../../lib/audit'
import { writeAuditEvent } from '../../../lib/db'
import { getSettingsMap, setSettings, getAllRateLimits, setRateLimit, deleteRateLimit, listGateways } from '../../../lib/db'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    settings:   getSettingsMap(),
    rateLimits: getAllRateLimits(),
    gateways:   listGateways().map((g) => ({ id: g.id, name: g.name })),
  })
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json() as {
    settings?:          Record<string, string>
    setRateLimit?:      { gatewayId: string; maxCalls: number; windowSecs: number }
    deleteRateLimit?:   string
  }

  const actor = { actorType: 'user' as const, actorId: getSessionUsernameFromRequest(req) }
  if (body.settings) {
    setSettings(body.settings)
    withActor(actor, () => { writeAuditEvent('settings_change', 'settings', { keys: Object.keys(body.settings!) }) })
  }
  if (body.setRateLimit)   setRateLimit(body.setRateLimit.gatewayId, body.setRateLimit.maxCalls, body.setRateLimit.windowSecs)
  if (body.deleteRateLimit) deleteRateLimit(body.deleteRateLimit)

  return NextResponse.json({ ok: true })
}
