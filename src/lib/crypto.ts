import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'crypto'
import {
  existsSync, readFileSync, mkdirSync, renameSync, unlinkSync,
  openSync, writeSync, fsyncSync, closeSync, fchmodSync,
} from 'fs'
import { join } from 'path'

const ALGORITHM = 'aes-256-gcm'
const IV_LEN    = 12  // 96-bit IV — NIST recommended for GCM
const TAG_LEN   = 16  // 128-bit auth tag
const KEY_LEN   = 32  // 256-bit key
const SALT      = Buffer.from('mcpetty-v1-hkdf-salt', 'utf-8')

const DATA_DIR   = process.env.DATA_DIR || '/app/data'
const SECRET_FILE = join(DATA_DIR, '.secret')

let _secret: string | null = null

// Writes SECRET_FILE atomically: write to a temp file on the same filesystem, fsync it,
// then rename over the target. rename() is atomic on POSIX, so a killed/crashed process
// can never leave a truncated .secret behind for the next boot to trip over. The fsync
// matters as much as the rename — without it the rename can land while the bytes are
// still in the page cache, producing exactly the truncated file getSecret() refuses to
// accept. On any failure the temp file is removed rather than left as litter.
function writeSecretFile(secret: string): void {
  mkdirSync(DATA_DIR, { recursive: true })
  const tmpFile = `${SECRET_FILE}.tmp-${process.pid}`
  let fd: number | null = null
  try {
    fd = openSync(tmpFile, 'wx', 0o600)
    writeSync(fd, secret, null, 'utf-8')
    fchmodSync(fd, 0o600)
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    renameSync(tmpFile, SECRET_FILE)
  } catch (e) {
    if (fd !== null) { try { closeSync(fd) } catch { /* already closed */ } }
    try { unlinkSync(tmpFile) } catch { /* never existed */ }
    throw e
  }
}

// Returns the master secret. Priority:
//   1. MCPETTY_SECRET env var (explicit override)
//   2. Persisted secret file from a previous boot
//   3. Auto-generated on first boot — written to SECRET_FILE (chmod 600)
export function getSecret(): string {
  if (_secret) return _secret

  if (process.env.MCPETTY_SECRET && process.env.MCPETTY_SECRET.length >= 32) {
    _secret = process.env.MCPETTY_SECRET
    return _secret
  }

  if (existsSync(SECRET_FILE)) {
    const stored = readFileSync(SECRET_FILE, 'utf-8').trim()
    if (stored.length >= 32) {
      _secret = stored
      return _secret
    }
    // File exists but its content is too short/corrupt — do NOT silently regenerate.
    // That would quietly re-derive every credential key and gateway-key HMAC, breaking
    // decryption and invalidating every named gateway key with zero visible error.
    throw new Error(
      `[MCPetty] Secret file at ${SECRET_FILE} exists but is invalid (length ${stored.length}, need >= 32). ` +
      `Refusing to auto-regenerate — that would silently invalidate every named gateway key and all encrypted ` +
      `credentials. This usually means the file was truncated by an unclean shutdown. Restore it from backup, ` +
      `or delete it manually to accept a brand-new secret (you'll need to re-enter credentials and re-issue ` +
      `named gateway keys afterward).`
    )
  }

  // First boot — generate and persist
  _secret = randomBytes(32).toString('base64url')
  writeSecretFile(_secret)
  console.log('[MCPetty] Generated master secret →', SECRET_FILE)
  return _secret
}

// Kept for compatibility — now always succeeds (auto-generates if needed)
export function validateSecret(): void {
  getSecret()
}

function masterKey(): Buffer {
  return Buffer.from(getSecret(), 'utf-8')
}

// Per-credential key via HKDF — master secret is never used directly for encryption
function deriveKey(serverName: string, credKey: string): Buffer {
  const info = Buffer.from(`mcpetty:${serverName}:${credKey}`, 'utf-8')
  return Buffer.from(hkdfSync('sha256', masterKey(), SALT, info, KEY_LEN))
}

export interface Ciphertext {
  encrypted: Buffer
  iv:        Buffer
  tag:       Buffer
}

export function encrypt(
  plaintext: string,
  serverName: string,
  credKey: string
): Ciphertext {
  const key = deriveKey(serverName, credKey)
  const iv  = randomBytes(IV_LEN)
  try {
    const cipher    = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LEN })
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
    const tag       = cipher.getAuthTag()
    return { encrypted, iv, tag }
  } finally {
    key.fill(0)
  }
}

export function generateGatewayKey(): string {
  return randomBytes(32).toString('base64url')
}

export function hashGatewayKey(key: string): string {
  return createHmac('sha256', masterKey()).update(key).digest('hex')
}

// Constant-time comparison for secrets that arrive over the wire. timingSafeEqual
// throws on length mismatch and leaks length by returning early, so both operands are
// folded through SHA-256 first: fixed 32 bytes, no early exit, no length signal.
export function secretEquals(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf-8').digest()
  const hb = createHash('sha256').update(b, 'utf-8').digest()
  return timingSafeEqual(ha, hb)
}

// ─── Sealed settings ──────────────────────────────────────────────────────────
// For secrets that must stay *readable* (the dashboard has to display the master
// gateway key so you can copy the connect command) but must not sit in the DB as
// plaintext. Same AES-256-GCM + per-label HKDF as credentials, stored as one
// base64 blob: iv || tag || ciphertext.

export function sealSecret(plaintext: string, label: string): string {
  const { encrypted, iv, tag } = encrypt(plaintext, '__mcpetty_system__', label)
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function openSecret(sealed: string, label: string): string {
  const buf = Buffer.from(sealed, 'base64')
  if (buf.length < IV_LEN + TAG_LEN) throw new Error(`Sealed value for "${label}" is truncated`)
  return decrypt(
    {
      iv:        buf.subarray(0, IV_LEN),
      tag:       buf.subarray(IV_LEN, IV_LEN + TAG_LEN),
      encrypted: buf.subarray(IV_LEN + TAG_LEN),
    },
    '__mcpetty_system__',
    label
  )
}

export function decrypt(
  { encrypted, iv, tag }: Ciphertext,
  serverName: string,
  credKey: string
): string {
  const key = deriveKey(serverName, credKey)
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LEN })
    decipher.setAuthTag(tag)
    return decipher.update(encrypted).toString('utf-8') + decipher.final('utf-8')
  } finally {
    key.fill(0)
  }
}
