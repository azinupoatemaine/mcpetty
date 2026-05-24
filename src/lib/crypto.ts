import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'

const ALGORITHM = 'aes-256-gcm'
const IV_LEN    = 12  // 96-bit IV — NIST recommended for GCM
const TAG_LEN   = 16  // 128-bit auth tag
const KEY_LEN   = 32  // 256-bit key
const SALT      = Buffer.from('mcpetty-v1-hkdf-salt', 'utf-8')

const DATA_DIR   = process.env.DATA_DIR || '/app/data'
const SECRET_FILE = join(DATA_DIR, '.secret')

let _secret: string | null = null

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
  }

  // First boot — generate and persist
  mkdirSync(DATA_DIR, { recursive: true })
  _secret = randomBytes(32).toString('base64url')
  writeFileSync(SECRET_FILE, _secret, { encoding: 'utf-8', mode: 0o600 })
  chmodSync(SECRET_FILE, 0o600)
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

// Stable API key for the /mcp gateway — derived from master secret, never stored separately
export function getGatewayApiKey(): string {
  const key = Buffer.from(getSecret(), 'utf-8')
  const derived = Buffer.from(hkdfSync('sha256', key, SALT, Buffer.from('mcpetty-gateway-v1'), 32))
  return derived.toString('base64url')
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
