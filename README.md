```
███╗   ███╗ ██████╗██████╗ ███████╗████████╗████████╗██╗   ██╗
████╗ ████║██╔════╝██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝╚██╗ ██╔╝
██╔████╔██║██║     ██████╔╝█████╗     ██║      ██║    ╚████╔╝
██║╚██╔╝██║██║     ██╔═══╝ ██╔══╝     ██║      ██║     ╚██╔╝
██║ ╚═╝ ██║╚██████╗██║     ███████╗   ██║      ██║      ██║
╚═╝     ╚═╝ ╚═════╝╚═╝     ╚══════╝   ╚═╝      ╚═╝      ╚═╝
```

**The Ultimate BottleNeck.** Self-hosted MCP gateway and dashboard for your homelab.

One Docker container. All your MCPs through one endpoint. All credentials encrypted in SQLite. No env vars required.

---

## Deploy

```yaml
services:
  mcpetty:
    image: ghcr.io/azinupoatemaine/mcpetty:latest
    ports:
      - "1234:1234"
    volumes:
      - mcpetty-data:/app/data
    restart: unless-stopped

volumes:
  mcpetty-data:
```

```bash
docker compose up -d
```

Open `http://your-host:1234`. Default credentials (printed to stdout on first boot):

```
username: admin
password: mcpetty
```

Change these immediately.

---

## Supported MCPs

| MCP | Tools | Transport |
|---|---|---|
| **WikiJS** | Full page, user, and group management | Native |
| **Portainer** | Docker environments, stacks, containers, networks, volumes | Native |
| **Karakeep** | Bookmarks — save, search, tag, organise | Native |
| **Proxmox VE** | VMs, containers, snapshots, backups, storage, cluster | Native |
| **Wazuh** | Agents, alerts, vulnerabilities, SCA, FIM, active response | Native |
| **Home Assistant** | Smart home control, automations, media players, scenes | HTTP Proxy |

**Multi-instance**: every MCP type can be installed multiple times with different credentials. Two Portainer servers, three WikiJS instances — each appears as its own tool in Claude.

**Instance tags**: each instance can have up to 3 tags (e.g. `[Infrastructure]`, `[Homelab]`). Tags are injected as a prefix in the tool's description so Claude can route by category or location before even looking at available actions. Set them from each server card — existing tags appear as quick-select chips.

---

## Connecting Claude

The dashboard **Gateway Endpoint** section shows a ready-to-copy command:

```bash
claude mcp add mcpetty http://your-host:1234/mcp \
  --transport http \
  --header "Authorization: Bearer <your-api-key>"
```

All installed MCPs appear as a single server. Claude sees one tool per installed instance — `portainer-prod`, `wikijs-home`, `proxmox-dc1`. Each tool accepts `{ action, args }`.

```json
{ "action": "list_stacks", "args": {} }
{ "action": "create_page", "args": { "path": "/notes/test", "content": "hello" } }
```

### API key

Derived from your master secret via HKDF. Stable across restarts. Changes only if the data volume is wiped. Never stored — recomputed on demand.

---

## Dashboard

- **Server cards** — online/offline status, latency, security flags, credential management, tool list
- **Instance tags** — up to 3 tags per instance, shown as `[tag]` chips next to the server name. Injected as a prefix in the tool description Claude reads when routing. Useful for category (`[Infrastructure]`) and location (`[DC1]`) signals.
- **Mini feed** — each card shows the last 5 tool calls, collapsed by default. Outcome, action, latency, relative timestamp.
- **Tool access** — enable/disable individual tools per instance. Disabled tools are hidden from Claude entirely.
- **Description overrides** — edit what Claude sees as a tool's description directly in the UI, per tool per instance. Overrides are injected live into the gateway schema.
- **Charts** — latency bars and tool count per server; online/total ring

---

## Insights

Five tabs of observability. All data comes from the tool call log — every call through the gateway is recorded.

| Tab | What's there |
|---|---|
| **Overview** | Summary stats, calls/day chart, latency trend per platform, top actions with p95 latency, recent calls with full args + result |
| **Sessions** | Per MCP session: wall-clock duration, call count, platforms used, caller. Expand a session to see every call in order with offsets, args, and results. |
| **Errors** | Smart-grouped error patterns. Similar errors (same message with different IPs/ports/IDs) are folded into one card with a total count. Expand to see raw variants. |
| **Heatmap** | 7×24 call density grid — day of week × hour of day (UTC). |
| **Callers** | User-agent breakdown. Identifies Claude Code, Claude Desktop, claude.ai. Includes a UA × platform matrix. |

---

## Settings

### Tool Output Cache
Returns identical calls from memory. Cache key = `platform + action + args`. Claude is told the result is cached and how many seconds remain. Bypass with `nocache: true` in the call args. TTL: 1–120 seconds.

### Prompt Injection Detection
Scans every tool response for patterns that could manipulate Claude. Configurable extra patterns on top of the built-in set. Suspicious responses are prefixed with a warning before Claude reads them.

### n8n Webhook
Fires a POST to your n8n endpoint when specified tools are called. Trigger filter supports `platform:action` or `platform:*` patterns. Payload includes action, args, outcome, latency, and result preview.

### Argument Redaction
Replaces specified argument key names (e.g. `token`, `password`) with `[REDACTED]` in the insights log. Execution always gets the real values. Protects secrets from appearing in drill-down views.

### Gateway Rate Limits
Limit calls per named gateway in a configurable time window. Master key is always unlimited.

### Meta MCP
Toggle that installs MCPetty itself as a read-only MCP tool. Lets Claude query MCPetty — installed servers, call history, error patterns, sessions — without leaving the conversation. Actions: `get_status`, `get_insights_summary`, `get_recent_calls`, `get_error_patterns`, `get_top_actions`, `get_sessions`.

### Changelog
Read-only audit trail of every config change — installs, uninstalls, credential rotations, tool filter edits, gateway changes. Filterable by 7/30/90 days.

---

## Named Gateways

Create named API keys (beyond the master key) with individual rate limits and scoped access. Useful for giving separate keys to different Claude projects or team members without sharing the master key.

- **Instance scope** — explicitly assign which MCP instances a key can reach.
- **Action scope** — per-gateway tool overrides. Restrict a key to specific actions on each instance.

---

## Security model

| Layer | Mechanism |
|---|---|
| Dashboard login | scrypt (N=16384), 30-day httpOnly session cookie, 8h idle timeout |
| Credential storage | AES-256-GCM, HKDF-derived key per `instanceId:credKey` pair |
| Master secret | Auto-generated on first boot, `/app/data/.secret` (chmod 600) |
| Gateway `/mcp` | Bearer token required, derived from master secret via HKDF |
| All API routes | Session cookie required (except `/mcp` and `/api/auth/*`) |
| Tool schema | Discriminated union `oneOf` — each action strictly typed, no untyped passthrough |
| Path traversal | `safeSeg()` blocks traversal in URL segments for Proxmox operations |
| Webhook | Loopback and link-local addresses blocked; RFC1918 allowed |
| Named gateway keys | HMAC-SHA256 hashed with master key before storage |

---

## Developer guide — adding a new MCP

**Always prefer native transport.** If the external MCP is just wrapping a REST/GraphQL API, replicate those calls in TypeScript. No subprocess, no Dockerfile change, no port.

```
src/lib/native/myservice.ts   ← handler (tools, ping, call)
src/lib/native/index.ts       ← register in NATIVE map
src/lib/mcp-catalog.ts        ← add catalog entry
```

Three transport types:

| Transport | Use when | Dockerfile |
|---|---|---|
| `native` | Anything wrapping a REST/GraphQL API | No change |
| `http` | Subprocess listening on an internal HTTP port | `RUN npm install -g <package>` |
| `stdio` | Subprocess speaking JSON-RPC over stdin/stdout | Add binary download |

See `CLAUDE.md` for the full native handler template and architecture notes.

---

## Stack

- Next.js (App Router, `output: 'standalone'`)
- SQLite via `better-sqlite3` (WAL mode, volume-mounted at `/app/data`)
- Zero UI libraries — inline styles, monospace terminal aesthetic
- Docker + GitHub Actions → `ghcr.io/azinupoatemaine/mcpetty:latest`

---

## License

AGPL-3.0. Use it, extend it, deploy it — just keep your changes open.

---

*your config, your problem.*
