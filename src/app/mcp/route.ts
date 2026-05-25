import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { getInstalledMCPs, isToolEnabled, isToolEnabledForGateway, findGatewayByKeyHash, getGatewayInstances, getCredential, logToolCall, getRateLimit, getSettingsMap, getDescriptionOverrides, matchesApprovalRule, createApprovalRequest, getApprovalRequest, storeApprovalResult, getActionSnapshot, setActionSnapshot, isDiffShown, markDiffShown, logSchemaTokens } from '../../lib/db'
import { findCatalogEntry } from '../../lib/mcp-catalog'
import { initSession, listTools, callTool, MCPTool } from '../../lib/mcp-client'
import { NATIVE } from '../../lib/native'
import { getGatewayApiKey, hashGatewayKey } from '../../lib/crypto'
import { getStdioBridge } from '../../lib/process-manager'

export const dynamic = 'force-dynamic'

// ── In-memory cache (max TTL 120s, cleaned lazily) ────────────────────────────
interface CacheEntry { result: unknown; expiresAt: number }
const toolCache = new Map<string, CacheEntry>()

function ck(platform: string, action: string, args: Record<string, unknown>): string {
  return `${platform}:${action}:${JSON.stringify(Object.fromEntries(Object.entries(args).sort()))}`
}

// ── Pagination cache (TTL 10min, max 200 entries) ─────────────────────────────
interface PageEntry { items: unknown[]; pageSize: number; expiresAt: number }
const pageCache = new Map<string, PageEntry>()
const PAGE_SIZE = 50
const PAGE_TTL  = 10 * 60 * 1000

function sweepCache() {
  const now = Date.now()
  for (const [k, e] of toolCache) if (now >= e.expiresAt) toolCache.delete(k)
  for (const [k, e] of pageCache) if (now >= e.expiresAt) pageCache.delete(k)
}

// ── In-memory rate-limit sliding windows ──────────────────────────────────────
const rlWindows = new Map<string, number[]>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeJsonArr(v: string | undefined): string[] {
  if (!v) return []
  try { return JSON.parse(v) as string[] } catch { return [] }
}

const INJECTION_PATTERNS = [
  'ignore previous instructions', 'ignore all previous', 'disregard your',
  'forget your instructions', 'new instructions:', 'you are now', 'jailbreak',
  'override your', 'act as if', 'pretend you are', 'system prompt',
]

function hasInjection(result: unknown, extra: string[]): boolean {
  const text = (typeof result === 'string' ? result : JSON.stringify(result)).toLowerCase()
  return [...INJECTION_PATTERNS, ...extra].some((p) => text.includes(p.toLowerCase()))
}

const DEFAULT_REDACT_KEYS = ['password', 'passwd', 'token', 'secret', 'api_key', 'apikey', 'credential', 'auth']

function deepRedact(obj: unknown, keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map((item) => deepRedact(item, keys))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = keys.some((key) => k.toLowerCase() === key.toLowerCase()) ? '[REDACTED]' : deepRedact(v, keys)
  }
  return out
}

function redact(args: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return deepRedact(args, [...DEFAULT_REDACT_KEYS, ...keys]) as Record<string, unknown>
}

function matchesTrigger(platform: string, action: string, triggers: string[]): boolean {
  if (!triggers.length) return true
  return triggers.some((t) => {
    const colon = t.indexOf(':')
    if (colon === -1) return false
    const p = t.slice(0, colon)
    const a = t.slice(colon + 1)
    return p === platform && (a === '*' || a === action)
  })
}

function fireWebhook(url: string, payload: object): void {
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .catch(() => { /* fire-and-forget */ })
}

const sessions = new Map<string, { created: number }>()
const SESSION_TTL = 30 * 60 * 1000

const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18']
const LATEST_PROTOCOL_VERSION     = '2025-06-18'

function cleanSessions() {
  const now = Date.now()
  for (const [k, v] of sessions) {
    if (now - v.created > SESSION_TTL) sessions.delete(k)
  }
}

// ── Fix #1: Origin header validation (DNS rebinding prevention) ────────────────
function checkOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true  // no Origin = direct API call (Claude Code CLI), allow

  try {
    const { hostname } = new URL(origin)
    // Allow localhost and private LAN ranges
    return (
      hostname === 'localhost'                             ||
      hostname === '127.0.0.1'                            ||
      /^192\.168\./.test(hostname)                        ||
      /^10\./.test(hostname)                              ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)        ||
      hostname.endsWith('.local')
    )
  } catch {
    return false
  }
}

type GatewayCtx = { id: string; name: string; instanceIds: string[]; contextPrefix: string } | null

function resolveGateway(req: NextRequest): GatewayCtx | false {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return false
  const key = auth.slice(7)
  if (key === getGatewayApiKey()) return null  // master key — full access
  const hash = hashGatewayKey(key)
  const gw = findGatewayByKeyHash(hash)
  if (!gw) return false
  return { id: gw.id, name: gw.name, instanceIds: getGatewayInstances(gw.id), contextPrefix: gw.contextPrefix }
}

// ── Fix #2: Protocol version validation ───────────────────────────────────────
function checkProtocolVersion(req: NextRequest): { ok: boolean; version: string } {
  const header = req.headers.get('mcp-protocol-version')
  if (!header) return { ok: true, version: '2025-03-26' }  // spec default when absent
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(header)) return { ok: false, version: header }
  return { ok: true, version: header }
}

// ── Fix #3 & #4: Spec-compliant tool result format ────────────────────────────
// Tool results MUST use { content: [...], isError: false } — not raw JSON.
// Tool execution errors MUST use { content: [...], isError: true } — not JSON-RPC error.

function toolResult(result: unknown): unknown {
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
  return {
    content:         [{ type: 'text', text }],
    structuredContent: Array.isArray(result) ? { items: result } : (result && typeof result === 'object' ? result : { value: result }),
    isError:         false,
  }
}

function toolError(message: string): unknown {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

function buildPlatformTool(id: string, type: string, name: string, description: string, tools: MCPTool[], gatewayId?: string, descOverrides?: Record<string, string>): MCPTool {
  const enabled = tools.filter((t) => gatewayId
    ? isToolEnabledForGateway(gatewayId, id, t.name, type)
    : isToolEnabled(id, t.name, type)
  )

  // Collect union of all arg properties across enabled tools (typed, not untyped blob)
  const allArgProps: Record<string, unknown> = {}
  for (const t of enabled) {
    for (const [k, v] of Object.entries(t.inputSchema?.properties ?? {})) {
      if (!allArgProps[k]) allArgProps[k] = v
    }
  }
  if (!allArgProps['token'])       allArgProps['token']       = { type: 'string', description: 'Pagination token from next_page_token field of a previous response' }
  if (!allArgProps['approval_id']) allArgProps['approval_id'] = { type: 'string', description: 'Approval ID returned with APPROVAL_REQUIRED' }

  // Encode per-action signatures in description so the model knows what args each action expects
  const actionLines = enabled.map((t) => {
    const req   = new Set(t.inputSchema?.required ?? [])
    const props = t.inputSchema?.properties ?? {}
    const parts = Object.entries(props).map(([k, v]: [string, any]) =>
      `${k}${req.has(k) ? '*' : ''}(${v.type ?? 'any'})${v.description ? ': ' + v.description : ''}`
    )
    const desc = descOverrides?.[t.name] ?? t.description ?? ''
    return parts.length > 0
      ? `${t.name}: ${desc} [args: ${parts.join(', ')}]`
      : `${t.name}: ${desc}`
  })

  actionLines.push('get_page: Fetch the next page of a large result — call when a response includes next_page_token [args: token*(string): the next_page_token value]')
  actionLines.push('check_approval: Poll the status of a pending approval request [args: approval_id*(string): the ID returned with APPROVAL_REQUIRED]')

  const hasArgProps = Object.keys(allArgProps).length > 0

  return {
    name: id,
    description: `${description}\n\nActions (* = required arg):\n${actionLines.join('\n')}`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...enabled.map((t) => t.name), 'get_page', 'check_approval'] },
        args: hasArgProps
          ? { type: 'object', properties: allArgProps, additionalProperties: false }
          : { type: 'object', properties: {}, additionalProperties: false },
        nocache: { type: 'boolean', description: 'Pass true to bypass the output cache and request a fresh result.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  }
}

async function getPlatformTools(instanceId: string, type: string, port: number): Promise<MCPTool[] | null> {
  const entry = findCatalogEntry(type)
  if (!entry) return null

  if (entry.transport === 'native') {
    const handler = NATIVE[type]
    if (!handler) return null
    const { ok } = await handler.ping(instanceId)
    return ok ? handler.tools : null
  }

  if (entry.transport === 'stdio') {
    const bridge = getStdioBridge(instanceId)
    if (!bridge) return null
    try { return await bridge.listTools() } catch { return null }
  }

  if (entry.transport === 'http-proxy') {
    const url   = getCredential(instanceId, 'MCP_URL')
    const token = getCredential(instanceId, 'MCP_TOKEN')
    if (!url) return null
    try {
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
      const { sessionId } = await initSession(url, headers)
      return await listTools(url, sessionId, headers)
    } catch { return null }
  }

  try {
    const url = `http://127.0.0.1:${port}/mcp`
    const { sessionId } = await initSession(url)
    return await listTools(url, sessionId)
  } catch { return null }
}

async function collectPlatforms(gwCtx: GatewayCtx): Promise<MCPTool[]> {
  let installed = getInstalledMCPs()
  if (gwCtx !== null) installed = installed.filter((m) => gwCtx.instanceIds.includes(m.instanceId))
  const platforms: MCPTool[] = []

  await Promise.all(
    installed.map(async ({ instanceId, type, name, port, tags }) => {
      const entry = findCatalogEntry(type)
      if (!entry) return
      try {
        const tools       = await getPlatformTools(instanceId, type, port)
        const overrides   = getDescriptionOverrides(instanceId)
        const prefix      = tags.length ? tags.map((t) => `[${t}]`).join('') + ' ' : ''
        const description = prefix + entry.description
        if (tools) platforms.push(buildPlatformTool(instanceId, type, name, description, tools, gwCtx?.id, overrides))
      } catch { /* unavailable — skip */ }
    })
  )

  return platforms
}

async function executeTool(instanceId: string, type: string, port: number, action: string, args: Record<string, unknown>): Promise<unknown> {
  const entry = findCatalogEntry(type)
  if (!entry) throw new Error(`Type "${type}" not in catalog`)

  if (entry.transport === 'native') {
    const handler = NATIVE[type]
    if (!handler) throw new Error(`No native handler for type "${type}"`)
    return handler.call(instanceId, action, args)
  }

  if (entry.transport === 'stdio') {
    const bridge = getStdioBridge(instanceId)
    if (!bridge) throw new Error(`Stdio process not running for "${instanceId}"`)
    return bridge.callTool(action, args)
  }

  if (entry.transport === 'http-proxy') {
    const url   = getCredential(instanceId, 'MCP_URL')
    const token = getCredential(instanceId, 'MCP_TOKEN')
    if (!url) throw new Error('MCP_URL not configured')
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
    return callTool(url, headers, action, args)
  }

  return callTool(`http://127.0.0.1:${port}/mcp`, {}, action, args)
}

function rpcOk(id: unknown, result: unknown): NextResponse {
  return NextResponse.json({ jsonrpc: '2.0', id, result })
}

function rpcErr(id: unknown, code: number, message: string): NextResponse {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } })
}

export async function POST(req: NextRequest) {
  // Fix #1 — Origin validation
  if (!checkOrigin(req)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const gateway = resolveGateway(req)
  if (gateway === false) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized — add Authorization: Bearer <key> header (get key from MCPetty dashboard)' } },
      { status: 401 }
    )
  }

  // Fix #2 — Protocol version validation
  const proto = checkProtocolVersion(req)
  if (!proto.ok) {
    return new NextResponse(`Unsupported MCP-Protocol-Version: ${proto.version}`, { status: 400 })
  }

  let body: { method?: string; id?: unknown; params?: Record<string, unknown> }
  try { body = await req.json() }
  catch { return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) }

  const { method, id, params } = body

  if (method === 'notifications/initialized') return new NextResponse(null, { status: 202 })

  if (method === 'initialize') {
    cleanSessions()
    const sessionId = randomBytes(16).toString('hex')
    sessions.set(sessionId, { created: Date.now() })
    const res = rpcOk(id, {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities:    { tools: { listChanged: false } },
      serverInfo:      { name: 'MCPetty', version: '1.0.4' },
      instructions:    "One tool per platform. Call with { action: '<action>', args: { ... } }. Available actions are listed in each tool's description.",
    })
    res.headers.set('mcp-session-id', sessionId)
    return res
  }

  if (method === 'tools/list') {
    const tools = await collectPlatforms(gateway)
    try {
      const breakdown: Record<string, number> = {}
      let total = 0
      for (const t of tools) {
        const tokens = Math.ceil((t.name.length + (t.description?.length ?? 0) + JSON.stringify(t.inputSchema).length) / 4)
        breakdown[t.name] = tokens
        total += tokens
      }
      logSchemaTokens(gateway?.id ?? null, total, JSON.stringify(breakdown))
    } catch { /* never let token logging break tools/list */ }
    return rpcOk(id, { tools })
  }

  if (method === 'tools/call') {
    sweepCache()

    const platformId = (params?.name as string) ?? ''
    const callArgs   = (params?.arguments as Record<string, unknown>) ?? {}
    const action     = (callArgs.action as string) ?? ''
    const args       = (callArgs.args   as Record<string, unknown>) ?? {}

    if (!platformId) return rpcErr(id, -32602, 'Tool name (platform id) required')
    if (!action)     return rpcErr(id, -32602, '"action" field required in arguments')

    const installed = getInstalledMCPs().find((m) => m.instanceId === platformId)
    if (!installed)  return rpcErr(id, -32602, `Platform "${platformId}" is not installed`)
    if (gateway !== null && !gateway.instanceIds.includes(platformId)) return rpcErr(id, -32602, `Platform "${platformId}" not in this gateway's scope`)
    const toolEnabled = gateway !== null
      ? isToolEnabledForGateway(gateway.id, platformId, action, installed.type)
      : isToolEnabled(platformId, action, installed.type)
    if (!toolEnabled) return rpcErr(id, -32602, `Action "${action}" is disabled`)

    // Check approval status
    if (action === 'check_approval') {
      const approvalId = (args.approval_id as string) ?? ''
      if (!approvalId) return rpcOk(id, toolError('check_approval requires args.approval_id'))
      const req2 = getApprovalRequest(approvalId)
      if (!req2) return rpcOk(id, toolError(`Approval "${approvalId}" not found`))
      if (req2.instanceId !== platformId) return rpcOk(id, toolError('Approval belongs to a different platform'))
      if (req2.status === 'pending') return rpcOk(id, toolResult('Still waiting for human approval. Try again in a few seconds.'))
      if (req2.status === 'rejected') return rpcOk(id, toolResult(`Action rejected by human. Reason: ${req2.rejectReason ?? 'none given'}. Do not retry automatically.`))
      // approved
      if (req2.resultJson) return rpcOk(id, toolResult(JSON.parse(req2.resultJson)))
      try {
        const raw = await executeTool(platformId, installed.type, installed.port, req2.action, JSON.parse(req2.argsJson))
        storeApprovalResult(approvalId, JSON.stringify(raw))
        return rpcOk(id, toolResult(raw))
      } catch (e) {
        return rpcOk(id, toolError(e instanceof Error ? e.message : 'Execution failed'))
      }
    }

    // Pagination fetch — no backend call, no rate-limit, no cache needed
    if (action === 'get_page') {
      sweepCache()
      const token = (args.token as string) ?? ''
      const sep   = token.lastIndexOf(':')
      if (!token || sep < 0) return rpcOk(id, toolError('get_page requires args.token from a previous paginated response'))
      const uuid   = token.slice(0, sep)
      const offset = parseInt(token.slice(sep + 1), 10)
      const entry  = pageCache.get(uuid)
      if (!entry || Date.now() >= entry.expiresAt) return rpcOk(id, toolError('Page token expired (10 min TTL). Re-run the original action.'))
      const slice   = entry.items.slice(offset, offset + entry.pageSize)
      const nextOff = offset + entry.pageSize
      return rpcOk(id, toolResult({
        items:    slice,
        returned: slice.length,
        total:    entry.items.length,
        offset,
        ...(nextOff < entry.items.length ? { next_page_token: `${uuid}:${nextOff}` } : {}),
      }))
    }

    // Load settings once (before cache + rate limit so both can use them)
    const s          = getSettingsMap()
    const cacheOn    = s.cache_enabled === 'true'
    const cacheTtl   = Math.min(Math.max(Number(s.cache_ttl_secs) || 60, 1), 120)
    const injOn      = s.injection_enabled === 'true'
    const injExtra   = injOn      ? safeJsonArr(s.injection_patterns) : []
    const webhookOn  = s.webhook_enabled === 'true'
    const webhookUrl = s.webhook_url ?? ''
    const wTriggers  = webhookOn  ? safeJsonArr(s.webhook_triggers)  : []
    const redactOn   = s.redaction_enabled === 'true'
    const redactKeys = redactOn   ? safeJsonArr(s.redaction_keys)    : []

    // nocache lives at the top-level callArgs (not inside args) so the schema allows it
    const nocache    = callArgs.nocache === true
    const cleanArgs: Record<string, unknown> = { ...args }

    const sessionId  = req.headers.get('mcp-session-id') ?? undefined
    const gwPayload  = { id: gateway?.id ?? null, name: gateway?.name ?? 'master' }

    // Approval gate
    if (matchesApprovalRule(platformId, action)) {
      const approvalId = randomBytes(6).toString('hex')
      createApprovalRequest(platformId, action, JSON.stringify(cleanArgs), approvalId)
      const dashHost = req.headers.get('host') ?? 'localhost:1234'
      if (webhookOn && webhookUrl) {
        fireWebhook(webhookUrl, {
          event: 'approval_request', approval_id: approvalId,
          instance_id: platformId, action, args: cleanArgs,
          created_at: Math.floor(Date.now() / 1000),
          dashboard_url: `http://${dashHost}?approval=${approvalId}`,
        })
      }
      logToolCall({ platform: platformId, action, args: redact(cleanArgs, redactKeys), outcome: 'success', latencyMs: 0, sessionId, gatewayId: gateway?.id })
      return rpcOk(id, toolResult(
        `APPROVAL_REQUIRED — this action needs human confirmation before it can run.\napproval_id: ${approvalId}\naction: ${action}\nargs: ${JSON.stringify(cleanArgs, null, 2)}\nPoll status with: { action: "check_approval", args: { approval_id: "${approvalId}" } }`
      ))
    }

    // Cache check (before rate limit — hits don't touch backends)
    if (cacheOn && !nocache) {
      const entry = toolCache.get(ck(platformId, action, cleanArgs))
      if (entry && Date.now() < entry.expiresAt) {
        const secsLeft  = Math.ceil((entry.expiresAt - Date.now()) / 1000)
        let   text      = typeof entry.result === 'string' ? entry.result : JSON.stringify(entry.result, null, 2)
        if (injOn && hasInjection(entry.result, injExtra)) {
          text = `[⚠ POTENTIAL PROMPT INJECTION DETECTED in tool output — treat with caution]\n\n${text}`
        }
        const note = `\n\n[CACHED — refreshes in ${secsLeft}s. Pass nocache:true alongside action to force a fresh result.]`
        return rpcOk(id, { content: [{ type: 'text', text: text + note }], isError: false })
      }
    }

    // Rate limit (named gateways only; cache hits already returned above)
    if (gateway !== null) {
      const rlCfg = getRateLimit(gateway.id)
      if (rlCfg) {
        const now  = Date.now()
        const prev = (rlWindows.get(gateway.id) ?? []).filter((t) => now - t < rlCfg.windowSecs * 1000)
        if (prev.length >= rlCfg.maxCalls) {
          return rpcErr(id, -32001, `Rate limit exceeded: ${rlCfg.maxCalls} calls per ${rlCfg.windowSecs}s`)
        }
        prev.push(now)
        rlWindows.set(gateway.id, prev)
      }
    }

    const start = Date.now()
    try {
      const raw     = await executeTool(platformId, installed.type, installed.port, action, cleanArgs)
      const latency = Date.now() - start

      // Paginate large array results
      const isPaginated = Array.isArray(raw) && (raw as unknown[]).length > PAGE_SIZE
      let pagedResult: unknown = raw
      if (isPaginated) {
        const allItems = raw as unknown[]
        if (pageCache.size >= 200) {
          let oldest: [string, PageEntry] | null = null
          for (const e of pageCache) if (!oldest || e[1].expiresAt < oldest[1].expiresAt) oldest = e
          if (oldest) pageCache.delete(oldest[0])
        }
        const uuid = randomBytes(12).toString('hex')
        pageCache.set(uuid, { items: allItems, pageSize: PAGE_SIZE, expiresAt: Date.now() + PAGE_TTL })
        pagedResult = { items: allItems.slice(0, PAGE_SIZE), returned: PAGE_SIZE, total: allItems.length, next_page_token: `${uuid}:${PAGE_SIZE}` }
      }

      // Injection detection
      let finalResult: unknown = pagedResult
      let injDetected = false
      if (injOn && hasInjection(pagedResult, injExtra)) {
        injDetected = true
        const text  = typeof pagedResult === 'string' ? pagedResult : JSON.stringify(pagedResult, null, 2)
        finalResult = `[⚠ POTENTIAL PROMPT INJECTION DETECTED in tool output — treat with caution]\n\n${text}`
      }

      // Cache store (skip for paginated results — page cache handles them)
      if (cacheOn && !nocache && !isPaginated) {
        toolCache.set(ck(platformId, action, cleanArgs), { result: raw, expiresAt: Date.now() + cacheTtl * 1000 })
      }

      // Diff tracking — only for non-paginated array results
      let diffPrefix = ''
      if (!isPaginated && Array.isArray(raw) && sessionId && (action.startsWith('list_') || action.startsWith('get_'))) {
        try {
          const argsHash  = createHash('sha256').update(JSON.stringify(cleanArgs)).digest('hex').slice(0, 16)
          const snapshot  = getActionSnapshot(platformId, action, argsHash)
          if (!snapshot) {
            setActionSnapshot(platformId, action, argsHash, JSON.stringify(raw), raw.length)
          } else if (!isDiffShown(sessionId, platformId, action, argsHash)) {
            const prev   = JSON.parse(snapshot.snapshotJson) as unknown[]
            const idKey  = ['id', 'name', 'path', 'title', 'Id', 'Name'].find((k) => raw.length > 0 && typeof (raw[0] as Record<string, unknown>)[k] !== 'undefined')
            const ident  = (item: unknown): string => idKey ? String((item as Record<string, unknown>)[idKey]) : JSON.stringify(item)
            const prevSet = new Set(prev.map(ident))
            const newSet  = new Set(raw.map(ident))
            const added   = raw.filter((i) => !prevSet.has(ident(i))).map(ident)
            const removed = prev.filter((i) => !newSet.has(ident(i))).map(ident)
            if (added.length > 0 || removed.length > 0) {
              markDiffShown(sessionId, platformId, action, argsHash)
              setActionSnapshot(platformId, action, argsHash, JSON.stringify(raw), raw.length)
              const parts: string[] = []
              if (added.length)   parts.push(`+${added.length} added: ${added.slice(0, 5).join(', ')}${added.length > 5 ? ` …+${added.length - 5}` : ''}`)
              if (removed.length) parts.push(`-${removed.length} removed: ${removed.slice(0, 5).join(', ')}${removed.length > 5 ? ` …+${removed.length - 5}` : ''}`)
              diffPrefix = `[CHANGES SINCE LAST SESSION: ${parts.join(', ')}]\n${'─'.repeat(40)}\n`
            } else {
              setActionSnapshot(platformId, action, argsHash, JSON.stringify(raw), raw.length)
            }
          }
        } catch { /* diff failures never break the call */ }
      }

      // Context prefix injection (named gateway only)
      let ctxPrefix = ''
      if (gateway?.contextPrefix?.trim()) {
        ctxPrefix = gateway.contextPrefix.trim() + '\n\n' + '─'.repeat(40) + '\n\n'
      }

      // Compose final text output
      if (diffPrefix || ctxPrefix) {
        const base = typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult, null, 2)
        finalResult = ctxPrefix + diffPrefix + base
      }

      // Webhook (fire-and-forget)
      if (webhookOn && webhookUrl && matchesTrigger(platformId, action, wTriggers)) {
        const preview = (typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult)).slice(0, 500)
        fireWebhook(webhookUrl, {
          event: 'tool_call', timestamp: new Date().toISOString(),
          gateway: gwPayload, platform: platformId, action, args: redact(cleanArgs, redactKeys),
          outcome: 'success', latency_ms: latency, injection_detected: injDetected, result_preview: preview,
        })
      }

      const resultStr = typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult)
      logToolCall({ platform: platformId, action, args: redact(cleanArgs, redactKeys), outcome: 'success', latencyMs: latency, sessionId, gatewayId: gateway?.id, userAgent: req.headers.get('user-agent') ?? undefined, resultJson: resultStr })
      return rpcOk(id, toolResult(finalResult))
    } catch (e) {
      const latency = Date.now() - start
      const msg     = e instanceof Error ? e.message : 'Tool call failed'

      if (webhookOn && webhookUrl && matchesTrigger(platformId, action, wTriggers)) {
        fireWebhook(webhookUrl, {
          event: 'tool_call', timestamp: new Date().toISOString(),
          gateway: gwPayload, platform: platformId, action, args: redact(cleanArgs, redactKeys),
          outcome: 'error', latency_ms: latency, error: msg,
        })
      }

      logToolCall({ platform: platformId, action, args: redact(cleanArgs, redactKeys), outcome: 'error', latencyMs: latency, error: msg, sessionId, gatewayId: gateway?.id, userAgent: req.headers.get('user-agent') ?? undefined })
      return rpcOk(id, toolError(msg))
    }
  }

  return rpcErr(id, -32601, `Method not found: ${method}`)
}

export async function DELETE(req: NextRequest) {
  const gateway = resolveGateway(req)
  if (gateway === false) return new NextResponse('Unauthorized', { status: 401 })
  const sessionId = req.headers.get('mcp-session-id')
  if (sessionId) sessions.delete(sessionId)
  return new NextResponse(null, { status: 200 })
}

export async function GET() {
  return NextResponse.json({
    name:        'MCPetty Gateway',
    description: 'One tool per platform. Claude picks the platform, then the action.',
    transport:   'streamable-http',
    schema:      '{ action: string, args: object }',
  })
}
