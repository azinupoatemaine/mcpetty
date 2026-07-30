import { describe, it, expect } from 'vitest'
import { webhookUrlError } from '../../src/lib/webhook-url'

describe('webhookUrlError', () => {
  it('allows RFC1918 targets — self-hosted deployments need them', () => {
    for (const u of ['http://10.10.10.5:5678/webhook/x', 'http://192.168.1.20/hook', 'https://n8n.example.com/webhook/y']) {
      expect(webhookUrlError(u)).toBeNull()
    }
  })

  it('blocks loopback in every spelling', () => {
    for (const u of ['http://localhost:1234/x', 'http://127.0.0.1/x', 'http://127.1.2.3/x', 'http://[::1]/x']) {
      expect(webhookUrlError(u)).toMatch(/loopback/)
    }
  })

  it('blocks link-local / cloud metadata', () => {
    expect(webhookUrlError('http://169.254.169.254/latest/meta-data/')).toMatch(/link-local/)
    expect(webhookUrlError('http://[fe80::1]/x')).toMatch(/link-local/)
  })

  it('rejects non-http schemes and junk', () => {
    expect(webhookUrlError('file:///etc/passwd')).toMatch(/http or https/)
    expect(webhookUrlError('not a url')).toMatch(/valid URL/)
  })
})
