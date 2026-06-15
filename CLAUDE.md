@AGENTS.md

# MCPetty — restore guide

Self-hosted MCP dashboard. One Docker container. MCPs run as native handlers. All credentials encrypted in SQLite. No env vars required.

---

## Key files

| File | Purpose |
|---|---|
| `src/lib/mcp-catalog.ts` | Catalog of MCP types. Edit this to add a new MCP type. |
| `src/lib/db.ts` | SQLite layer. All tables, migrations, and query functions. |
| `src/lib/crypto.ts` | AES-256-GCM + HKDF. Master secret + gateway API key derivation. |
| `src/lib/auth.ts` | scrypt password hashing, session tokens, `isAuthorizedRequest()` helper. |
| `src/lib/process-manager.ts` | Spawns/stops subprocess MCPs (http/stdio transports). No-op for native. |
| `src/lib/mcp-client.ts` | MCP Streamable HTTP client. Follows `nextCursor` pagination on `tools/list`. |
| `src/lib/stdio-bridge.ts` | JSON-RPC over stdin/stdout for stdio-transport MCPs. |
| `src/lib/native/index.ts` | Registry of native handlers (`NATIVE` map). `NativeHandler` interface defined here. |
| `src/lib/native/wikijs.ts` | WikiJS — direct GraphQL calls, parameterized queries. |
| `src/lib/native/portainer.ts` | Portainer — direct REST API calls with `X-API-Key`. |
| `src/instrumentation.ts` | Next.js startup hook: `ensureDefaultUser()` then `bootAll()`. |
| `src/app/page.tsx` | Server component. Validates session, redirects to `/login`. |
| `src/app/dashboard-client.tsx` | Dashboard UI (client component). Nav: Dashboard / Library / Insights. |
| `src/app/library-client.tsx` | Library UI — catalog types, installed instances, install/uninstall. |
| `src/app/insights-client.tsx` | Insights UI — 7-day tool call history, charts, args drill-down. |
| `src/app/mcp/route.ts` | Gateway endpoint. One tool per platform, `{ action, args }` call format. |
| `src/app/api/library/route.ts` | Install/uninstall MCP instances. POST needs `type`, `instanceName`, `instanceId`, `credentials`. |
| `src/app/api/gateway-key/route.ts` | Returns gateway API key to authenticated dashboard. |
| `src/app/api/tool-filters/route.ts` | GET/POST per-instance tool enable/disable. |
| `src/app/api/insights/route.ts` | Returns aggregated tool call stats for last N days. |
| `src/app/api/servers\|invoke\|credentials/` | All require valid session cookie. |
| `Dockerfile` | Multi-stage. Runner stage: add binaries here only for `http`/`stdio` transport MCPs. Native MCPs need nothing. |
| `docker-compose.yml` | Single service, zero env vars, one volume `mcpetty-data:/app/data`. |

---

## Crypto system

**Master secret** — auto-generated first boot, written to `/app/data/.secret` (chmod 600). Priority: `MCPETTY_SECRET` env var → file → generate. Cached in `_secret`.

**Credential encryption** — AES-256-GCM. Per-credential key via `hkdfSync('sha256', masterKey, SALT, "mcpetty:{instanceId}:{credKey}", 32)`. Key zeroed after use.

**Gateway API key** — `hkdfSync('sha256', masterKey, SALT, "mcpetty-gateway-v1", 32)` as base64url. Stable across restarts. Never stored. Changes only if data volume is wiped.

---

## Auth system

**Passwords** — `scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })`. Default on first boot: `admin / mcpetty` (printed to stdout).

**Sessions** — 64-char hex token, httpOnly cookie `mcpetty_session`, 30-day TTL. All API routes except `/mcp` and `/api/auth/*` call `isAuthorizedRequest(req)`.

**Page auth** — server components call `validateSession(token)` and `redirect('/login')` if invalid.

**Gateway auth** — `POST /mcp` requires `Authorization: Bearer <key>`. No browser cookie. Claude connects directly.

---

## MCP transport types

Three types, defined per catalog entry:

| Transport | What it means | Dockerfile change |
|---|---|---|
| `native` | Handler is TypeScript code inside MCPetty. Direct API calls. | None |
| `http` | Subprocess listening on an internal HTTP port, speaks MCP protocol. | `RUN npm install -g <package>` |
| `stdio` | Subprocess communicating via stdin/stdout JSON-RPC. | Download binary |

**Always prefer `native`.** It's the right call for every MCP that's just wrapping an API. The external MCP binary (Go, Python, TS) is just calling REST/GraphQL — write the same calls in TypeScript. No binary, no subprocess, no Dockerfile, no subprocess lifecycle to manage.

Only use `http` or `stdio` if the MCP does something that cannot be replicated in TypeScript (e.g. spawning local Docker processes, accessing local filesystem with specific OS bindings).

---

## How to add a new MCP — the full process

When given a GitHub MCP repo:
1. Read the source — find every API endpoint it calls, every tool it exposes, every credential it needs.
2. Create `src/lib/native/<type>.ts` using the mandatory template below.
3. Register in `src/lib/native/index.ts`.
4. Add catalog entry in `src/lib/mcp-catalog.ts`.
5. No Dockerfile changes. No subprocess. No external binary.

### Mandatory template — always follow this exactly

```typescript
// src/lib/native/myservice.ts
import { getCredential } from '../db'
import type { MCPTool } from '../mcp-client'
import { restFetch } from './http'   // REST API  — use this
// import { gqlFetch } from './http' // GraphQL   — use this instead for GraphQL APIs

// ─── Tools ────────────────────────────────────────────────────────────────────

export const TOOLS: MCPTool[] = [
  {
    name: 'do_thing',
    description: 'Does the thing.',  // required, clear, one sentence
    inputSchema: {
      type: 'object',
      properties: {
        id:   { type: 'number', description: 'Item ID' },
        name: { type: 'string', description: 'Optional name filter' },
      },
      required: ['id'],
    },
  },
]

// ─── Credentials ──────────────────────────────────────────────────────────────

function cfg(instanceId: string) {
  const url   = getCredential(instanceId, 'MY_URL')
  const token = getCredential(instanceId, 'MY_TOKEN')
  if (!url || !token) throw new Error('MyService credentials not configured. Set MY_URL and MY_TOKEN.')
  return { base: url.replace(/\/$/, ''), token }
}

// ─── Ping (connectivity check) ────────────────────────────────────────────────

export async function ping(instanceId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { base, token } = cfg(instanceId)
    await restFetch(base, '/api/health', token)  // lightest possible endpoint
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export async function call(instanceId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const { base, token } = cfg(instanceId)

  switch (toolName) {
    case 'do_thing':
      return restFetch(base, `/api/things/${Number(args.id)}`, token)

    default:
      throw new Error(`Unknown MyService tool: ${toolName}`)
  }
}
```

**Rules enforced by this template:**
- Always import `restFetch` or `gqlFetch` from `./http` — never use raw `fetch()`
- `restFetch` and `gqlFetch` handle: real network error extraction (not "fetch failed"), localhost hint, 401/403/404 specific messages, non-ok responses
- `cfg(instanceId)` pattern — always validate credentials exist before making any call
- `ping()` always calls the lightest possible endpoint to verify connectivity
- `call()` always uses a switch with a default that throws

**`restFetch` signature:**
```typescript
restFetch<T>(baseUrl, path, token, authHeader?, authScheme?, fetchInit?)
// Default: Authorization: Bearer <token>
// Portainer uses: restFetch(base, '/api/...', token, 'X-API-Key', '')
```

**`gqlFetch` signature:**
```typescript
gqlFetch<T>(baseUrl, token, query, variables?)
// Always uses Authorization: Bearer <token>
// Always POST to /graphql
```

Register in `src/lib/native/index.ts`:
```typescript
import * as myservice from './myservice'
export const NATIVE: Record<string, NativeHandler> = {
  // existing...
  myservice: { tools: myservice.TOOLS, ping: myservice.ping, call: myservice.call },
}
```

Add to `src/lib/mcp-catalog.ts`:
```typescript
{
  id: 'myservice', name: 'My Service', description: 'Does things.',
  transport: 'native',
  credentials: [
    { key: 'MY_URL',   label: 'URL',   description: 'Base URL of the service', type: 'url',    required: true },
    { key: 'MY_TOKEN', label: 'Token', description: 'API key or access token',  type: 'secret', required: true },
  ],
}
```

---

## Multi-instance architecture

Every installed MCP is an **instance** of a catalog type. One type can have unlimited instances (e.g. two Portainer servers, three WikiJS instances).

**Key concepts:**
- `type` — the catalog entry id (e.g. `portainer`). Defines tools and credential schema.
- `instanceId` — user-assigned slug (e.g. `prod`, `home`, `dc1`). Unique. Used as the tool name in Claude.
- `name` — display name shown in the UI (e.g. "Production").

Credentials are stored by `instanceId`, not by `type`. Each instance has its own isolated credential set.

**Gateway** — Claude sees one tool per instance. `portainer-prod` and `portainer-home` are separate tools. Both use the same `portainer` type handler but with different `instanceId`s passed to `ping()` and `call()`.

---

## DB schema

```sql
credentials      (server_name TEXT, key_name TEXT, encrypted_value BLOB, iv BLOB, tag BLOB, created_at, updated_at)
                  -- server_name = instanceId
audit_log        (action, server_name, key_name, timestamp)
installed_mcps   (instance_id TEXT PRIMARY KEY, type TEXT, name TEXT, port INTEGER, installed_at, enabled)
admin_users      (username TEXT PRIMARY KEY, password_hash BLOB, salt TEXT, created_at, updated_at)
sessions         (token TEXT PRIMARY KEY, username, expires_at, created_at)
tool_filters     (mcp_id TEXT, tool_name TEXT, enabled INTEGER, PRIMARY KEY (mcp_id, tool_name))
                  -- mcp_id = instanceId
tool_call_log    (id, timestamp, platform TEXT, action TEXT, args_json TEXT, outcome TEXT, latency_ms, error, session_id TEXT)
                  -- platform = instanceId, session_id = MCP session from mcp-session-id header
```

Migrations run on boot: `migrateInstalledMCPs()` handles old `id`→`instance_id` rename. `migrateToolCallLog()` adds `session_id` column if missing.

---

## Gateway endpoint `/mcp`

- `Authorization: Bearer <key>` required on every POST
- **One tool per platform instance** — not one tool per action. This is intentional (STRAP pattern). Do not restructure to per-action tools.
- Claude calls: `{ "name": "portainer-prod", "arguments": { "action": "list_stacks", "args": {} } }`
- `tools/list` returns each instance as one tool (`buildPlatformTool()`). The `inputSchema` is an object with: `action` — a strict `enum` of every enabled action name; `args` — an object whose `properties` are the typed union of all args across actions, with `additionalProperties: false`; and a `nocache` boolean. The per-action signatures (`action_name: desc [args: field*(type): ...]`) are encoded in the tool **description** text, not in the schema. Never loosen `args` to an untyped `{ type: "object" }` passthrough.
- `tools/call` routes to `NATIVE[instance.type].call(instanceId, action, args)`
- Tool access filters apply: disabled actions excluded from the `action` enum and rejected at call time
- The `mcp-session-id` header value is captured on every `tools/call` and stored in `tool_call_log.session_id`

Claude Code config (alias is `mcpetty`, not the instance type name):
```json
{ "type": "http", "url": "http://<host>:1234/mcp", "headers": { "Authorization": "Bearer <key>" } }
```
Dashboard shows: `claude mcp add mcpetty http://<host>:1234/mcp --transport http --header "Authorization: Bearer <key>"`

---

## Insights

Every tool call through `/mcp` is logged to `tool_call_log`. The `/api/insights` route aggregates for the last N days. Available at `/insights` tab. The `args_json` column stores the actual arguments Claude passed — this IS the "prompt context" for each tool call.

`getInsights()` returns: `summary` (total, successes, avgLatency, **retryRate**), `callsPerDay`, `perPlatform`, `topActions` (includes **errors**, **p95Latency** per action), `recentCalls`. p95 is computed in JS from sorted latency rows — SQLite has no native percentile. Retry rate = calls in a session where the same platform had a prior error in the same session.

---

## Tool filters

`tool_filters(mcp_id, tool_name, enabled)`. Default (no row) = enabled. UI in each server card — checkboxes per tool, save button. Checked in both `/mcp` gateway (excludes from tools/list and enum) and `/api/invoke`.

## Named gateway RBAC

Named gateway keys support two levels of scoping:

- **Instance scope** — `gateway_instances` table. Must be explicitly assigned on creation; a new key reaches nothing until instances are added.
- **Action scope** — reuses `tool_filters` with `mcp_id = "{gatewayId}:{instanceId}"`. Per-gateway tool overrides. No row = inherit the global instance filter. No global row = enabled.

**Default for a new key**: no instances assigned (hard deny all), but once an instance is added, all its globally-enabled tools are accessible — no per-gateway tool rows needed. Scoping individual actions requires explicitly writing `tool_filters` rows for the `{gatewayId}:{instanceId}` composite key.

Enforcement happens at both `tools/list` (omits disallowed tools) and `tools/call` (rejects even if called directly).

---

## MCP protocol

Streamable HTTP. `POST initialize` → `mcp-session-id` header → subsequent POSTs with that header. Responses: SSE or plain JSON, `parseSSEResponse()` handles both. `tools/list` may paginate via `nextCursor` — always follow until absent.

---

## Deployment

Push to `main` → GitHub Actions → `ghcr.io/azinupoatemaine/mcpetty:latest` (public image). Portainer: redeploy stack to pull.

Data volume `mcpetty-data:/app/data` — never wipe unless intentionally resetting. Contains DB + master secret. Wiping changes gateway API key and loses all credentials.

---

## Claude Code MCP config

Lives in `~/.claude.json` under `projects.<absolute-path>.mcpServers`. `claude mcp add` writes to the directory Claude Code was opened from. If a session doesn't see an MCP, check which directory it was opened from.

---

## Style rules

- No UI libraries. Inline styles only, terminal/monospace aesthetic.
- Dark: bg `#0a0a0a`, accent `#39ff14` (neon green), red `#ff4444`, text `#ffffff`, muted `#9a9a9a`
- Copy: snarky and self-aware.
- No comments unless WHY is non-obvious.
- No "Co-Authored-By" in commits. Short, direct commit messages.

---

## Behaviour rules

- **Never delete an MCP handler, catalog entry, or native registration without explicit confirmation.** Renaming a UI label or alias is not the same as removing the MCP. Ask if unclear.
- **Never loosen the typed gateway schema in `buildPlatformTool()`.** `action` must stay a strict `enum` and `args` must keep typed `properties` with `additionalProperties: false` — do not replace it with an untyped `args: { type: "object" }` passthrough.

---

## Constraint — container memory

MCPetty is meant to run in memory-constrained containers. **scrypt N=65536 requires ~64MB and crashes with ERR_CRYPTO_INVALID_SCRYPT_PARAMS** on small containers. The max viable scrypt params are `{ N: 16384, r: 8, p: 1 }`. Do not raise N without confirming the deployment has the memory headroom.

---

## Constraint — HTTP and self-signed TLS

MCPetty targets self-hosted deployments, which frequently have no valid TLS certificates — backends are reached over plain HTTP or HTTPS with self-signed certs. This is a hard product constraint, not a bug:

- `secure: false` on session cookie **must stay** — dashboard may be served over HTTP
- `NODE_TLS_REJECT_UNAUTHORIZED = '0'` in `instrumentation.ts` **must stay** — self-signed backends
- Never enforce HTTPS-only for outbound connections (webhooks, MCP_URL, any native handler URL)
- Allow HTTP URLs everywhere user-supplied credentials are accepted

---

## Security decisions (applied)

- `hashGatewayKey` uses HMAC-SHA256 with master key (not plain SHA-256). **Breaking change**: existing named gateway keys stored in DB are now invalid — user must rotate them via dashboard after deploy.
- Idle session timeout: 8 hours. `sessions.last_accessed` column added via migration.
- `changePassword()` deletes all sessions for that user.
- `sameSite: 'strict'` on session cookie.
- `DELETE /mcp` requires valid Bearer token.
- `docker_proxy` and `kubernetes_proxy` in portainer.ts: method restricted to GET/POST/PUT/DELETE, body validated as JSON.
- Webhook test endpoint blocks loopback (127.x, localhost, ::1) and link-local (169.254.x). RFC1918 is allowed — self-hosted deployments legitimately target private-network services.
- Gateway ID in LIKE queries escaped with `ESCAPE '\\'` via `escapeLike()` in db.ts.

---

## Proxmox native handler

`src/lib/native/proxmox.ts` — 38 tools. Key patterns:

- Auth: `PVEAPIToken=user@realm!tokenname=value` header (not Bearer). Uses `authScheme: ''` in `restFetch`.
- All mutations use `pveMutate()` — sends `application/x-www-form-urlencoded` (Proxmox rejects JSON for POST/PUT).
- `safeSeg()` blocks path traversal in URL segments (node, vmid, storage, snapshot names).
- `fromAllNodes()` aggregates across cluster nodes; propagates 401/403 immediately.
- `listContent()` uses `Promise.allSettled` — partial results if some storages fail, throws only if all fail.
- `poll_job` fetches status + log in parallel; returns `{ ...status, log: string[] }`.
- Credentials: `PROXMOX_URL`, `PROXMOX_USER`, `PROXMOX_TOKEN_NAME`, `PROXMOX_TOKEN_VALUE`.

---

## MCP roadmap — next to build

Candidate native handlers to build next:

1. **Firefly III** — Personal finance REST API. Credential: `FIREFLY_URL` + `FIREFLY_TOKEN` (Personal Access Token from profile).
2. **Paperless-NGX** — Document management. REST API at `/api/`. Key tools: search documents, get content/metadata, list tags/correspondents/document types.
3. **n8n** — Workflow automation. API: list workflows, get executions, trigger via webhook or API. Credential: `N8N_URL` + `N8N_API_KEY`.
4. **Jellyfin** — Media server. REST API: search library, get items, manage users, trigger scans. Credential: `JELLYFIN_URL` + `JELLYFIN_TOKEN` (API key from dashboard).
5. **Ollama** — Local LLM. API: list models, generate, pull models. Credential: `OLLAMA_URL` (no auth by default).
