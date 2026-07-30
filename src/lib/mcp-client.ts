export interface MCPTool {
  name: string
  description?: string
  inputSchema: {
    type?: string
    properties?: Record<string, unknown>
    required?: string[]
    oneOf?: unknown[]
    [key: string]: unknown
  }
}

export interface SecurityFlag {
  level: 'danger' | 'warning' | 'info'
  code: string
  message: string
  detail: string
}

export interface MCPServerStatus {
  online: boolean
  serverInfo?: { name: string; version: string; instructions?: string }
  tools: MCPTool[]
  flags: SecurityFlag[]
  error?: string
  latencyMs?: number
}

// --- Security analysis ---

const SYSTEM_EXEC   = /\b(exec|shell|execute|subprocess|spawn|eval|run_command|bash|cmd|invoke_process)\b/i
const EXFIL_RISK    = /\b(dump_all|export_all|backup_all|get_all_secrets|list_credentials|get_env|read_env)\b/i
const DESTRUCTIVE   = /\b(delete|destroy|drop|truncate|wipe|purge|force_delete|hard_delete|nuke|reset_all)\b/i
const PRIV_ESCALATE = /\b(sudo|root|admin_override|set_permissions|grant_access|impersonate)\b/i

export function analyzeServer(
  url: string,
  headers: Record<string, string> = {},
  tools: MCPTool[],
  native = false
): SecurityFlag[] {
  const flags: SecurityFlag[] = []

  if (!native) {
    if (url.startsWith('http://')) {
      flags.push({
        level: 'warning',
        code: 'NO_TLS',
        message: 'Unencrypted connection (HTTP)',
        detail: 'MCP traffic including credentials travels in plaintext. Use HTTPS.',
      })
    }

    if (!headers || Object.keys(headers).length === 0) {
      flags.push({
        level: 'warning',
        code: 'NO_AUTH',
        message: 'No authentication configured',
        detail: 'Server is accessible without credentials. Fine for internal Docker networks, risky if exposed.',
      })
    }
  }

  if (tools.length > 20) {
    flags.push({
      level: 'warning',
      code: 'LARGE_SURFACE',
      message: `${tools.length} tools exposed`,
      detail: 'Large tool surfaces give LLMs more attack vectors. Audit what you actually need.',
    })
  }

  let destructiveCount = 0
  let noDescCount = 0

  for (const tool of tools) {
    if (SYSTEM_EXEC.test(tool.name)) {
      flags.push({
        level: 'danger',
        code: 'SYSTEM_EXEC',
        message: `"${tool.name}" looks like system command execution`,
        detail: 'Tools that run shell commands can be weaponized via prompt injection. Verify this is intentional.',
      })
    }

    if (EXFIL_RISK.test(tool.name)) {
      flags.push({
        level: 'danger',
        code: 'EXFIL_RISK',
        message: `"${tool.name}" may bulk-export sensitive data`,
        detail: 'Mass export tools can silently exfiltrate your data. Restrict to read-only where possible.',
      })
    }

    if (PRIV_ESCALATE.test(tool.name)) {
      flags.push({
        level: 'danger',
        code: 'PRIV_ESCALATE',
        message: `"${tool.name}" may grant elevated privileges`,
        detail: 'Privilege escalation tools in an MCP context are a critical risk. Confirm this server is trusted.',
      })
    }

    if (DESTRUCTIVE.test(tool.name)) {
      destructiveCount++
    }

    if (!tool.description) {
      noDescCount++
    }
  }

  if (tools.length > 0 && destructiveCount / tools.length > 0.4) {
    flags.push({
      level: 'danger',
      code: 'MOSTLY_DESTRUCTIVE',
      message: `${Math.round((destructiveCount / tools.length) * 100)}% of tools are destructive`,
      detail: 'A server dominated by delete/destroy tools is unusual. Check the source.',
    })
  } else if (destructiveCount > 0) {
    flags.push({
      level: 'warning',
      code: 'HAS_DESTRUCTIVE',
      message: `${destructiveCount} destructive tool${destructiveCount > 1 ? 's' : ''}`,
      detail: 'Irreversible operations. Make sure your Wiki.js (or equivalent) has backups.',
    })
  }

  if (tools.length > 0 && noDescCount / tools.length > 0.5) {
    flags.push({
      level: 'warning',
      code: 'OPAQUE_TOOLS',
      message: `${noDescCount}/${tools.length} tools have no description`,
      detail: 'Undocumented tools are harder to audit. An LLM will guess what they do — it may guess wrong.',
    })
  }

  return flags
}

// --- MCP protocol ---

// Every call below talks to a user-supplied URL (http-proxy instances) or a subprocess
// port. Bare fetch has no overall response deadline — undici's default header timeout is
// minutes — so a backend that accepts the connection and then stalls used to hang the
// dashboard indefinitely, since /api/servers probes every instance in one Promise.all and
// waits for the slowest. Matches FETCH_TIMEOUT_MS in native/http.ts.
const MCP_TIMEOUT_MS = 5000

function withTimeout(init: RequestInit): RequestInit {
  return { ...init, signal: AbortSignal.timeout(MCP_TIMEOUT_MS) }
}

function parseSSEResponse(text: string): unknown {
  const lines = text.split('\n')
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        return JSON.parse(line.slice(6))
      } catch {
        // not JSON, skip
      }
    }
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function initSession(
  url: string,
  headers: Record<string, string> = {}
): Promise<{ sessionId: string; serverInfo: MCPServerStatus['serverInfo'] }> {
  const res = await fetch(url, withTimeout({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mcpetty', version: '1.0.0' },
      },
    }),
  }))

  const sessionId = res.headers.get('mcp-session-id') || ''
  const text = await res.text()
  const data = parseSSEResponse(text) as { result?: { serverInfo?: MCPServerStatus['serverInfo'] } }
  return { sessionId, serverInfo: data?.result?.serverInfo }
}

// http-proxy instances point at a user-supplied URL, so the far end is not trusted to
// terminate its own pagination. A server that echoes the same nextCursor forever would
// otherwise spin here accumulating tools until the process dies — with tools/list awaiting
// it, that stalls every gateway conversation.
export const MAX_TOOL_PAGES = 50

export async function listTools(
  url: string,
  sessionId: string,
  headers: Record<string, string> = {}
): Promise<MCPTool[]> {
  const tools: MCPTool[] = []
  let cursor: string | undefined = undefined
  let requestId = 2
  let pages = 0
  const seenCursors = new Set<string>()

  do {
    const res = await fetch(url, withTimeout({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestId++,
        method: 'tools/list',
        params: cursor ? { cursor } : {},
      }),
    }))

    const text = await res.text()
    const data = parseSSEResponse(text) as {
      result?: { tools?: MCPTool[]; nextCursor?: string }
    }
    const page = data?.result?.tools ?? []
    tools.push(...page)
    cursor = data?.result?.nextCursor

    if (cursor) {
      if (seenCursors.has(cursor)) {
        console.warn(`[MCPetty] ${url} repeated tools/list cursor — stopping at ${tools.length} tools`)
        break
      }
      seenCursors.add(cursor)
    }
    if (++pages >= MAX_TOOL_PAGES) {
      console.warn(`[MCPetty] ${url} exceeded ${MAX_TOOL_PAGES} tools/list pages — truncating at ${tools.length} tools`)
      break
    }
  } while (cursor)

  return tools
}

export async function callTool(
  url: string,
  headers: Record<string, string> = {},
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const { sessionId } = await initSession(url, headers)

  const res = await fetch(url, withTimeout({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  }))

  const text = await res.text()
  const data = parseSSEResponse(text) as { result?: unknown; error?: unknown }
  if (data && typeof data === 'object' && 'error' in data) throw new Error(JSON.stringify(data.error))
  return (data as { result?: unknown })?.result
}

export async function checkServer(
  url: string,
  headers: Record<string, string> = {}
): Promise<MCPServerStatus> {
  const start = Date.now()
  try {
    const { sessionId, serverInfo } = await initSession(url, headers)
    const tools = await listTools(url, sessionId, headers)
    const flags = analyzeServer(url, headers, tools)
    return { online: true, serverInfo, tools, flags, latencyMs: Date.now() - start }
  } catch (err) {
    return {
      online: false,
      tools: [],
      flags: [],
      error: err instanceof Error ? err.message : 'Unknown error',
      latencyMs: Date.now() - start,
    }
  }
}
