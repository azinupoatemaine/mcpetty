import { describe, it, expect, vi, afterEach } from 'vitest'

const TOKEN = 'tok-SUPER-secret-123'

vi.mock('../../src/lib/db', () => ({
  getCredential: (_instanceId: string, key: string) =>
    ({ SYNCTROPY_URL: 'http://10.10.10.22:8480/', SYNCTROPY_TOKEN: 'tok-SUPER-secret-123' } as Record<string, string>)[key] ?? null,
}))

const { TOOLS, call, ping } = await import('../../src/lib/native/synctropy')
const { NATIVE } = await import('../../src/lib/native')
const { CATALOG } = await import('../../src/lib/mcp-catalog')

afterEach(() => vi.unstubAllGlobals())

function mockFetch(body: unknown = {}, status = 200) {
  const fn = vi.fn().mockResolvedValue({ ok: status < 400, status, text: async () => JSON.stringify(body) })
  vi.stubGlobal('fetch', fn)
  return fn
}
const url  = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[0][0] as string
const init = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[0][1] as RequestInit
const hdrs = (fn: ReturnType<typeof vi.fn>) => init(fn).headers as Record<string, string>

describe('registration', () => {
  it('is registered in NATIVE and the catalog', () => {
    expect(NATIVE.synctropy.tools).toBe(TOOLS)
    const entry = CATALOG.find((m) => m.id === 'synctropy')!
    expect(entry.transport).toBe('native')
    expect(entry.credentials.map((c) => [c.key, c.type, c.required])).toEqual([
      ['SYNCTROPY_URL', 'url', true], ['SYNCTROPY_TOKEN', 'secret', true],
    ])
  })

  it('exposes exactly the mapped actions', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      'create_agent', 'delete_agent', 'get_agent', 'get_health', 'get_overview', 'get_settings',
      'list_agents', 'list_audit', 'list_events', 'list_feed', 'list_routes', 'rotate_agent_token', 'update_setting',
    ])
    expect(TOOLS.every((t) => t.description)).toBe(true)
  })

  it('delete_agent is the only delete_-named (approval-gateable) action', () => {
    expect(TOOLS.map((t) => t.name).filter((n) => n.startsWith('delete_'))).toEqual(['delete_agent'])
  })

  it('delete_agent is the only action that issues DELETE', async () => {
    for (const t of TOOLS) {
      const fn = mockFetch({})
      const args: Record<string, unknown> =
        t.name === 'update_setting' ? { key: 'default_account', value: 'acc1' } :
        t.name === 'create_agent' || ['get_agent', 'rotate_agent_token', 'delete_agent'].includes(t.name) ? { id: 'bot1' } : {}
      await call('s', t.name, args)
      const method = init(fn).method ?? 'GET'
      expect(method === 'DELETE').toBe(t.name === 'delete_agent')
    }
  })
})

describe('requests', () => {
  it('sends Bearer token and strips trailing slash from base', async () => {
    const fn = mockFetch([])
    await call('s', 'list_agents', {})
    expect(url(fn)).toBe('http://10.10.10.22:8480/api/agents')
    expect(hdrs(fn).Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it.each([
    ['get_health', {}, 'GET', '/api/health'],
    ['get_overview', {}, 'GET', '/api/stats/overview'],
    ['get_agent', { id: 'kemal' }, 'GET', '/api/agents/kemal'],
    ['rotate_agent_token', { id: 'kemal' }, 'POST', '/api/agents/kemal/rotate-token'],
    ['delete_agent', { id: 'kemal' }, 'DELETE', '/api/agents/kemal'],
    ['list_routes', {}, 'GET', '/api/routes'],
    ['get_settings', {}, 'GET', '/api/settings/default-account'],
  ])('%s -> %s %s', async (action, args, method, path) => {
    const fn = mockFetch({})
    await call('s', action, args)
    expect(url(fn)).toBe(`http://10.10.10.22:8480${path}`)
    expect(init(fn).method ?? 'GET').toBe(method)
  })

  it('create_agent posts id and optional name', async () => {
    const fn = mockFetch({ agent: {}, token: 'x' })
    await call('s', 'create_agent', { id: 'bot-1', name: 'Bot One' })
    expect(url(fn)).toBe('http://10.10.10.22:8480/api/agents')
    expect(init(fn).method).toBe('POST')
    expect(JSON.parse(init(fn).body as string)).toEqual({ id: 'bot-1', name: 'Bot One' })
    const fn2 = mockFetch({})
    await call('s', 'create_agent', { id: 'bot2' })
    expect(JSON.parse(init(fn2).body as string)).toEqual({ id: 'bot2' })
  })

  it('update_setting PUTs account_id', async () => {
    const fn = mockFetch({})
    await call('s', 'update_setting', { key: 'default_account', value: 'acc_1' })
    expect(init(fn).method).toBe('PUT')
    expect(url(fn)).toBe('http://10.10.10.22:8480/api/settings/default-account')
    expect(JSON.parse(init(fn).body as string)).toEqual({ account_id: 'acc_1' })
  })

  it('list_feed / list_events build the query string', async () => {
    const fn = mockFetch([])
    await call('s', 'list_feed', { agent_id: 'a1', chat_id: 'tg:42', limit: 10, before_id: 99 })
    expect(url(fn)).toBe('http://10.10.10.22:8480/api/feed?agent_id=a1&chat_id=tg%3A42&limit=10&before_id=99')
    const fn2 = mockFetch([])
    await call('s', 'list_events', { unseen: true })
    expect(url(fn2)).toBe('http://10.10.10.22:8480/api/events?unseen=true&limit=50')
    const fn3 = mockFetch([])
    await call('s', 'list_audit', { limit: 5 })
    expect(url(fn3)).toBe('http://10.10.10.22:8480/api/audit?limit=5')
  })

  it('bounds list output to the requested limit', async () => {
    mockFetch(Array.from({ length: 30 }, (_, i) => ({ id: i })))
    const r = await call('s', 'list_feed', { limit: 5 }) as { items: unknown[]; truncated: boolean }
    expect(r.items).toHaveLength(5)
    expect(r.truncated).toBe(true)
  })
})

describe('validation', () => {
  const BAD_IDS = ['', '../etc', 'a/b', 'a b', 'A', 'x'.repeat(33), 'a?b=1', '%2e%2e', 'a#b', 5, null]
  for (const action of ['get_agent', 'rotate_agent_token', 'delete_agent']) {
    it(`${action} rejects bad ids without calling fetch`, async () => {
      for (const id of BAD_IDS) {
        const fn = mockFetch({})
        await expect(call('s', action, { id })).rejects.toThrow(/"id" must match/)
        expect(fn).not.toHaveBeenCalled()
      }
    })
  }

  it('rejects missing id, unknown args, bad create id/name', async () => {
    const fn = mockFetch({})
    await expect(call('s', 'get_agent', {})).rejects.toThrow()
    await expect(call('s', 'get_agent', { id: 'a', extra: 1 })).rejects.toThrow(/unknown argument/)
    await expect(call('s', 'list_agents', { x: 1 })).rejects.toThrow(/unknown argument/)
    await expect(call('s', 'create_agent', { id: '-lead' })).rejects.toThrow()
    await expect(call('s', 'create_agent', { id: 'ok', name: '' })).rejects.toThrow(/name/)
    await expect(call('s', 'create_agent', { id: 'ok', name: 'x'.repeat(65) })).rejects.toThrow(/name/)
    await expect(call('s', 'create_agent', { id: 'ok', name: 'a\nb' })).rejects.toThrow(/name/)
    await expect(call('s', 'list_feed', { agent_id: '../x' })).rejects.toThrow()
    await expect(call('s', 'list_feed', { limit: 0 })).rejects.toThrow(/limit/)
    await expect(call('s', 'list_feed', { limit: 201 })).rejects.toThrow(/limit/)
    await expect(call('s', 'list_feed', { limit: 1.5 })).rejects.toThrow(/limit/)
    await expect(call('s', 'list_feed', { before_id: 0 })).rejects.toThrow(/before_id/)
    await expect(call('s', 'list_events', { unseen: 'yes' })).rejects.toThrow(/unseen/)
    await expect(call('s', 'update_setting', { key: 'other', value: 'a' })).rejects.toThrow(/key/)
    await expect(call('s', 'update_setting', { key: 'default_account', value: '../x' })).rejects.toThrow(/value/)
    expect(fn).not.toHaveBeenCalled()
  })

  it('unknown tool throws', async () => {
    await expect(call('s', 'update_agent', { id: 'a' })).rejects.toThrow('Unknown Synctropy tool')
  })
})

describe('errors', () => {
  it('maps HTTP statuses', async () => {
    mockFetch({}, 401)
    await expect(call('s', 'list_agents', {})).rejects.toThrow('401 Unauthorized')
    mockFetch({}, 404)
    await expect(call('s', 'get_agent', { id: 'nope' })).rejects.toThrow('404 Not Found')
    mockFetch({ detail: 'agent already exists' }, 409)
    await expect(call('s', 'create_agent', { id: 'dup' })).rejects.toThrow('HTTP 409')
  })

  it('never leaks the token, even if upstream echoes it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => `boom ${TOKEN}` }))
    const err = await call('s', 'list_agents', {}).catch((e: Error) => e)
    expect((err as Error).message).toContain('HTTP 500')
    expect((err as Error).message).not.toContain(TOKEN)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`dial failed ${TOKEN}`)))
    const err2 = await call('s', 'get_health', {}).catch((e: Error) => e)
    expect((err2 as Error).message).not.toContain(TOKEN)
  })
})

describe('ping', () => {
  it('ok on success, using an authenticated endpoint', async () => {
    const fn = mockFetch({})
    expect(await ping('s')).toEqual({ ok: true })
    expect(url(fn)).toContain('/api/settings/default-account')
    expect(hdrs(fn).Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('reports failure without the token', async () => {
    mockFetch({}, 401)
    const r = await ping('s')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('401')
    expect(JSON.stringify(r)).not.toContain(TOKEN)
  })
})
