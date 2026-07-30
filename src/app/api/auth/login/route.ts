import { NextRequest, NextResponse } from 'next/server'
import { authenticate, SESSION_COOKIE } from '../../../../lib/auth'
import { withActor } from '../../../../lib/audit'
import { writeAuditEvent, mustChangePassword } from '../../../../lib/db'

const RL_WINDOW = 15 * 60 * 1000  // 15 min
const RL_MAX    = 10              // per client IP
const RL_USER   = 10              // per username, across all IPs

// The IP bucket alone was bypassable: it keys on x-forwarded-for, which any client can
// set to a fresh value per request when MCPetty is reached directly rather than through a
// trusted proxy. The account bucket is the one that actually bounds a password guess,
// since the attacker cannot vary the username they are trying to break into.
const ipAttempts   = new Map<string, number[]>()
const userAttempts = new Map<string, number[]>()

function hit(bucket: Map<string, number[]>, key: string, max: number): boolean {
  const now  = Date.now()
  const prev = (bucket.get(key) ?? []).filter(t => now - t < RL_WINDOW)
  if (prev.length >= max) { bucket.set(key, prev); return false }
  prev.push(now)
  bucket.set(key, prev)
  return true
}

// Only failures count against the account bucket, so a busy legitimate user is never
// locked out by their own successful logins.
function clearUser(username: string): void {
  userAttempts.delete(username)
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           ?? req.headers.get('x-real-ip')
           ?? 'unknown'

  if (!hit(ipAttempts, ip, RL_MAX)) {
    return NextResponse.json({ error: 'Too many login attempts. Try again later.' }, { status: 429 })
  }

  const { username, password } = await req.json()

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 })
  }

  if (!hit(userAttempts, String(username), RL_USER)) {
    return NextResponse.json({ error: 'Too many login attempts. Try again later.' }, { status: 429 })
  }

  const token = authenticate(String(username), String(password))
  if (!token) {
    withActor({ actorType: 'user', actorId: String(username).slice(0, 64) }, () => {
      writeAuditEvent('login_failure', String(username).slice(0, 64), { ip })
    })
    return NextResponse.json({ error: 'Wrong credentials. Try harder.' }, { status: 401 })
  }

  clearUser(String(username))
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
