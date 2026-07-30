import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest, getSessionUsernameFromRequest } from '../../../lib/auth'
import { withActor } from '../../../lib/audit'
import { writeAuditEvent } from '../../../lib/db'
import { getSettingsMap, setSettings } from '../../../lib/db'
import { webhookUrlError } from '../../../lib/webhook-url'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ settings: getSettingsMap() })
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json() as { settings?: Record<string, string> }

  const actor = { actorType: 'user' as const, actorId: getSessionUsernameFromRequest(req) }
  if (body.settings) {
    // Validated on save, not only in the test endpoint — the test button is optional and
    // this is the value that actually gets POSTed to on every matching tool call.
    const webhookUrl = body.settings.webhook_url?.trim()
    if (webhookUrl) {
      const invalid = webhookUrlError(webhookUrl)
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })
    }
    setSettings(body.settings)
    withActor(actor, () => { writeAuditEvent('settings_change', 'settings', { keys: Object.keys(body.settings!) }) })
  }

  return NextResponse.json({ ok: true })
}
