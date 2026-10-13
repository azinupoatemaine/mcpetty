// Synctropy (agent console) — native handler over the console REST API (/api, Bearer console token).
// The agent-facing /api/agent/v1 surface is deliberately NOT exposed here.
//
// Endpoint map (kemal-console backend/app/api/routes.py):
//   get_health          GET    /api/health
//   get_overview        GET    /api/stats/overview
//   list_agents         GET    /api/agents
//   get_agent           GET    /api/agents/{id}
//   create_agent        POST   /api/agents                      body {id, name?}   (returns one-time token)
//   rotate_agent_token  POST   /api/agents/{id}/rotate-token                       (returns one-time token)
//   delete_agent        DELETE /api/agents/{id}
//   list_feed           GET    /api/feed
//   list_events         GET    /api/events
//   list_routes         GET    /api/routes
//   list_audit          GET    /api/audit
//   get_settings        GET    /api/settings/default-account    (the only settings endpoint)
//   update_setting      PUT    /api/settings/default-account    body {account_id}
// Skipped (no REST endpoint): update_agent — the console API has no agent PATCH/PUT.
import { getCredential } from '../db'
import type { MCPTool } from '../mcp-client'
import { restFetch } from './http'

// ─── Validation ───────────────────────────────────────────────────────────────

const ID_RE        = /^[a-z0-9_-]{1,32}$/
const CREATE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/      // backend AgentCreateIn.id pattern
const CHAT_ID_RE   = /^[A-Za-z0-9_:-]{1,64}$/
const ACCOUNT_RE   = /^[A-Za-z0-9_-]{1,64}$/
const SETTING_KEYS = ['default_account'] as const

const DEFAULT_LIMIT = 50
const MAX_LIMIT     = 200
const MAX_NAME_LEN  = 64
const MAX_OUT_CHARS = 60_000

function checkKeys(action: string, args: Record<string, unknown>, allowed: string[]): void {
  for (const k of Object.keys(args)) {
    if (!allowed.includes(k)) throw new Error(`${action}: unknown argument "${k}" (allowed: ${allowed.join(', ') || 'none'})`)
  }
}

function idArg(action: string, args: Record<string, unknown>, key: string, re: RegExp = ID_RE): string {
  const v = args[key]
  if (typeof v !== 'string' || !re.test(v)) throw new Error(`${action}: "${key}" must match ${re.source}`)
  return v
}

function optIdArg(action: string, args: Record<string, unknown>, key: string, re: RegExp = ID_RE): string | undefined {
  return args[key] === undefined ? undefined : idArg(action, args, key, re)
}

function intArg(action: string, args: Record<string, unknown>, key: string, min: number, max: number, dflt?: number): number | undefined {
  const v = args[key]
  if (v === undefined) return dflt
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${action}: "${key}" must be an integer between ${min} and ${max}`)
  }
  return v
}

function nameArg(action: string, args: Record<string, unknown>): string | undefined {
  const v = args.name
  if (v === undefined) return undefined
  if (typeof v !== 'string' || v.trim().length < 1 || v.length > MAX_NAME_LEN || /[\x00-\x1f\x7f]/.test(v)) {
    throw new Error(`${action}: "name" must be a 1-${MAX_NAME_LEN} character string without control characters`)
  }
  return v.trim()
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.set(k, String(v))
  const s = u.toString()
  return s ? `?${s}` : ''
}

// Bound output: slice to `limit`, then halve until the serialised size fits.
function bound(data: unknown, limit: number): unknown {
  if (!Array.isArray(data)) return data
  let items = data.slice(0, limit)
  while (items.length > 1 && JSON.stringify(items).length > MAX_OUT_CHARS) items = items.slice(0, Math.ceil(items.length / 2))
  return { items, returned: items.length, truncated: items.length < data.length }
}

// ─── Tools ────────────────────────────────────────────────────────────────────

const LIMIT   = { type: 'number', description: `Max items to return (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT})` }
const AGENT_Q = { type: 'string', description: 'Filter by agent id (a-z, 0-9, _ or -, max 32 chars)' }
const CHAT_Q  = { type: 'string', description: 'Filter by chat id' }
const BEFORE  = { type: 'number', description: 'Pagination: only items with id below this value' }
const AGENT_ID = { type: 'string', description: 'Agent id (a-z, 0-9, _ or -, max 32 chars)' }

export const TOOLS: MCPTool[] = [
  { name: 'get_health',   description: 'Console health status (unauthenticated endpoint; also confirms reachability).', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_overview', description: 'Today overview — agent counts, message/cost stats, pending items.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_agents',  description: 'List all registered agents with status, last heartbeat and paused state.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'get_agent',
    description: 'Get one agent by id.',
    inputSchema: { type: 'object', properties: { id: AGENT_ID }, required: ['id'] },
  },
  {
    name: 'create_agent',
    description: 'Create a pending agent. The response includes its one-time API token — it cannot be retrieved again.',
    inputSchema: {
      type: 'object',
      properties: { id: { ...AGENT_ID, description: 'New agent id (starts with a-z or 0-9; a-z, 0-9, _ or -; max 32 chars)' }, name: { type: 'string', description: `Display name (1-${MAX_NAME_LEN} chars, defaults to id)` } },
      required: ['id'],
    },
  },
  {
    name: 'rotate_agent_token',
    description: 'Issue a new token for an agent, invalidating the old one. The response includes the new one-time token.',
    inputSchema: { type: 'object', properties: { id: AGENT_ID }, required: ['id'] },
  },
  {
    name: 'delete_agent',
    description: 'Permanently delete an agent by id. Destructive.',
    inputSchema: { type: 'object', properties: { id: AGENT_ID }, required: ['id'] },
  },
  {
    name: 'list_feed',
    description: 'Recent activity feed items (newest first), optionally filtered by agent or chat.',
    inputSchema: { type: 'object', properties: { agent_id: AGENT_Q, chat_id: CHAT_Q, limit: LIMIT, before_id: BEFORE } },
  },
  {
    name: 'list_events',
    description: 'Agent events (newest first), optionally filtered by agent, chat, or unseen state.',
    inputSchema: { type: 'object', properties: { agent_id: AGENT_Q, chat_id: CHAT_Q, unseen: { type: 'boolean', description: 'Only unseen (true) or only seen (false) events' }, limit: LIMIT, before_id: BEFORE } },
  },
  { name: 'list_routes', description: 'Message routes reported by registered agents.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'list_audit',
    description: 'Audit log of console actions (newest first).',
    inputSchema: { type: 'object', properties: { limit: LIMIT } },
  },
  { name: 'get_settings', description: 'Console settings (currently the default account).', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'update_setting',
    description: `Update a console setting. Only key "default_account" is supported; value is the account id.`,
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string', enum: [...SETTING_KEYS], description: 'Setting key' }, value: { type: 'string', description: 'New value (account id)' } },
      required: ['key', 'value'],
    },
  },
]

// ─── Credentials ──────────────────────────────────────────────────────────────

function cfg(instanceId: string) {
  const url   = getCredential(instanceId, 'SYNCTROPY_URL')
  const token = getCredential(instanceId, 'SYNCTROPY_TOKEN')
  if (!url || !token) throw new Error('Synctropy credentials not configured. Set SYNCTROPY_URL and SYNCTROPY_TOKEN.')
  return { base: url.replace(/\/$/, ''), token }
}

// Defence in depth: restFetch never echoes the token, but scrub it from anything we rethrow.
function scrub(e: unknown, token: string): Error {
  const msg = e instanceof Error ? e.message : 'Unknown error'
  return new Error(token ? msg.split(token).join('[redacted]') : msg)
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

export async function ping(instanceId: string): Promise<{ ok: boolean; error?: string }> {
  let token = ''
  try {
    const c = cfg(instanceId)
    token = c.token
    // An authenticated, cheap endpoint — /api/health is open and would not prove the token works.
    await restFetch(c.base, '/api/settings/default-account', c.token)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: scrub(e, token).message }
  }
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export async function call(instanceId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const { base, token } = cfg(instanceId)
  const a = args ?? {}
  const get = <T>(path: string) => restFetch<T>(base, path, token)

  try {
    switch (toolName) {
      case 'get_health':
        checkKeys(toolName, a, [])
        return await get('/api/health')
      case 'get_overview':
        checkKeys(toolName, a, [])
        return await get('/api/stats/overview')
      case 'list_agents':
        checkKeys(toolName, a, [])
        return bound(await get('/api/agents'), MAX_LIMIT)
      case 'get_agent': {
        checkKeys(toolName, a, ['id'])
        return await get(`/api/agents/${idArg(toolName, a, 'id')}`)
      }
      case 'create_agent': {
        checkKeys(toolName, a, ['id', 'name'])
        const id = idArg(toolName, a, 'id', CREATE_ID_RE)
        const name = nameArg(toolName, a)
        return await restFetch(base, '/api/agents', token, 'Authorization', 'Bearer', {
          method: 'POST', body: JSON.stringify(name === undefined ? { id } : { id, name }),
        })
      }
      case 'rotate_agent_token': {
        checkKeys(toolName, a, ['id'])
        return await restFetch(base, `/api/agents/${idArg(toolName, a, 'id')}/rotate-token`, token, 'Authorization', 'Bearer', { method: 'POST' })
      }
      case 'delete_agent': {
        checkKeys(toolName, a, ['id'])
        return await restFetch(base, `/api/agents/${idArg(toolName, a, 'id')}`, token, 'Authorization', 'Bearer', { method: 'DELETE' })
      }
      case 'list_feed': {
        checkKeys(toolName, a, ['agent_id', 'chat_id', 'limit', 'before_id'])
        const limit = intArg(toolName, a, 'limit', 1, MAX_LIMIT, DEFAULT_LIMIT)!
        const q = qs({
          agent_id: optIdArg(toolName, a, 'agent_id'), chat_id: optIdArg(toolName, a, 'chat_id', CHAT_ID_RE),
          limit, before_id: intArg(toolName, a, 'before_id', 1, Number.MAX_SAFE_INTEGER),
        })
        return bound(await get(`/api/feed${q}`), limit)
      }
      case 'list_events': {
        checkKeys(toolName, a, ['agent_id', 'chat_id', 'unseen', 'limit', 'before_id'])
        const limit = intArg(toolName, a, 'limit', 1, MAX_LIMIT, DEFAULT_LIMIT)!
        if (a.unseen !== undefined && typeof a.unseen !== 'boolean') throw new Error(`${toolName}: "unseen" must be a boolean`)
        const q = qs({
          agent_id: optIdArg(toolName, a, 'agent_id'), chat_id: optIdArg(toolName, a, 'chat_id', CHAT_ID_RE),
          unseen: a.unseen as boolean | undefined, limit, before_id: intArg(toolName, a, 'before_id', 1, Number.MAX_SAFE_INTEGER),
        })
        return bound(await get(`/api/events${q}`), limit)
      }
      case 'list_routes':
        checkKeys(toolName, a, [])
        return await get('/api/routes')
      case 'list_audit': {
        checkKeys(toolName, a, ['limit'])
        const limit = intArg(toolName, a, 'limit', 1, MAX_LIMIT, DEFAULT_LIMIT)!
        return bound(await get(`/api/audit${qs({ limit })}`), limit)
      }
      case 'get_settings':
        checkKeys(toolName, a, [])
        return await get('/api/settings/default-account')
      case 'update_setting': {
        checkKeys(toolName, a, ['key', 'value'])
        if (a.key !== 'default_account') throw new Error(`${toolName}: "key" must be one of: ${SETTING_KEYS.join(', ')}`)
        const value = a.value
        if (typeof value !== 'string' || !ACCOUNT_RE.test(value)) throw new Error(`${toolName}: "value" must match ${ACCOUNT_RE.source}`)
        return await restFetch(base, '/api/settings/default-account', token, 'Authorization', 'Bearer', {
          method: 'PUT', body: JSON.stringify({ account_id: value }),
        })
      }
      default:
        throw new Error(`Unknown Synctropy tool: ${toolName}`)
    }
  } catch (e) {
    throw scrub(e, token)
  }
}
