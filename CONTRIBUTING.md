# Contributing — Adding a New MCP

MCPetty is built to be extended. Every MCP is a native TypeScript handler — no subprocesses, no extra binaries, no Dockerfile changes. If the service has a REST or GraphQL API, you can add it.

---

## Before you start

Look at the existing native handlers for reference on patterns, not necessarily for code to copy:

- `src/lib/native/portainer.ts` — REST API, API key auth, multi-node aggregation
- `src/lib/native/wikijs.ts` — GraphQL API, Bearer token auth
- `src/lib/native/proxmox.ts` — REST API, custom auth header, form-encoded mutations, path traversal protection
- `src/lib/native/wazuh.ts` — REST API, Basic auth, dual-endpoint (manager + indexer)
- `src/lib/native/karakeep.ts` — REST API, Bearer token, pagination

Also look at the upstream MCP implementations for the service you're adding. Good places to find them:
- https://github.com/modelcontextprotocol/servers
- https://glama.ai/mcp/servers
- Search GitHub for `<service-name> mcp server`

You don't need to use their code — just read it to understand which API endpoints they call and what tools they expose.

---

## Process

1. Fork the repository
2. Create a branch: `git checkout -b mcp/<service-name>`
3. Implement the handler (see template below)
4. Register it in `src/lib/native/index.ts`
5. Add a catalog entry in `src/lib/mcp-catalog.ts`
6. Open a pull request against `main`

---

## The mandatory template

Every native handler must follow this structure exactly. Do not deviate.

```typescript
// src/lib/native/myservice.ts
import { getCredential } from '../db'
import type { MCPTool } from '../mcp-client'
import { restFetch } from './http'
// import { gqlFetch } from './http'  // use this instead for GraphQL APIs

// ─── Tools ────────────────────────────────────────────────────────────────────

export const TOOLS: MCPTool[] = [
  {
    name: 'do_thing',
    description: 'Does the thing.',
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
    await restFetch(base, '/api/health', token)
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

### Rules

- **Always use `restFetch` or `gqlFetch`** from `./http` — never raw `fetch()`. These handle real error extraction, localhost hints, 401/403/404 messages.
- **`cfg(instanceId)`** — always validate credentials before any call. Throw a clear message listing the missing credential keys.
- **`ping()`** — call the lightest possible endpoint. Status/health checks, not a full list query.
- **`call()`** — always a `switch` with a `default` that throws `Unknown <Service> tool: ${toolName}`.
- **One description per tool** — clear, one sentence, no padding.
- **No raw `process.env`** — all credentials go through `getCredential(instanceId, key)`.

### `restFetch` signature

```typescript
restFetch<T>(baseUrl, path, token, authHeader?, authScheme?, fetchInit?)
// Default:  Authorization: Bearer <token>
// API key:  restFetch(base, '/api/...', token, 'X-API-Key', '')
```

### `gqlFetch` signature

```typescript
gqlFetch<T>(baseUrl, token, query, variables?)
// Always POST to /graphql with Authorization: Bearer <token>
```

---

## Registering the handler

In `src/lib/native/index.ts`:

```typescript
import * as myservice from './myservice'

export const NATIVE: Record<string, NativeHandler> = {
  // existing entries...
  myservice: { tools: myservice.TOOLS, ping: myservice.ping, call: myservice.call },
}
```

---

## Adding the catalog entry

In `src/lib/mcp-catalog.ts`:

```typescript
{
  id: 'myservice',
  name: 'My Service',
  description: 'One sentence — what this service does.',
  transport: 'native',
  credentials: [
    { key: 'MY_URL',   label: 'URL',   description: 'Base URL of the service e.g. http://192.168.1.x:8080', type: 'url',    required: true },
    { key: 'MY_TOKEN', label: 'Token', description: 'API key or access token',                               type: 'secret', required: true },
  ],
}
```

Credential `type` values: `url`, `secret`, `text`.

---

## Transport types

Always prefer `native`. Only deviate if there is a strong reason.

| Transport | When to use | Dockerfile |
|---|---|---|
| `native` | Service has a REST or GraphQL API | No change needed |
| `http` | Subprocess must run alongside MCPetty, speaks MCP over HTTP | Add `RUN npm install -g <package>` |
| `stdio` | Subprocess speaks JSON-RPC over stdin/stdout | Add binary download |

---

## PR checklist

- [ ] Handler follows the mandatory template exactly
- [ ] `ping()` calls a lightweight endpoint
- [ ] All tools have a one-sentence description
- [ ] Credentials validated in `cfg()` with a clear error message
- [ ] Registered in `NATIVE` map
- [ ] Catalog entry added with correct credential schema
- [ ] No raw `fetch()` calls
- [ ] No `process.env` usage

---

## Don't want to write code?

Open an issue describing the service you need — name, URL, what you'd use it for. No experience required. I'll implement it as fast as I can.
