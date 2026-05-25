import { NextRequest, NextResponse } from 'next/server'
import { authenticate, SESSION_COOKIE } from '../../../../lib/auth'
import { withActor } from '../../../../lib/audit'
import { writeAuditEvent, mustChangePassword } from '../../../../lib/db'

const loginAttempts = new Map<string, number[]>()
const RL_WINDOW     = 15 * 60 * 1000  // 15 min
const RL_MAX        = 10

function checkLoginRateLimit(ip: string): boolean {
  const now  = Date.now()
  const prev = (loginAttempts.get(ip) ?? []).filter(t => now - t < RL_WINDOW)
  if (prev.length >= RL_MAX) return false
  prev.push(now)
  loginAttempts.set(ip, prev)
  return true
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           ?? req.headers.get('x-real-ip')
           ?? 'unknown'

  if (!checkLoginRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many login attempts. Try again later.' }, { status: 429 })
  }

  const { username, password } = await req.json()

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 })
  }

  const token = authenticate(String(username), String(password))
  if (!token) {
    withActor({ actorType: 'user', actorId: String(username).slice(0, 64) }, () => {
      writeAuditEvent('login_failure', String(username).slice(0, 64), { ip })
    })
    return NextResponse.json({ error: 'Wrong credentials. Try harder.' }, { status: 401 })
  }

  withActor({ actorType: 'user', actorId: String(username) }, () => {
    writeAuditEvent('login_success', String(username), { ip })
  })

  const requirePasswordChange = mustChangePassword(String(username))
  const res = NextResponse.json({ ok: true, requirePasswordChange })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  })
  return res
}
