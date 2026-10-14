import { describe, it, expect } from 'vitest'
import type { NextRequest } from 'next/server'
import { checkProtocolVersion } from '../../src/lib/mcp-handler'

const req = (v?: string) => new Request('http://x/mcp', { headers: v ? { 'mcp-protocol-version': v } : {} }) as unknown as NextRequest

describe('checkProtocolVersion', () => {
  it('accepts a missing header', () => {
    expect(checkProtocolVersion(req())).toEqual({ ok: true, version: '2025-03-26' })
  })
  it('accepts every supported version, including 2025-11-25', () => {
    for (const v of ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']) {
      expect(checkProtocolVersion(req(v))).toEqual({ ok: true, version: v })
    }
  })
  it('lets a newer client negotiate down instead of failing the first request', () => {
    expect(checkProtocolVersion(req('2026-03-01'))).toEqual({ ok: true, version: '2025-06-18' })
  })
  it('still rejects an old unknown version and garbage', () => {
    expect(checkProtocolVersion(req('2023-01-01')).ok).toBe(false)
    expect(checkProtocolVersion(req('latest')).ok).toBe(false)
  })
})
