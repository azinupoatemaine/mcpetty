# Feature Plan — MCPetty next batch

Five features. Implement in order — each builds on the DB and infrastructure of the previous.

---

## 1. Human-in-the-loop approval queue

### What it does
Certain actions require human approval before executing. The agent calls the action, gets a "pending" response with an approval ID, and polls via `check_approval`. The dashboard shows a queue of pending requests. n8n fires when a new one arrives. Approval/rejection can come from the dashboard OR via a webhook callback from n8n.

### DB changes
```sql
-- Which actions require approval (per instance)
CREATE TABLE approval_rules (
  instance_id   TEXT NOT NULL,
  action_pattern TEXT NOT NULL,  -- exact action name or glob e.g. "delete_*"
  enabled        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (instance_id, action_pattern)
);

-- The approval queue itself
CREATE TABLE approval_queue (
  id           TEXT PRIMARY KEY,  -- nanoid, 12 chars
  instance_id  TEXT NOT NULL,
  action       TEXT NOT NULL,
  args_json    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at   INTEGER NOT NULL,
  decided_at   INTEGER,
  decision_by  TEXT,   -- 'dashboard' | 'webhook' | 'timeout'
  reject_reason TEXT,
  result_json  TEXT    -- stored after execution so check_approval can return it
);
```

### Gateway changes (`src/app/mcp/route.ts`)
- In `tools/call`, before routing to handler:
  1. Check if action matches any enabled `approval_rules` row for this instance
  2. Pattern matching: exact match OR glob (`delete_*` matches `delete_local_stack`)
  3. If match: insert into `approval_queue`, fire n8n webhook (see below), return:
     ```
     APPROVAL_REQUIRED — this action needs human confirmation before it can run.
     approval_id: <id>
     action: <action>
     args: <args as JSON>
     Poll status with: { action: "check_approval", args: { approval_id: "<id>" } }
     ```
- Add `check_approval` to every platform tool's built-in actions (alongside `get_page`):
  - args: `{ approval_id: string }`
  - Logic:
    - `pending` → return "Still waiting for human approval. Try again in a few seconds."
    - `rejected` → return "Action rejected by human. Reason: <reason>. Do not retry automatically."
    - `approved` → if `result_json` is already stored (pre-executed), return it. Otherwise execute now, store result, return it.
  - Execution on approval: when user approves in dashboard, execute the action immediately and store `result_json` so the agent's next `check_approval` poll gets the real result instantly.

### Webhook (n8n)
Reuse existing webhook infrastructure (`src/app/api/settings/route.ts` pattern).

New webhook trigger type: `approval_request`. Payload:
```json
{
  "event": "approval_request",
  "approval_id": "abc123",
  "instance_id": "portainer-prod",
  "action": "delete_local_stack",
  "args": { "id": 5, "environmentId": 2 },
  "created_at": 1234567890,
  "dashboard_url": "http://your-host:1234?approval=abc123"
}
```

n8n can approve/reject by calling back:
```
POST /api/approvals/<id>
Authorization: Bearer <gateway-key>
{ "decision": "approved" | "rejected", "reason": "optional" }
```

This endpoint is new (`src/app/api/approvals/[id]/route.ts`). Requires valid Bearer token (gateway key). No session cookie needed — n8n calls this.

### Dashboard changes (`src/app/dashboard-client.tsx`)
- **Approval badge**: red pulsing dot on nav bar when pending approvals exist. Count shown.
- **Approval panel**: slides in from right (or modal) when badge clicked. Shows:
  - Each pending approval as a card: instance name, action, full args (syntax-highlighted JSON), time waiting
  - Approve (green) / Reject (red) buttons. Reject prompts for optional reason.
  - Auto-refresh every 3 seconds while panel is open (simple setInterval poll to `/api/approvals`)
- **Per server card**: "Approval rules" section in the gear modal. List of action patterns with enable/disable toggles. Add new pattern via text input.
- **History tab in panel**: last 20 decided approvals with outcome, who decided, how long it took.

### New API routes
- `GET /api/approvals` — list pending (and recent) queue entries. Session required.
- `POST /api/approvals/[id]` — approve or reject. Accepts session cookie OR Bearer token (for n8n).
- `GET /api/approvals/rules/[instanceId]` — get rules for instance.
- `POST /api/approvals/rules/[instanceId]` — save rules for instance.

---

## 2. Automatic health checks + gateway auto-disable

### What it does
Background timer pings each enabled instance on a configurable interval. If an instance fails N consecutive pings, it's auto-disabled in the gateway (removed from `tools/list`). Fires n8n webhook on state change. Re-enables automatically on recovery. Dashboard shows check state clearly, distinguishing auto-disabled from manually disabled.

### DB changes
Add columns to `installed_mcps`:
```sql
ALTER TABLE installed_mcps ADD COLUMN health_check_interval_seconds INTEGER DEFAULT 0;
-- 0 = disabled (manual only)
ALTER TABLE installed_mcps ADD COLUMN health_check_fail_threshold INTEGER DEFAULT 3;
-- consecutive failures before auto-disable
ALTER TABLE installed_mcps ADD COLUMN health_consecutive_fails INTEGER DEFAULT 0;
ALTER TABLE installed_mcps ADD COLUMN health_last_checked_at INTEGER;
ALTER TABLE installed_mcps ADD COLUMN health_last_status TEXT;  -- 'ok' | 'fail'
ALTER TABLE installed_mcps ADD COLUMN health_last_error TEXT;
ALTER TABLE installed_mcps ADD COLUMN auto_disabled INTEGER DEFAULT 0;
-- distinguish: enabled=0 + auto_disabled=1 (recoverable) vs enabled=0 + auto_disabled=0 (manual)
```

### Background checker (`src/lib/health-scheduler.ts`)
New file. Called from `src/instrumentation.ts` after `bootAll()`.

```
setInterval every 30 seconds:
  for each installed MCP where health_check_interval_seconds > 0 and enabled = 1 OR auto_disabled = 1:
    if (now - health_last_checked_at) >= health_check_interval_seconds:
      run ping()
      if ok:
        clear consecutive_fails
        if auto_disabled: re-enable, fire webhook (recovered)
      if fail:
        increment consecutive_fails
        if consecutive_fails >= threshold AND not already auto_disabled:
          set auto_disabled = 1, enabled = 0
          fire webhook (went down)
```

### Webhook
New trigger type: `health_change`. Payload:
```json
{
  "event": "health_change",
  "instance_id": "portainer-prod",
  "status": "down" | "recovered",
  "error": "Connection refused",
  "consecutive_fails": 3,
  "timestamp": 1234567890
}
```

### Dashboard changes
- Per server card: gear modal → "Health check" section: interval dropdown (off / 1min / 5min / 15min / 30min), fail threshold (1-5).
- Status badge: `ONLINE`, `OFFLINE`, `AUTO-DISABLED` (amber, distinct from grey `DISABLED`).
- `AUTO-DISABLED` card shows: "Disabled automatically after 3 consecutive failures. Last error: <msg>. Will re-enable on recovery." + manual "Re-enable now" button.
- Last check time shown as relative timestamp on card (e.g. "checked 2m ago").

---

## 3. Response diff tracking

### What it does
For list-type actions, MCPetty stores a snapshot of the last result. On the next call, it diffs the new result against the snapshot. If changes are detected AND this diff hasn't been shown in the current session yet, a change summary is prepended to the response. Subsequent calls in the same session skip the prefix. Changes made after the snapshot was taken appear in the NEXT session, not the current one.

### Which actions get diffs
Actions whose name starts with `list_` or `get_` that return arrays. Detected automatically by inspecting result type at runtime. Can be overridden per-action if needed.

### DB changes
```sql
-- Stores last known result per (instance, action, args_hash)
CREATE TABLE action_snapshots (
  instance_id  TEXT NOT NULL,
  action       TEXT NOT NULL,
  args_hash    TEXT NOT NULL,   -- sha256(JSON.stringify(args))
  snapshot_json TEXT NOT NULL,
  item_count   INTEGER,         -- length of result array, for quick diff
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (instance_id, action, args_hash)
);

-- Tracks which diffs have been shown per session (prevents re-showing)
CREATE TABLE diff_shown (
  session_id   TEXT NOT NULL,
  instance_id  TEXT NOT NULL,
  action       TEXT NOT NULL,
  args_hash    TEXT NOT NULL,
  shown_at     INTEGER NOT NULL,
  PRIMARY KEY (session_id, instance_id, action, args_hash)
);
```

### Logic (in `src/app/mcp/route.ts`, after result is obtained)
```
1. Is result an array? No → skip entirely.
2. Load snapshot for (instance_id, action, args_hash).
3. No snapshot? Save current result as snapshot. Return result without prefix.
4. Snapshot exists. Has this diff already been shown this session?
   (check diff_shown for session_id + instance_id + action + args_hash)
   Yes → return result without prefix.
5. Diff the arrays:
   - Added items: in new result but not in snapshot (match by id/name field, auto-detected)
   - Removed items: in snapshot but not in new result
   - No changes → return result without prefix. Update snapshot.
6. Changes found:
   - Insert into diff_shown (marks as shown for this session)
   - Update snapshot to new result
   - Prepend to response:
     [CHANGES SINCE LAST SESSION: +2 added, 1 removed — details below]
     Added: <name/id of new items>
     Removed: <name/id of removed items>
     ────────────────────────────────
     <actual result follows>
```

### Key detail: "added now, visible next session"
The snapshot is updated at step 6 (when diff is shown) AND at step 3 (first ever call). This means: if you add a container NOW (mid-session), the snapshot for this session already reflects the old state. When the agent calls again this session, the diff was already shown (diff_shown row exists) so it won't show again. Next session: no diff_shown row → diff runs fresh → agent sees the addition.

### Identifying items for diff
Try these fields in order: `id`, `name`, `path`, `title`, `Id`, `Name`. If none found, fall back to count-only diff: `"3 items → 5 items (+2)"`.

---

## 4. Agent persona / context injection per gateway

### What it does
Per named gateway key, a user-written text prefix is prepended to every tool response that goes through that gateway. Steers agent behaviour at the response layer without touching system prompts.

### DB changes
```sql
ALTER TABLE named_gateways ADD COLUMN context_prefix TEXT DEFAULT '';
```

### Gateway changes (`src/app/mcp/route.ts`)
In `tools/call`, after result is obtained and before returning:
```
if (gwCtx?.context_prefix && gwCtx.context_prefix.trim()) {
  response = gwCtx.context_prefix.trim() + '\n\n────────────────────────────────\n\n' + response
}
```
Apply after diff prefix (if any), before returning to agent.

### Dashboard changes (`src/app/gateways-client.tsx`)
In each named gateway card (expanded view):
- New "Agent context" section with a textarea.
- Placeholder: `"e.g. This is the PRODUCTION environment. Treat all destructive operations as irreversible. Always confirm before deleting."`
- Character counter + estimated token cost (`Math.ceil(chars / 4)` tokens).
- Warning at >500 chars: "This prefix adds ~X tokens to every response."
- Saved inline on blur or via explicit Save button.

---

## 5. Token burn rate tracking (eye candy)

### What it does
Estimates and visualises the token cost of MCPetty's tool schema overhead. Shows how many tokens are consumed per turn just by having MCPs connected — before the conversation even starts. Breakdown by instance, trend over time, context window gauge.

### Token estimation logic
Run at `tools/list` time and cache. Per instance tool:
- Tool name: `ceil(name.length / 4)`
- Description (including action signatures): `ceil(description.length / 4)`
- Input schema JSON: `ceil(JSON.stringify(inputSchema).length / 4)`
- Sum = tokens for that instance

Store in memory (recompute when instances change). Also log to `tool_call_log` or a new lightweight table on each `tools/list` call so trend data exists.

```sql
CREATE TABLE schema_token_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp    INTEGER NOT NULL,
  gateway_id   TEXT,   -- null = master key
  total_tokens INTEGER NOT NULL,
  breakdown_json TEXT  -- { instanceId: tokens, ... }
);
```

Log one row per `tools/list` call. Prune rows older than 30 days.

### New Insights tab: "Token Cost"

Visual elements (all inline styles, terminal aesthetic):

**Hero number** — large, neon green:
```
12,847 tokens
consumed by tool schema per turn
```

**Context window gauge** — horizontal bar showing schema tokens as % of common context windows:
```
GPT-4o    128K  ████░░░░░░░░░░░░░░░░  10%
Claude    200K  ██░░░░░░░░░░░░░░░░░░   6%
Gemini     1M   ░░░░░░░░░░░░░░░░░░░░   1%
```

**Per-instance breakdown** — horizontal bar chart, each instance a row:
```
portainer-prod    ████████████░░░░░░  4,200 tokens  (33%)
proxmox-home      ████████░░░░░░░░░░  2,800 tokens  (22%)
wazuh             ██████████████░░░░  4,900 tokens  (38%)
wikijs-home       ██░░░░░░░░░░░░░░░░    600 tokens   (5%)
...
```
Bars are neon green → amber → red based on % of total. Clicking a bar expands to show action-level breakdown.

**Trend chart** — sparkline of total tokens over last 7 days. Shows inflection points when instances were added/removed/tools disabled.

**"What if" panel** — shows potential savings:
```
Disable 5 Wazuh tools you've never called  →  save ~320 tokens
```
Pull from tool_filters (disabled tools) and tool_call_log (never-called tools in last 30 days).

**Comparison badge** — small card:
```
Without MCPetty (raw tool exposure):
  ~94,000 tokens  (183 tools × avg 513 tokens)
With MCPetty (STRAP):
  ~12,847 tokens
  You save 86% of context overhead.
```
The "without MCPetty" number is estimated from summing all tools across all native handlers.

---

## Implementation order

1. DB migrations (all tables/columns for all 5 features — do once)
2. Feature 3 (health checks) — pure backend, no complex UI, validates scheduler pattern
3. Feature 4 (diff tracking) — pure gateway logic, no new UI components
4. Feature 9 (token cost) — new Insights tab, purely additive
5. Feature 7 (context injection) — small gateway change + small gateway UI change
6. Feature 1 (approval queue) — largest surface area, builds on everything else

---

## Files touched (estimate)

| File | Changes |
|---|---|
| `src/lib/db.ts` | All new tables + migrations + query functions |
| `src/lib/health-scheduler.ts` | New file — background health check loop |
| `src/instrumentation.ts` | Call `startHealthScheduler()` after bootAll |
| `src/app/mcp/route.ts` | Approval check, diff prefix, context prefix injection |
| `src/app/api/approvals/route.ts` | New — list/decide approvals |
| `src/app/api/approvals/[id]/route.ts` | New — approve/reject single (session + Bearer) |
| `src/app/api/approvals/rules/[instanceId]/route.ts` | New — get/save rules |
| `src/app/dashboard-client.tsx` | Approval badge, approval panel, health check settings |
| `src/app/gateways-client.tsx` | Context prefix textarea |
| `src/app/insights-client.tsx` | New "Token Cost" tab |
| `src/app/settings-client.tsx` | New approval webhook trigger type |
