import { describe, it, expect, beforeAll, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// This exercises the boot path: getMasterGatewayKey() runs on every /mcp request and
// migrates a pre-existing plaintext key in place. If that migration is wrong, an existing
// deployment either loses its gateway key or throws on boot — so it gets a real DB, not
// a mock.
let db: typeof import('../../src/lib/db')

beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'mcpetty-keytest-'))
  db = await import('../../src/lib/db')
})

describe('master gateway key', () => {
  it('generates once and is stable across calls', () => {
    const first = db.getMasterGatewayKey()
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)  // 32 bytes base64url
    expect(db.getMasterGatewayKey()).toBe(first)
  })

  it('is not stored in plaintext', () => {
    const key = db.getMasterGatewayKey()
    expect(db.getSetting('master_gateway_key')).toBeNull()
    const sealed = db.getSetting('master_gateway_key_sealed')
    expect(sealed).toBeTruthy()
    expect(sealed).not.toContain(key)
  })

  it('rotation produces a new key that persists', () => {
    const before = db.getMasterGatewayKey()
    const rotated = db.rotateMasterGatewayKey()
    expect(rotated).not.toBe(before)
    expect(db.getMasterGatewayKey()).toBe(rotated)
    expect(db.getSetting('master_gateway_key_sealed')).not.toContain(rotated)
  })
})

describe('legacy plaintext migration', () => {
  it('adopts an existing plaintext key unchanged, then removes the plaintext row', async () => {
    // Simulate a deployment upgrading from the version that stored the key in the clear.
    // A second DATA_DIR plus a reset module registry means the in-memory key cache from
    // the suite above cannot mask a failure here — a shared instance would return the
    // rotated key rather than LEGACY and fail the first assertion.
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'mcpetty-keytest-legacy-'))
    vi.resetModules()
    const fresh = await import('../../src/lib/db')

    const LEGACY = 'legacy-plaintext-gateway-key-value'
    fresh.setSetting('master_gateway_key', LEGACY)

    // Same value — every client configured with it keeps working.
    expect(fresh.getMasterGatewayKey()).toBe(LEGACY)
    // ...but it is no longer readable in the raw DB.
    expect(fresh.getSetting('master_gateway_key')).toBeNull()
    expect(fresh.getSetting('master_gateway_key_sealed')).toBeTruthy()
    // Survives a re-read now that only the sealed row exists.
    expect(fresh.getMasterGatewayKey()).toBe(LEGACY)
  })
})

describe('approver key', () => {
  it('is distinct from the master gateway key', () => {
    expect(db.getApproverKey()).not.toBe(db.getMasterGatewayKey())
  })

  it('is stable, sealed, and rotatable', () => {
    const first = db.getApproverKey()
    expect(db.getApproverKey()).toBe(first)
    expect(db.getSetting('approver_key_sealed')).not.toContain(first)
    const rotated = db.rotateApproverKey()
    expect(rotated).not.toBe(first)
    expect(db.getApproverKey()).toBe(rotated)
  })
})
