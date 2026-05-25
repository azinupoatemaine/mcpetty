import { NextRequest, NextResponse } from 'next/server'
import { destroySession, SESSION_COOKIE } from '../../../../lib/auth'
import { withActor } from '../../../../lib/audit'
import { getSessionUsername, writeAuditEvent } from '../../../../lib/db'

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token) {
    const username = getSessionUsername(token) ?? 'unknown'
    withActor({ actorType: 'user', actorId: username }, () => {
      writeAuditEvent('logout', username)
    })
    destroySession(token)
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', { maxAge: 0, path: '/' })
  return res
}
