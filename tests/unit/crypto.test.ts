import { describe, it, expect } from 'vitest'
import { encrypt, decrypt, hashGatewayKey } from '../../src/lib/crypto'

describe('encrypt / decrypt', () => {
  it('round-trips plaintext', () => {
    const ct = encrypt('my-api-key', 'inst1', 'API_KEY')
    expect(decrypt(ct, 'inst1', 'API_KEY')).toBe('my-api-key')
  })

  it('different instanceId → different key → different ciphertext', () => {
    const ct1 = encrypt('secret', 'inst1', 'KEY')
    const ct2 = encrypt('secret', 'inst2', 'KEY')
    expect(ct1.encrypted.toString('hex')).not.toBe(ct2.encrypted.toString('hex'))
  })

  it('different credKey → different key → different ciphertext', () => {
    const ct1 = encrypt('secret', 'inst1', 'KEY1')
    const ct2 = encrypt('secret', 'inst1', 'KEY2')
    expect(ct1.encrypted.toString('hex')).not.toBe(ct2.encrypted.toString('hex'))
  })

  it('random IV → different ciphertext each call even for same plaintext+keys', () => {
    const ct1 = encrypt('secret', 'inst1', 'KEY')
    const ct2 = encrypt('secret', 'inst1', 'KEY')
    expect(ct1.iv.toString('hex')).not.toBe(ct2.iv.toString('hex'))
    // Both decrypt correctly
    expect(decrypt(ct1, 'inst1', 'KEY')).toBe('secret')
    expect(decrypt(ct2, 'inst1', 'KEY')).toBe('secret')
  })

  it('throws on tampered ciphertext', () => {
    const ct = encrypt('secret', 'inst1', 'KEY')
    ct.encrypted[0] ^= 0xff
    expect(() => decrypt(ct, 'inst1', 'KEY')).toThrow()
  })

  it('throws on tampered auth tag', () => {
    const ct = encrypt('secret', 'inst1', 'KEY')
    ct.tag[0] ^= 0xff
    expect(() => decrypt(ct, 'inst1', 'KEY')).toThrow()
  })

  it('throws when decrypting with wrong instanceId (wrong derived key)', () => {
    const ct = encrypt('secret', 'inst1', 'KEY')
    expect(() => decrypt(ct, 'wrong', 'KEY')).toThrow()
  })

  it('throws when decrypting with wrong credKey', () => {
    const ct = encrypt('secret', 'inst1', 'KEY')
    expect(() => decrypt(ct, 'inst1', 'WRONGKEY')).toThrow()
  })

  it('handles empty string plaintext', () => {
    const ct = encrypt('', 'inst1', 'KEY')
    expect(decrypt(ct, 'inst1', 'KEY')).toBe('')
  })

  it('handles unicode plaintext', () => {
    const plain = 'pâslă 🐸'
    const ct = encrypt(plain, 'inst1', 'KEY')
    expect(decrypt(ct, 'inst1', 'KEY')).toBe(plain)
  })
})

describe('hashGatewayKey', () => {
  it('is deterministic', () => {
    expect(hashGatewayKey('mykey')).toBe(hashGatewayKey('mykey'))
  })

  it('differs for different inputs', () => {
    expect(hashGatewayKey('key1')).not.toBe(hashGatewayKey('key2'))
  })

  it('returns hex string', () => {
    expect(hashGatewayKey('k')).toMatch(/^[0-9a-f]+$/)
  })
})

