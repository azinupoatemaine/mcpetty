import { scryptSync, randomBytes, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import {
  getUserCount,
  getUserPasswordHash,
  upsertUser,
  createSessionToken,
  validateSessionToken,
  deleteSessionToken,
  deleteSessionsByUsername,
  getSessionUsername,
  markMustChangePassword,
  clearMustChangePassword,
} from './db'

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 }
const KEY_LEN     = 64
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000

export const SESSION_COOKIE = 'mcpetty_session'

function hashPassword(password: string, salt: string): Buffer {
  return scryptSync(password, salt, KEY_LEN, SCRYPT_OPTS)
}

export function ensureDefaultUser(): void {
  if (getUserCount() > 0) return
  const salt = randomBytes(16).toString('hex')
  const hash = hashPassword('mcpetty', salt)
  upsertUser('admin', hash, salt)
  markMustChangePassword('admin')
  console.log('[MCPetty] ⚠  Default credentials: admin / mcpetty')
  console.log('[MCPetty] ⚠  Change your password in dashboard settings!')
}

export function authenticate(username: string, password: string): string | null {
  const row = getUserPasswordHash(username)
  if (!row) return null

  let match = false
  try {
    const derived = hashPassword(password, row.salt)
    const stored  = Buffer.isBuffer(row.hash) ? row.hash : Buffer.from(row.hash)
    match = timingSafeEqual(derived, stored)
  } catch {
    return null
  }
  if (!match) return null

  const token     = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + SESSION_TTL
  createSessionToken(token, username, expiresAt)
  return token
}

export function validateSession(token: string): boolean {
  if (!token || token.length !== 64) return false
  return validateSessionToken(token)
}

export function destroySession(token: string): void {
  deleteSessionToken(token)
}

export function verifyPassword(username: string, password: string): boolean {
  const row = getUserPasswordHash(username)
  if (!row) return false
  try {
    const derived = hashPassword(password, row.salt)
    const stored  = Buffer.isBuffer(row.hash) ? row.hash : Buffer.from(row.hash)
    return timingSafeEqual(derived, stored)
  } catch { return false }
}

export function changePassword(username: string, newPassword: string): void {
  const salt = randomBytes(16).toString('hex')
  const hash = hashPassword(newPassword, salt)
  upsertUser(username, hash, salt)
  clearMustChangePassword(username)
  deleteSessionsByUsername(username)
}

function csrfSafe(req: NextRequest): boolean {
  const host   = req.headers.get('host') ?? ''
  const origin = req.headers.get('origin')
  if (origin) {
    try { return new URL(origin).host === host } catch { return false }
  }
  const referer = req.headers.get('referer')
  if (referer) {
    try { return new URL(referer).host === host } catch { return false }
  }
  return true
}

export function isAuthorizedRequest(req: NextRequest): boolean {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token || !validateSession(token)) return false
  if (!csrfSafe(req)) return false
  return true
}

export function getSessionUsernameFromRequest(req: NextRequest): string {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? ''
  return getSessionUsername(token) ?? 'unknown'
}
