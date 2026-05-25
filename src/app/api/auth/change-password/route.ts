import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest, verifyPassword, changePassword, getSessionUsernameFromRequest } from '../../../../lib/auth'
import { mustChangePassword } from '../../../../lib/db'
import { withActor } from '../../../../lib/audit'
import { writeAuditEvent } from '../../../../lib/db'

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const username = getSessionUsernameFromRequest(req)
  const { currentPassword, newPassword } = await req.json() as { currentPassword?: string; newPassword?: string }

  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 })
  }

  if (!mustChangePassword(username)) {
    if (!currentPassword) return NextResponse.json({ error: 'Current password required.' }, { status: 400 })
    if (!verifyPassword(username, currentPassword)) {
      return NextResponse.json({ error: 'Current password is wrong.' }, { status: 403 })
    }
  }

  changePassword(username, newPassword)
  withActor({ actorType: 'user', actorId: username }, () => {
    writeAuditEvent('password_changed', username)
  })
  return NextResponse.json({ ok: true })
}
