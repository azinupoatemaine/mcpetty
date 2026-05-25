import { describe, it, expect, vi, afterEach } from 'vitest'
import { restFetch, gqlFetch } from '../../src/lib/native/http'

afterEach(() => vi.unstubAllGlobals())

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown>; text?: () => Promise<string> }) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
}

function mockFetchThrow(error: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
}

// ── restFetch ──────────────────────────────────────────────────────────────────

describe('restFetch', () => {
  it('returns parsed JSON on 200', async () => {
    mockFetch({ ok: true, status: 200, text: async () => JSON.stringify({ id: 1 }) })
    const res = await restFetch<{ id: number }>('http://example.com', '/api/thing', 'tok')
    expect(res).toEqual({ id: 1 })
  })

  it('sends Authorization: Bearer by default', async () => {
    mockFetch({ ok: true, status: 200, text: async () => '{}' })
    await restFetch('http://example.com', '/api/thing', 'mytoken')
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1].headers['Authorization']).toBe('Bearer mytoken')
  })

  it('sends custom auth header (e.g. X-API-Key for Portainer)', async () => {
    mockFetch({ ok: true, status: 200, text: async () => '{}' })
    await restFetch('http://example.com', '/api/thing', 'mykey', 'X-API-Key', '')
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1].headers['X-API-Key']).toBe('mykey')
    expect(call[1].headers['Authorization']).toBeUndefined()
  })

  it('constructs URL from baseUrl + path', async () => {
    mockFetch({ ok: true, status: 200, text: async () => '{}' })
    await restFetch('http://example.com', '/api/items', 'tok')
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('http://example.com/api/items')
  })

  it('returns {} for 204 No Content', async () => {
    mockFetch({ ok: true, status: 204, text: async () => '' })
    const res = await restFetch('http://example.com', '/api/thing', 'tok')
    expect(res).toEqual({})
  })

  it('throws on 401 with specific message', async () => {
    mockFetch({ ok: false, status: 401, text: async () => 'Unauthorized' })
    await expect(restFetch('http://example.com', '/api/thing', 'tok'))
      .rejects.toThrow('401 Unauthorized')
  })

  it('throws on 403 with specific message', async () => {
    mockFetch({ ok: false, status: 403, text: async () => 'Forbidden' })
    await expect(restFetch('http://example.com', '/api/thing', 'tok'))
      .rejects.toThrow('403 Forbidden')
  })

  it('throws on 404 with specific message', async () => {
    mockFetch({ ok: false, status: 404, text: async () => 'Not Found' })
    await expect(restFetch('http://example.com', '/api/thing', 'tok'))
      .rejects.toThrow('404 Not Found')
  })

  it('throws with status code for other non-ok responses', async () => {
    mockFetch({ ok: false, status: 500, text: async () => 'Internal Server Error' })
    await expect(restFetch('http://example.com', '/api/thing', 'tok'))
      .rejects.toThrow('HTTP 500')
  })

  it('throws a network error with localhost hint for localhost URLs', async () => {
    const err = new TypeError('Failed to fetch')
    ;(err as unknown as { cause: Error }).cause = new Error('ECONNREFUSED')
    mockFetchThrow(err)
    await expect(restFetch('http://localhost:3000', '/api', 'tok'))
      .rejects.toThrow('localhost')
  })

  it('throws a network error without localhost hint for non-localhost URLs', async () => {
    const err = new TypeError('Failed to fetch')
    ;(err as unknown as { cause: Error }).cause = new Error('ECONNREFUSED')
    mockFetchThrow(err)
    const error = await restFetch('http://192.168.1.1', '/api', 'tok').catch((e: unknown) => e)
    expect((error as Error).message).not.toContain('"localhost"')
    expect((error as Error).message).toContain('192.168.1.1')
  })
})

// ── gqlFetch ───────────────────────────────────────────────────────────────────

describe('gqlFetch', () => {
  it('returns data on success', async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ data: { users: [{ id: 1 }] } }) })
    const res = await gqlFetch<{ users: { id: number }[] }>('http://example.com', 'tok', '{ users { id } }')
    expect(res).toEqual({ users: [{ id: 1 }] })
  })

  it('always POSTs to /graphql', async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ data: {} }) })
    await gqlFetch('http://example.com', 'tok', '{ x }')
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('http://example.com/graphql')
    expect(call[1].method).toBe('POST')
  })

  it('sends Authorization: Bearer', async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ data: {} }) })
    await gqlFetch('http://example.com', 'mytoken', '{ x }')
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1].headers['Authorization']).toBe('Bearer mytoken')
  })

  it('throws on GraphQL errors array', async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'Field not found' }] }) })
    await expect(gqlFetch('http://example.com', 'tok', '{ bad }'))
      .rejects.toThrow('GraphQL error: Field not found')
  })

  it('throws on HTTP 400', async () => {
    mockFetch({ ok: false, status: 400 })
    await expect(gqlFetch('http://example.com', 'tok', '{ x }'))
      .rejects.toThrow('GraphQL HTTP 400')
  })

  it('throws on 401', async () => {
    mockFetch({ ok: false, status: 401 })
    await expect(gqlFetch('http://example.com', 'tok', '{ x }'))
      .rejects.toThrow('401 Unauthorized')
  })

  it('throws a network error with localhost hint for localhost URLs', async () => {
    const err = new TypeError('Failed to fetch')
    ;(err as unknown as { cause: Error }).cause = new Error('ECONNREFUSED')
    mockFetchThrow(err)
    await expect(gqlFetch('http://localhost:8080', 'tok', '{ x }'))
      .rejects.toThrow('localhost')
  })
})
