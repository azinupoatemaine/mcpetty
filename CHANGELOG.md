# Changelog

MCPetty deploys continuously from `main`, so entries are dated rather than versioned.

---

## 2026-07-30 — security audit + MCP prompts

### ⚠️ Breaking

**Approval callbacks using a gateway key stop working.** `POST /api/approvals/<id>` now
accepts only a dashboard session or the new **approver key** (Settings → n8n Webhook →
Approver Key). An n8n or Slack flow still sending the gateway key will get 401s with no
other symptom — swap the key before deploying.

The master gateway key migrates to sealed storage automatically **and keeps its value**.
No client reconfiguration; existing `claude mcp add` configs keep working.

### Security

- **Approvals could be self-approved.** `/api/approvals/<id>` accepted the master gateway
  key — the same credential handed to the MCP client. An agent could trigger a gated
  action, approve its own pending request, and poll `check_approval` to execute it. Named
  gateway keys were also accepted with no instance-scope check. Both paths removed in
  favour of a dedicated approver key, compared in constant time.
- **Page tokens are bound to `{platform, scopeId}`.** A `get_page` token minted in one
  namespace could be redeemed in another, returning buffered output from an instance the
  caller had no access to. A mismatch now returns the same message as an expired token, so
  it leaks nothing about whether the token exists.
- **`check_approval` re-checks the stored action against the caller's scope** before
  executing it — previously only the literal string `check_approval` was checked, so a
  namespace with the action disabled could redeem another namespace's approval. Approvals
  now expire after `APPROVAL_TTL_MS` (1h) if never redeemed.
- **Tool results are redacted before they are persisted or sent.** `redactResultText()`
  applies the same key list to results that `redact()` applied to args only, covering both
  `tool_call_log.result_json` and the webhook `result_preview`. Backend responses routinely
  carry container env, stack files, and agent keys.
- **Master gateway key sealed at rest** (AES-256-GCM under the master secret) instead of a
  plaintext `settings` row, and compared with `secretEquals()` rather than `===`.
- **Subprocess MCPs get a whitelisted env** (`ENV_PASSTHROUGH`) instead of
  `{...process.env}`, which had been handing every third-party binary `MCPETTY_SECRET` and
  `DATA_DIR` — enough to open the DB and decrypt every other instance's credentials.
- **Karakeep sanitises model-supplied path segments.** It was the only handler without a
  `seg()`/`safeSeg()` guard; `bookmarkId: "../../admin/users"` normalised out of the
  `/api/v1` prefix and reached arbitrary endpoints with the API key attached.
- **`listTools()` caps at `MAX_TOOL_PAGES` (50) and bails on a repeated cursor**, in both
  `mcp-client.ts` and `stdio-bridge.ts`. `http-proxy` points at a user-supplied URL, so the
  far end is not trusted to terminate its own pagination.
- **Injection scanning covers the full result** before pagination slices it, and each
  `get_page` page on the way out. Previously anything past item 50 was never scanned.
- **Rate limiting runs before the cache lookup** — a served cache hit is still a call.
- **Login lockout is per-username as well as per-IP.** The IP bucket keys on
  `x-forwarded-for`, which a direct client can forge; the account bucket is what actually
  bounds a password guess.
- **Webhook URLs validated on save**, not only in the test endpoint
  (`src/lib/webhook-url.ts`). Blocks loopback, `0.0.0.0`, link-local and non-http(s).
  RFC1918 stays allowed — self-hosted deployments legitimately target private networks.
- **Meta-MCP filtered to the caller's namespace.** `get_status`, `get_recent_calls`,
  `get_error_patterns`, `get_top_actions` and `get_sessions` no longer expose instances or
  activity outside the caller's scope.
- **Origin check added to `DELETE /mcp` and `DELETE /mcp/<slug>`.**

### Fixed

- **Proxmox: every bodyless mutation returned HTTP 500** ([#7](../../issues/7)). `pveMutate()`
  set `Content-Type: application/x-www-form-urlencoded` only when there were params to
  serialize, so bodyless calls fell through to `restFetch`'s `application/json` default and
  sent zero bytes. Proxmox parses the body by declared type and failed with *"malformed JSON
  string ... at character offset 0"* — an error from PVE, not from MCPetty, which made it
  look like a cluster problem. The header is now set unconditionally for POST/PUT/DELETE.
  Affected: `start_vm`, `stop_vm`, `shutdown_vm`, `reset_vm`, `start_container`,
  `stop_container` (both branches), `restart_container`, `delete_iso`, `cancel_job`.
- **The dashboard handed out a `claude mcp add` command that only worked in one folder.**
  `claude mcp add` defaults to `-s local`, which registers the server under
  `projects.<absolute-path>.mcpServers` in `~/.claude.json` — so it exists only in the
  directory the command was run from. Copy it from the dashboard, then open Claude Code
  anywhere else, and the server is silently absent. Every suggested command (Settings, the
  namespace card, the one-time-key modal, README) now includes `-s user`, with a line
  explaining what the flag does. `-s project` is deliberately never suggested: it writes a
  committed `.mcp.json`, and these commands embed a bearer token.
- **Health auto-disable was a no-op on the gateway.** `installed_mcps.enabled` was written
  by the scheduler and never read on the `tools/call` path, so an instance the scheduler
  had given up on still accepted calls and burned the full 30s native timeout on each.
- **Unreachable platforms vanished from `tools/list`.** A failed probe returned `null` and
  the platform disappeared, so an agent lost a capability with no way to tell "gone" from
  "broken". They are now listed with an `[OFFLINE — <error>]` prefix. A platform is omitted
  only when no action list is known at all — an empty `action` enum would be invalid schema.
- **`tools/list` no longer probes everything on every call.** Probes are cached per instance
  for 60s; a fresh scheduler health record is trusted instead of re-probing. Invalidated on
  install, uninstall, credential change, and health flips.
- **Front page was slow to load.** `/api/servers` probes every instance in one `Promise.all`,
  so the dashboard waits on the slowest backend, and it ran on every mount with no cache.
  Two causes, both fixed:
  - `mcp-client.ts` used bare `fetch` with **no timeout at all** (unlike `native/http.ts`,
    which has a 5s deadline). An `http-proxy` backend that accepted the connection and then
    stalled would hang the dashboard for minutes — undici's default header timeout. All
    three call paths (`initSession`, `listTools`, `callTool`) now use a 5s deadline.
  - Network probes are cached for 30s in `src/lib/instance-probe.ts`, so navigation and
    reloads are instant. `?fresh=1` bypasses it; the dashboard sends it for the refresh
    button and the 120s auto-poll, so an explicit refresh always re-probes. Name, tags and
    health config are still read from SQLite on every request — only the network half is
    cached, so an edit never looks stale.

  `invalidatePlatformProbe()` now clears both this and the gateway's `tools/list` cache, so
  one call covers install, uninstall and credential changes.
- **Cert-error retry reused a spent `AbortSignal`**, so the retry could abort before leaving
  the process. Each attempt now gets a fresh timeout.
- **`writeSecretFile()` now fsyncs before rename** and cleans up its temp file on failure.
  Without the fsync the rename could land with unflushed content — exactly the truncated
  `.secret` that `getSecret()` refuses to accept.
- **Settings save reported success on a rejected write.** `useSave()` flashed "✓ saved" on
  any response; it now surfaces the server's error.

### Added

- **MCP prompts** — `prompts/list` and `prompts/get`, advertised in the initialize
  capabilities. Prompts are named, parameterised templates the client surfaces as slash
  commands (`/mcpetty:diagnose-stack`) and cost **zero** per-request schema tokens, since
  clients fetch them on demand. Stored per-namespace (`namespace_id NULL` = every scope; a
  namespace-specific prompt overrides a global one of the same name). Arguments are declared
  by writing `{{name}}` in the template, so the two can't drift apart. Managed in
  Settings → Prompts.
- **Test connection before install** — `POST /api/library/test` writes credentials under a
  throwaway instance, probes for real, and deletes them in a `finally`. Reports latency and
  tool count, and flags the reachable-but-zero-tools case. Button in the install form.
- **"Any Remote MCP" catalog entry** (`custom`) — point MCPetty at any Streamable HTTP MCP
  server and it inherits tool filters, approvals, namespaces and telemetry without a handler.
- **Build identification in the footer.** The image is always tagged `:latest` (main) or
  `:<branch>`, so nothing on a running instance said which commit it was. The footer now
  shows `v<version> · <short sha>`, with branch, full SHA and build timestamp on hover.
  Injected as Docker build args and inlined by `next build`; a local or arg-less build reads
  `dev` rather than pretending to be a release.

  This also collapses three hardcoded version strings that had drifted apart —
  `nav.tsx` said `v2.0.2`, `package.json` said `0.1.0`, and the MCP `serverInfo` said
  `1.0.5`. All now read from `src/lib/version.ts`.

### Deliberately unchanged

Recorded so they don't get re-litigated:

1. **`NODE_TLS_REJECT_UNAUTHORIZED = '0'` stays global** (`instrumentation.ts`), per the
   HTTP/self-signed-TLS constraint in CLAUDE.md. It does disable certificate verification
   for *all* outbound requests, including webhooks to public hosts. Scoping it to private
   hosts needs a per-request undici `Agent`; the `isPrivateHost`/`fetchInsecure` machinery
   in `native/http.ts` is the vestige of the old per-request approach and is currently inert.
2. **The `gateways` table and `/api/gateways/*` remain.** No MCP route resolves those keys
   any more (`gateways-client.tsx` talks exclusively to `/api/namespaces`), so it is a dead
   parallel RBAC system — but it no longer grants approval rights, so it is not a hole.
   Removing a subsystem is a product decision, not a fix.
3. **`csrfSafe()` / `checkOrigin()` allow requests with no `Origin` or `Referer`.**
   Non-browser MCP clients send neither; `sameSite: 'strict'` on the session cookie carries
   the load.

### Verification

`tsc` clean · 68 tests (19 new) · production build compiles · lint unchanged in character.
The sealed-key migration is covered by a real-SQLite test because it runs on boot and on
every `/mcp` request.

**Not exercised against a live deployment** — static analysis and unit tests only. No
container booted, no real Portainer/Proxmox/Wazuh contacted.
