import { describe, it, expect, vi, afterEach } from 'vitest'

// proxmox.ts pulls credentials from the DB; stub that rather than standing up SQLite.
vi.mock('../../src/lib/db', () => ({
  getCredential: (_instanceId: string, key: string) =>
    ({
      PROXMOX_URL:         'https://pve.example.com:8006',
      PROXMOX_USER:        'root@pam',
      PROXMOX_TOKEN_NAME:  'mytoken',
      PROXMOX_TOKEN_VALUE: 'secret-value',
    } as Record<string, string>)[key] ?? null,
}))

const { call } = await import('../../src/lib/native/proxmox')

afterEach(() => vi.unstubAllGlobals())

function mockFetch(body: unknown = { data: 'UPID:node1:0000:qmshutdown:101:root@pam:' }) {
  const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(body) })
  vi.stubGlobal('fetch', fn)
  return fn
}

const lastInit = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[0][1] as RequestInit
const headers  = (fn: ReturnType<typeof vi.fn>) => lastInit(fn).headers as Record<string, string>

// Regression: issue #7. Every bodyless mutation declared Content-Type: application/json
// (restFetch's default) while sending an empty body, and Proxmox's Perl API server tried to
// JSON-parse zero bytes:
//   HTTP 500 ... malformed JSON string, neither tag, array, object, number, string or atom,
//   at character offset 0 (before "(end of string)")
describe('bodyless mutations declare form-urlencoded, not JSON (issue #7)', () => {
  const BODYLESS: Array<[string, Record<string, unknown>]> = [
    ['start_vm',          { node: 'node1', vmid: 101 }],
    ['stop_vm',           { node: 'node1', vmid: 101 }],
    ['shutdown_vm',       { node: 'node1', vmid: 101 }],
    ['reset_vm',          { node: 'node1', vmid: 101 }],
    ['start_container',   { node: 'node1', vmid: 200 }],
    ['stop_container',    { node: 'node1', vmid: 200, graceful: true }],
    ['restart_container', { node: 'node1', vmid: 200 }],
  ]

  for (const [action, args] of BODYLESS) {
    it(`${action} sends form-urlencoded with no body`, async () => {
      const fn = mockFetch()
      await call('pve', action, args)
      expect(headers(fn)['Content-Type']).toBe('application/x-www-form-urlencoded')
      // An empty body is fine; an empty body under application/json is what broke.
      expect(lastInit(fn).body).toBeUndefined()
      expect(headers(fn)['Content-Type']).not.toBe('application/json')
    })
  }

  it('DELETE mutations too (cancel_job)', async () => {
    const fn = mockFetch({ data: null })
    await call('pve', 'cancel_job', { node: 'node1', upid: 'UPID:node1:0000:qmstart:101:root@pam:' })
    expect(lastInit(fn).method).toBe('DELETE')
    expect(headers(fn)['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it('DELETE mutations too (delete_iso)', async () => {
    const fn = mockFetch({ data: null })
    await call('pve', 'delete_iso', { node: 'node1', storage: 'local', volid: 'local:iso/debian.iso' })
    expect(lastInit(fn).method).toBe('DELETE')
    expect(headers(fn)['Content-Type']).toBe('application/x-www-form-urlencoded')
  })
})

describe('mutations that do carry a body still serialize it', () => {
  it('encodes params as a urlencoded body', async () => {
    const fn = mockFetch()
    await call('pve', 'create_snapshot', {
      node: 'node1', vmid: 101, snapname: 'before-upgrade', description: 'a b', vmstate: true,
    })
    expect(headers(fn)['Content-Type']).toBe('application/x-www-form-urlencoded')
    const body = new URLSearchParams(lastInit(fn).body as string)
    expect(body.get('snapname')).toBe('before-upgrade')
    expect(body.get('description')).toBe('a b')
    // Proxmox wants '1'/'0' for booleans in form encoding, not 'true'/'false'
    expect(body.get('vmstate')).toBe('1')
  })
})

describe('auth and reads are unaffected', () => {
  it('sends the PVEAPIToken header with no scheme prefix', async () => {
    const fn = mockFetch({ data: [] })
    await call('pve', 'get_nodes', {})
    expect(headers(fn)['Authorization']).toBe('PVEAPIToken=root@pam!mytoken=secret-value')
  })

  it('GET requests are untouched by the mutation header change', async () => {
    const fn = mockFetch({ data: [] })
    await call('pve', 'get_nodes', {})
    expect(lastInit(fn).method).toBeUndefined()
    expect(lastInit(fn).body).toBeUndefined()
  })
})
