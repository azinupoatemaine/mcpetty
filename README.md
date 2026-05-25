```
███╗   ███╗ ██████╗██████╗ ███████╗████████╗████████╗██╗   ██╗
████╗ ████║██╔════╝██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝╚██╗ ██╔╝
██╔████╔██║██║     ██████╔╝█████╗     ██║      ██║    ╚████╔╝
██║╚██╔╝██║██║     ██╔═══╝ ██╔══╝     ██║      ██║     ╚██╔╝
██║ ╚═╝ ██║╚██████╗██║     ███████╗   ██║      ██║      ██║
╚═╝     ╚═╝ ╚═════╝╚═╝     ╚══════╝   ╚═╝      ╚═╝      ╚═╝
```

**Self-hosted MCP gateway and dashboard for your homelab.**

MCPetty is a single Docker container that sits between your AI agent and all your self-hosted services. Install MCPs through the dashboard, connect your agent to one endpoint, and it can reach everything — Portainer, Proxmox, WikiJS, Home Assistant, and more. All credentials stay on your machine, encrypted at rest. Works with any MCP-compatible AI agent: Claude, GPT, Gemini, local models via Ollama — anything that speaks the Model Context Protocol.

One container. One endpoint. All your services.

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

**Multi-instance**: every MCP type can be installed multiple times with different credentials. Two Portainer servers, three WikiJS instances — each appears as its own tool to your agent.

**Instance tags**: each instance can have up to 3 tags (e.g. `[Infrastructure]`, `[Homelab]`). Tags are injected as a prefix in the tool's description so the agent can route by category or location before even looking at available actions. Set them from each server card — existing tags appear as quick-select chips.

---

## Connecting your agent

The dashboard **Gateway Endpoint** section shows a ready-to-copy command. For Claude Code:

```bash
claude mcp add mcpetty http://your-host:1234/mcp \
  --transport http \
  --header "Authorization: Bearer <your-api-key>"
```

For any other MCP-compatible agent, point it at `http://your-host:1234/mcp` with the Bearer token in the `Authorization` header.

All installed MCPs appear as a single server. Your agent sees one tool per installed instance — `portainer-prod`, `wikijs-home`, `proxmox-dc1`. Each tool accepts `{ action, args }`.

```json
{ "action": "list_stacks", "args": {} }
{ "action": "create_page", "args": { "path": "/notes/test", "content": "hello" } }
```

### API key

Derived from your master secret via HKDF. Stable across restarts. Changes only if the data volume is wiped. Never stored — recomputed on demand.

---

## Dashboard

- **Server cards** — online/offline status, latency, security flags, credential management, tool list
- **Status badges** — `ONLINE` (green), `OFFLINE` (red), `AUTO-DISABLED` (amber, recoverable). Auto-disabled instances are re-enabled automatically when they come back up.
- **Instance tags** — up to 3 tags per instance, shown as `[tag]` chips next to the server name. Injected as a prefix in the tool description the agent reads when routing. Useful for category (`[Infrastructure]`) and location (`[DC1]`) signals.
- **Mini feed** — each card shows the last 5 tool calls, collapsed by default. Outcome, action, latency, relative timestamp.
- **Tool access** — enable/disable individual tools per instance. Disabled tools are hidden from the agent entirely.
- **Description overrides** — edit what the agent sees as a tool's description directly in the UI, per tool per instance. Overrides are injected live into the gateway schema.
- **Approval rules** — per instance, define action patterns that require human sign-off before the agent can run them. Supports glob syntax (`delete_*`, `restart_*`). Rules are managed in each server's gear modal.
- **Health check** — configure an automatic ping interval and fail threshold per native instance. Broken instances are auto-disabled after N consecutive failures and re-enabled when they recover. Configurable in the gear modal.
- **Approval queue** — red pulsing badge in the nav when any approvals are pending. Click to open a slide-in panel: approve or reject each request with optional reason, see full args, and browse decision history.
- **Charts** — latency bars and tool count per server; online/total ring

---

## Insights

Seven tabs of observability. All data comes from the tool call log — every call through the gateway is recorded.

| Tab | What's there |
|---|---|
| **Overview** | Summary stats, calls/day chart, latency trend per platform, top actions with p95 latency, recent calls with full args + result |
| **Sessions** | Per MCP session: wall-clock duration, call count, platforms used, caller. Expand a session to see every call in order with offsets, args, and results. |
| **Errors** | Smart-grouped error patterns. Similar errors (same message with different IPs/ports/IDs) are folded into one card with a total count. Expand to see raw variants. |
| **Heatmap** | 7×24 call density grid — day of week × hour of day (UTC). |
| **Callers** | User-agent breakdown. Identifies Claude Code, Claude Desktop, claude.ai, and others. Includes a UA × platform matrix. |
| **Tokens** | Token cost breakdown by action — input (args) vs output (results). Top actions by total token usage, per-call average. |
| **Schema** | How many tokens your tool schema burns before the conversation even starts. Hero token count, context window gauge (GPT-4o / Claude / Gemini), per-instance breakdown, 7-day trend. Tells you exactly how much context MCPetty costs. |

---

## Settings

### Tool Output Cache
Returns identical calls from memory. Cache key = `platform + action + args`. The agent is told the result is cached and how many seconds remain. Bypass with `nocache: true` in the call args. TTL: 1–120 seconds.

### Prompt Injection Detection
Scans every tool response for patterns that could manipulate your AI agent. Configurable extra patterns on top of the built-in set. Suspicious responses are prefixed with a warning before the agent reads them.

### n8n Webhook
Fires a POST to your n8n endpoint on tool calls and system events. Trigger filter supports `platform:action` or `platform:*` patterns for tool calls.

**Event types:**

| Event | When it fires |
|---|---|
| `tool_call` | Any tool call matching the trigger filter — includes action, args, outcome, latency, result preview |
| `approval_request` | An action hit an approval rule — includes approval ID, instance, action, args, and a dashboard deep-link |
| `health_change` | A native instance changed health state — `status: "down"` or `"recovered"`, with error and fail count |

n8n can approve/reject pending actions by calling `POST /api/approvals/<id>` with a Bearer key.

### Argument Redaction
Replaces specified argument key names (e.g. `token`, `password`) with `[REDACTED]` in the insights log. Execution always gets the real values. Protects secrets from appearing in drill-down views.

### Gateway Rate Limits
Limit calls per named gateway in a configurable time window. Master key is always unlimited.

### Meta MCP
Toggle that installs MCPetty itself as a read-only MCP tool. Lets your AI agent query MCPetty — installed servers, call history, error patterns, sessions — without leaving the conversation. Actions: `get_status`, `get_insights_summary`, `get_recent_calls`, `get_error_patterns`, `get_top_actions`, `get_sessions`.

### Changelog
Read-only audit trail of every config change — installs, uninstalls, credential rotations, tool filter edits, gateway changes. Filterable by 7/30/90 days.

---

## Named Gateways

Create named API keys (beyond the master key) with individual rate limits and scoped access. Useful for giving separate keys to different agent projects or team members without sharing the master key.

- **Instance scope** — explicitly assign which MCP instances a key can reach.
- **Action scope** — per-gateway tool overrides. Restrict a key to specific actions on each instance.
- **Agent context prefix** — write a text prefix that gets prepended to every tool response sent through this gateway. Steers the agent's behaviour at the response layer — no system prompt access needed. Example: `"This is PRODUCTION. All destructive operations are irreversible."` Configured in the gateway's expanded card with a char counter and token estimate.

## Human-in-the-loop Approval Queue

Define which actions require a human sign-off before the agent can run them. Configure per-instance via the gear modal — add patterns like `delete_*`, `stop_*`, or an exact action name. When the agent calls a matching action:

1. MCPetty intercepts the call and returns `APPROVAL_REQUIRED` with an approval ID.
2. An n8n webhook fires (if configured) with the full request details and a dashboard deep-link.
3. The agent polls with `{ action: "check_approval", args: { approval_id: "..." } }`.
4. A human approves or rejects from the dashboard panel (or n8n calls back via `POST /api/approvals/<id>`).
5. On approval, MCPetty executes the action and returns the real result on the next poll.

The approval panel is accessible from any dashboard page — red pulsing dot in the nav when anything is waiting. Decision history is preserved.

n8n callback endpoint: `POST /api/approvals/<id>` with `Authorization: Bearer <gateway-key>` and `{ "decision": "approved" | "rejected", "reason": "optional" }`.

## Automatic Health Checks

Configure automatic pings for any native MCP instance. Set the interval (1/5/15/30 min or off) and the fail threshold (1–10 consecutive failures). When an instance exceeds the threshold:

- It is automatically disabled in the gateway (removed from `tools/list`).
- An `AUTO-DISABLED` amber badge appears on the server card.
- An n8n webhook fires with the event type, error, and fail count.

Recovery is also automatic — when the next scheduled ping succeeds, the instance re-enables itself and a `recovered` webhook fires. You can also re-enable manually from the gear modal.

## Response Diff Tracking

For list and get actions that return arrays, MCPetty tracks what changed between sessions. The first call saves a snapshot. Subsequent calls in a new session compare the result against the snapshot. If anything was added or removed, a change summary is prepended to the response:

```
[CHANGES SINCE LAST SESSION: +2 added: my-new-stack, another-stack, -1 removed: old-stack]
────────────────────────────────────────
... actual result ...
```

The diff is shown once per session per unique call signature. Subsequent calls in the same session skip it. Items are matched by `id`, `name`, `path`, or `title` field — falls back to a count-only diff if none are found. Snapshots are updated when a diff is shown or on first call.

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

## Architecture — why one tool per instance

MCPetty implements the **STRAP pattern** (Single Tool Resource Action Pattern) [[1]](https://almatuck.com/articles/reduced-mcp-tools-96-to-10-strap-pattern). Instead of exposing every action as a separate tool, each installed MCP instance appears as a single tool in your agent's context. All actions are routed through it via `{ action, args }`.

### The problem it solves

Without MCPetty, connecting multiple services exposes the raw tool lists to your agent directly. Portainer alone has **39 tools**. WikiJS has **18**. Add Proxmox (30), Wazuh (57), and a second Portainer instance, and you're at **183 tools** before the conversation even starts.

This causes real, documented problems:
- **Tool calling accuracy drops** as tool count grows — the decline starts at surprisingly low numbers [[2]](https://dev.to/nebulagg/mcp-tool-overload-why-more-tools-make-your-agent-worse-5a49)
- **Context bloat** — each tool's name, description, and JSON schema consumes tokens every turn. 50+ tools can burn 55K+ tokens of context permanently. Cursor hard-caps at 40 tools for this reason [[3]](https://scottspence.com/posts/optimising-mcp-server-context-usage-in-claude-code)
- **Name collisions** — Portainer has `list_users`. WikiJS has `list_users`. With raw tool exposure, the agent guesses which one you mean. This is a recognised anti-pattern [[4]](https://jentic.com/blog/the-mcp-tool-trap)

With MCPetty, the agent sees **one tool per instance**: `portainer-prod`, `wikijs-home`, `proxmox-dc1`. Two Portainer instances = two tools. The entire Portainer tool list (39 actions) is encoded into one tool's description and schema. The name collision problem disappears because `portainer-prod.list_users` and `wikijs-home.list_users` live in completely separate tool namespaces.

### How the schema is built

Each platform tool has:
- `action` — a strict `enum` of every enabled action name. The agent cannot pass an action that doesn't exist.
- `args` — an object containing the typed union of all possible argument properties across all actions. Each property carries its type and description from the original handler definition. `additionalProperties: false` blocks garbage fields.
- The description encodes every action's signature inline: `action_name: what it does [args: field*(type): description, ...]`. The `*` marks required args.

This is more typed than a pure untyped blob but is not a full per-action discriminated union (`oneOf`). The tradeoff: the schema doesn't enforce *which* args a specific action requires — that constraint lives in the description text that the agent reads. Modern reasoning models handle this well; the strict `enum` on `action` and typed `args` properties do most of the heavy lifting.

### Known tradeoffs

- **Retry cost** — if the agent passes wrong args for an action, the server rejects the call and the agent must retry. With a large args union, this is less common than with a fully untyped blob, but not impossible.
- **Description length** — packing 39 action signatures into one tool description is long. Research on MCP fault taxonomies identifies "tool description smells" — overly dense descriptions where agents miss constraints for edge-case actions [[5]](https://arxiv.org/html/2504.07946v1).
- **Not RAG-MCP** — the current cutting edge is dynamic tool injection: retrieve only the 3-5 relevant tools per query via semantic search, yielding up to 3x accuracy improvement [[6]](https://arxiv.org/html/2505.03275v1). MCPetty doesn't do this yet. STRAP is the pragmatic middle ground — far better than raw exposure, simpler to implement and operate than RAG-MCP.

The community landed on STRAP independently across multiple projects: [MetaMCP](https://github.com/metatool-ai/metamcp), [1MCP](https://www.npmjs.com/package/@1mcp/agent), Docker MCP Gateway. MCPetty's implementation adds typed args and description-encoded signatures on top of the base pattern.

---

## How to add an MCP

Want a service that isn't supported yet? Two paths:

**Build it yourself** — see [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide: how to fork, which files to touch, the mandatory handler template, and how to open a PR. The guide is written to be followable whether you're an experienced developer or just getting started.

**Open an issue** — no experience required. Describe the service you need and what you'd use it for. I'll implement it as fast as I can.

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
