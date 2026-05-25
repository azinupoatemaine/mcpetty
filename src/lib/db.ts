import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { encrypt, decrypt, validateSecret } from './crypto'

const DATA_DIR = process.env.DATA_DIR || '/app/data'
const DB_PATH  = join(DATA_DIR, 'mcpetty.db')

let _db: Database.Database | null = null

function db(): Database.Database {
  if (_db) return _db
  validateSecret()
  mkdirSync(DATA_DIR, { recursive: true })
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  _db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      server_name     TEXT    NOT NULL,
      key_name        TEXT    NOT NULL,
      encrypted_value BLOB    NOT NULL,
      iv              BLOB    NOT NULL,
      tag             BLOB    NOT NULL,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      UNIQUE(server_name, key_name)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      action      TEXT    NOT NULL,
      server_name TEXT    NOT NULL,
      key_name    TEXT    NOT NULL,
      timestamp   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS installed_mcps (
      instance_id  TEXT    PRIMARY KEY,
      type         TEXT    NOT NULL DEFAULT '',
      name         TEXT    NOT NULL DEFAULT '',
      port         INTEGER NOT NULL DEFAULT 0,
      installed_at INTEGER NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      username      TEXT    PRIMARY KEY,
      password_hash BLOB    NOT NULL,
      salt          TEXT    NOT NULL,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT    PRIMARY KEY,
      username   TEXT    NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_filters (
      mcp_id    TEXT    NOT NULL,
      tool_name TEXT    NOT NULL,
      enabled   INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (mcp_id, tool_name)
    );

    CREATE TABLE IF NOT EXISTS gateways (
      id         TEXT    PRIMARY KEY,
      name       TEXT    NOT NULL,
      key_hash   TEXT    NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gateway_instances (
      gateway_id  TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      PRIMARY KEY (gateway_id, instance_id)
    );

    CREATE TABLE IF NOT EXISTS tool_call_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp  INTEGER NOT NULL,
      platform   TEXT    NOT NULL,
      action     TEXT    NOT NULL,
      args_json  TEXT    NOT NULL DEFAULT '{}',
      outcome    TEXT    NOT NULL,
      latency_ms INTEGER NOT NULL,
      error      TEXT
    );

    CREATE INDEX IF NOT EXISTS tool_call_log_ts ON tool_call_log(timestamp);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      gateway_id  TEXT    PRIMARY KEY,
      max_calls   INTEGER NOT NULL,
      window_secs INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS changelog (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      type      TEXT    NOT NULL,
      subject   TEXT    NOT NULL DEFAULT '',
      detail    TEXT    NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS changelog_ts ON changelog(timestamp);

    CREATE TABLE IF NOT EXISTS description_overrides (
      instance_id TEXT NOT NULL,
      tool_name   TEXT NOT NULL,
      description TEXT NOT NULL,
      PRIMARY KEY (instance_id, tool_name)
    );

    CREATE TABLE IF NOT EXISTS approval_rules (
      instance_id    TEXT NOT NULL,
      action_pattern TEXT NOT NULL,
      enabled        INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (instance_id, action_pattern)
    );

    CREATE TABLE IF NOT EXISTS approval_queue (
      id            TEXT    PRIMARY KEY,
      instance_id   TEXT    NOT NULL,
      action        TEXT    NOT NULL,
      args_json     TEXT    NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'pending',
      created_at    INTEGER NOT NULL,
      decided_at    INTEGER,
      decision_by   TEXT,
      reject_reason TEXT,
      result_json   TEXT
    );

    CREATE INDEX IF NOT EXISTS approval_queue_status ON approval_queue(status);
    CREATE INDEX IF NOT EXISTS approval_queue_instance ON approval_queue(instance_id);

    CREATE TABLE IF NOT EXISTS action_snapshots (
      instance_id   TEXT    NOT NULL,
      action        TEXT    NOT NULL,
      args_hash     TEXT    NOT NULL,
      snapshot_json TEXT    NOT NULL,
      item_count    INTEGER,
      updated_at    INTEGER NOT NULL,
      PRIMARY KEY (instance_id, action, args_hash)
    );

    CREATE TABLE IF NOT EXISTS diff_shown (
      session_id  TEXT    NOT NULL,
      instance_id TEXT    NOT NULL,
      action      TEXT    NOT NULL,
      args_hash   TEXT    NOT NULL,
      shown_at    INTEGER NOT NULL,
      PRIMARY KEY (session_id, instance_id, action, args_hash)
    );

    CREATE TABLE IF NOT EXISTS schema_token_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp      INTEGER NOT NULL,
      gateway_id     TEXT,
      total_tokens   INTEGER NOT NULL,
      breakdown_json TEXT
    );

    CREATE INDEX IF NOT EXISTS schema_token_log_ts ON schema_token_log(timestamp);

    CREATE TABLE IF NOT EXISTS namespaces (
      id         TEXT    PRIMARY KEY,
      name       TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS namespace_keys (
      id           TEXT    PRIMARY KEY,
      namespace_id TEXT    NOT NULL,
      key_hash     TEXT    NOT NULL UNIQUE,
      label        TEXT    NOT NULL DEFAULT '',
      created_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS namespace_keys_hash ON namespace_keys(key_hash);

    CREATE TABLE IF NOT EXISTS namespace_servers (
      namespace_id TEXT NOT NULL,
      instance_id  TEXT NOT NULL,
      PRIMARY KEY (namespace_id, instance_id)
    );

    CREATE TABLE IF NOT EXISTS namespace_tool_filters (
      namespace_id TEXT    NOT NULL,
      instance_id  TEXT    NOT NULL,
      tool_name    TEXT    NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (namespace_id, instance_id, tool_name)
    );

    CREATE TABLE IF NOT EXISTS namespace_middleware (
      namespace_id TEXT NOT NULL,
      type         TEXT NOT NULL,
      config_json  TEXT NOT NULL,
      PRIMARY KEY (namespace_id, type)
    );
  `)
  migrateInstalledMCPs()
  migrateInstalledMCPsTag()
  migrateToolCallLog()
  migrateSessionsTable()
  migrateInstalledMCPsHealth()
  migrateGatewaysContextPrefix()
  return _db
}

function audit(action: string, serverName: string, keyName: string) {
  db().prepare(
    'INSERT INTO audit_log (action, server_name, key_name, timestamp) VALUES (?, ?, ?, ?)'
  ).run(action, serverName, keyName, Date.now())
}

// ─── Credentials ─────────────────────────────────────────────────────────────

export function setCredential(serverName: string, keyName: string, value: string): void {
  const { encrypted, iv, tag } = encrypt(value, serverName, keyName)
  const now = Date.now()
  db().prepare(`
    INSERT INTO credentials (server_name, key_name, encrypted_value, iv, tag, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(server_name, key_name) DO UPDATE SET
      encrypted_value = excluded.encrypted_value,
      iv              = excluded.iv,
      tag             = excluded.tag,
      updated_at      = excluded.updated_at
  `).run(serverName, keyName, encrypted, iv, tag, now, now)
  audit('SET', serverName, keyName)
}

export function getCredential(serverName: string, keyName: string): string | null {
  const row = db().prepare(
    'SELECT encrypted_value, iv, tag FROM credentials WHERE server_name = ? AND key_name = ?'
  ).get(serverName, keyName) as { encrypted_value: Buffer; iv: Buffer; tag: Buffer } | undefined
  if (!row) return null
  audit('ACCESS', serverName, keyName)
  return decrypt({ encrypted: row.encrypted_value, iv: row.iv, tag: row.tag }, serverName, keyName)
}

export function deleteCredential(serverName: string, keyName: string): void {
  db().prepare('DELETE FROM credentials WHERE server_name = ? AND key_name = ?').run(serverName, keyName)
  audit('DELETE', serverName, keyName)
}

export function deleteAllCredentials(serverName: string): void {
  db().prepare('DELETE FROM credentials WHERE server_name = ?').run(serverName)
}

export interface CredentialStatus {
  isSet:     boolean
  updatedAt: number | null
}

export function credentialStatus(serverName: string, keyName: string): CredentialStatus {
  const row = db().prepare(
    'SELECT updated_at FROM credentials WHERE server_name = ? AND key_name = ?'
  ).get(serverName, keyName) as { updated_at: number } | undefined
  return { isSet: !!row, updatedAt: row?.updated_at ?? null }
}

// ─── Installed MCPs ───────────────────────────────────────────────────────────

function migrateToolCallLog() {
  const cols = (_db!.prepare("SELECT name FROM pragma_table_info('tool_call_log')").all() as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('session_id')) {
    _db!.exec('ALTER TABLE tool_call_log ADD COLUMN session_id TEXT')
    _db!.exec('CREATE INDEX IF NOT EXISTS tool_call_log_session ON tool_call_log(session_id)')
  }
  if (!cols.includes('gateway_id')) {
    _db!.exec('ALTER TABLE tool_call_log ADD COLUMN gateway_id TEXT')
  }
  if (!cols.includes('user_agent')) {
    _db!.exec('ALTER TABLE tool_call_log ADD COLUMN user_agent TEXT')
  }
  if (!cols.includes('result_json')) {
    _db!.exec('ALTER TABLE tool_call_log ADD COLUMN result_json TEXT')
  }
}

function migrateInstalledMCPsTag() {
  const cols = (db().prepare("SELECT name FROM pragma_table_info('installed_mcps')").all() as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('tag')) {
    _db!.exec('ALTER TABLE installed_mcps ADD COLUMN tag TEXT')
  } else {
    // migrate single-tag strings to JSON arrays
    _db!.exec("UPDATE installed_mcps SET tag = json_array(tag) WHERE tag IS NOT NULL AND tag NOT LIKE '[%'")
  }
}

function migrateSessionsTable() {
  const cols = (_db!.prepare("SELECT name FROM pragma_table_info('sessions')").all() as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('last_accessed')) {
    _db!.exec('ALTER TABLE sessions ADD COLUMN last_accessed INTEGER')
    _db!.exec('UPDATE sessions SET last_accessed = created_at WHERE last_accessed IS NULL')
  }
}

function migrateInstalledMCPsHealth() {
  const cols = (_db!.prepare("SELECT name FROM pragma_table_info('installed_mcps')").all() as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('health_check_interval_seconds')) {
    _db!.exec('ALTER TABLE installed_mcps ADD COLUMN health_check_interval_seconds INTEGER DEFAULT 0')
    _db!.exec('ALTER TABLE installed_mcps ADD COLUMN health_check_fail_threshold INTEGER DEFAULT 3')
    _db!.exec('ALTER TABLE installed_mcps ADD COLUMN health_consecutive_fails INTEGER DEFAULT 0')
    _db!.exec('ALTER TABLE installed_mcps ADD COLUMN health_last_checked_at INTEGER')
    _db!.exec('ALTER TABLE installed_mcps ADD COLUMN health_last_status TEXT')
    _db!.exec('ALTER TABLE installed_mcps ADD COLUMN health_last_error TEXT')
    _db!.exec('ALTER TABLE installed_mcps ADD COLUMN auto_disabled INTEGER DEFAULT 0')
  }
}

function migrateGatewaysContextPrefix() {
  const cols = (_db!.prepare("SELECT name FROM pragma_table_info('gateways')").all() as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('context_prefix')) {
    _db!.exec("ALTER TABLE gateways ADD COLUMN context_prefix TEXT DEFAULT ''")
  }
}

// Run once after table creation to migrate old single-column schema
function migrateInstalledMCPs() {
  const cols = (db().prepare("SELECT name FROM pragma_table_info('installed_mcps')").all() as Array<{ name: string }>).map((c) => c.name)
  if (cols.includes('id') && !cols.includes('instance_id')) {
    db().exec(`
      ALTER TABLE installed_mcps RENAME TO _installed_mcps_old;
      CREATE TABLE installed_mcps (
        instance_id  TEXT    PRIMARY KEY,
        type         TEXT    NOT NULL DEFAULT '',
        name         TEXT    NOT NULL DEFAULT '',
        port         INTEGER NOT NULL DEFAULT 0,
        installed_at INTEGER NOT NULL,
        enabled      INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO installed_mcps (instance_id, type, name, port, installed_at, enabled)
        SELECT id, id, id, port, installed_at, enabled FROM _installed_mcps_old;
      DROP TABLE _installed_mcps_old;
    `)
  }
}

export interface InstalledMCP {
  instanceId:                 string
  type:                       string
  name:                       string
  port:                       number
  installedAt:                number
  enabled:                    boolean
  tags:                       string[]
  healthCheckIntervalSeconds: number
  healthCheckFailThreshold:   number
  healthConsecutiveFails:     number
  healthLastCheckedAt:        number | null
  healthLastStatus:           string | null
  healthLastError:            string | null
  autoDisabled:               boolean
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp'
}

export function uniqueInstanceId(base: string): string {
  const existing = (db().prepare('SELECT instance_id FROM installed_mcps').all() as Array<{ instance_id: string }>).map((r) => r.instance_id)
  if (!existing.includes(base)) return base
  let i = 2
  while (existing.includes(`${base}-${i}`)) i++
  return `${base}-${i}`
}

export function logChange(type: string, subject: string, detail = ''): void {
  try {
    db().prepare('INSERT INTO changelog (timestamp, type, subject, detail) VALUES (?, ?, ?, ?)').run(Date.now(), type, subject, detail)
  } catch { /* never let audit logging break operations */ }
}

export interface ChangelogEntry {
  id:        number
  timestamp: number
  type:      string
  subject:   string
  detail:    string
}

export function getChangelog(days = 30): ChangelogEntry[] {
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  return db().prepare(
    'SELECT id, timestamp, type, subject, detail FROM changelog WHERE timestamp > ? ORDER BY timestamp DESC LIMIT 300'
  ).all(since) as ChangelogEntry[]
}

export function installMCP(instanceId: string, type: string, name: string, port: number): void {
  db().prepare(
    'INSERT OR REPLACE INTO installed_mcps (instance_id, type, name, port, installed_at, enabled) VALUES (?, ?, ?, ?, ?, 1)'
  ).run(instanceId, type, name, port, Date.now())
  logChange('mcp_install', instanceId, `${name} (${type})`)
}

export function uninstallMCP(instanceId: string): void {
  db().prepare('DELETE FROM installed_mcps WHERE instance_id = ?').run(instanceId)
  deleteAllCredentials(instanceId)
  logChange('mcp_uninstall', instanceId)
}

const MCP_COLS = 'instance_id, type, name, port, installed_at, enabled, tag, health_check_interval_seconds, health_check_fail_threshold, health_consecutive_fails, health_last_checked_at, health_last_status, health_last_error, auto_disabled'

type MCPRow = {
  instance_id: string; type: string; name: string; port: number; installed_at: number; enabled: number; tag: string | null
  health_check_interval_seconds: number | null; health_check_fail_threshold: number | null; health_consecutive_fails: number | null
  health_last_checked_at: number | null; health_last_status: string | null; health_last_error: string | null; auto_disabled: number | null
}

function mapMCPRow(r: MCPRow): InstalledMCP {
  return {
    instanceId:                 r.instance_id,
    type:                       r.type,
    name:                       r.name,
    port:                       r.port,
    installedAt:                r.installed_at,
    enabled:                    r.enabled === 1,
    tags:                       parseTags(r.tag),
    healthCheckIntervalSeconds: r.health_check_interval_seconds ?? 0,
    healthCheckFailThreshold:   r.health_check_fail_threshold   ?? 3,
    healthConsecutiveFails:     r.health_consecutive_fails      ?? 0,
    healthLastCheckedAt:        r.health_last_checked_at        ?? null,
    healthLastStatus:           r.health_last_status            ?? null,
    healthLastError:            r.health_last_error             ?? null,
    autoDisabled:               (r.auto_disabled ?? 0) === 1,
  }
}

export function getInstalledMCPs(): InstalledMCP[] {
  return (db().prepare(`SELECT ${MCP_COLS} FROM installed_mcps`).all() as MCPRow[]).map(mapMCPRow)
}

export function isInstanceInstalled(instanceId: string): boolean {
  return !!db().prepare('SELECT 1 FROM installed_mcps WHERE instance_id = ?').get(instanceId)
}

export function getInstancesByType(type: string): InstalledMCP[] {
  return (db().prepare(`SELECT ${MCP_COLS} FROM installed_mcps WHERE type = ?`).all(type) as MCPRow[]).map(mapMCPRow)
}

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter(Boolean) : [] } catch { return [] }
}

export function setInstanceTags(instanceId: string, tags: string[]): void {
  const clean = tags.map((t) => t.trim()).filter(Boolean)
  db().prepare('UPDATE installed_mcps SET tag = ? WHERE instance_id = ?').run(clean.length ? JSON.stringify(clean) : null, instanceId)
}

export function getDistinctTags(): string[] {
  const rows = db().prepare("SELECT tag FROM installed_mcps WHERE tag IS NOT NULL").all() as Array<{ tag: string }>
  const all  = rows.flatMap((r) => parseTags(r.tag))
  return [...new Set(all)].sort()
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export function getUserCount(): number {
  return (db().prepare('SELECT COUNT(*) as count FROM admin_users').get() as { count: number }).count
}

export function getUserPasswordHash(username: string): { hash: Buffer; salt: string } | null {
  return db().prepare(
    'SELECT password_hash as hash, salt FROM admin_users WHERE username = ?'
  ).get(username) as { hash: Buffer; salt: string } | null
}

export function upsertUser(username: string, hash: Buffer, salt: string): void {
  const now = Date.now()
  db().prepare(`
    INSERT INTO admin_users (username, password_hash, salt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      salt          = excluded.salt,
      updated_at    = excluded.updated_at
  `).run(username, hash, salt, now, now)
}

const IDLE_TIMEOUT = 8 * 60 * 60 * 1000  // 8 hours

export function createSessionToken(token: string, username: string, expiresAt: number): void {
  const now = Date.now()
  db().prepare(
    'INSERT INTO sessions (token, username, expires_at, created_at, last_accessed) VALUES (?, ?, ?, ?, ?)'
  ).run(token, username, expiresAt, now, now)
}

export function validateSessionToken(token: string): boolean {
  const row = db().prepare(
    'SELECT expires_at, last_accessed FROM sessions WHERE token = ?'
  ).get(token) as { expires_at: number; last_accessed: number | null } | undefined
  if (!row) return false
  const now = Date.now()
  if (now > row.expires_at) {
    db().prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return false
  }
  if (row.last_accessed !== null && now - row.last_accessed > IDLE_TIMEOUT) {
    db().prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return false
  }
  db().prepare('UPDATE sessions SET last_accessed = ? WHERE token = ?').run(now, token)
  return true
}

export function deleteSessionToken(token: string): void {
  db().prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function deleteSessionsByUsername(username: string): void {
  db().prepare('DELETE FROM sessions WHERE username = ?').run(username)
}

// ─── Tool filters ──────────────────────────────────────────────────────────────

export function getToolFilters(mcpId: string): Record<string, boolean> {
  const rows = db().prepare(
    'SELECT tool_name, enabled FROM tool_filters WHERE mcp_id = ?'
  ).all(mcpId) as Array<{ tool_name: string; enabled: number }>
  const out: Record<string, boolean> = {}
  for (const r of rows) out[r.tool_name] = r.enabled === 1
  return out
}

export function setToolFilters(mcpId: string, filters: Record<string, boolean>): void {
  const stmt = db().prepare(
    'INSERT OR REPLACE INTO tool_filters (mcp_id, tool_name, enabled) VALUES (?, ?, ?)'
  )
  db().transaction(() => {
    for (const [name, enabled] of Object.entries(filters)) {
      stmt.run(mcpId, name, enabled ? 1 : 0)
    }
  })()
  if (Object.keys(filters).length) logChange('tool_filter', mcpId, `${Object.keys(filters).length} tool(s) updated`)
}

// ─── Tool call log ────────────────────────────────────────────────────────────

const RESULT_MAX = 4000

export function logToolCall(entry: {
  platform:    string
  action:      string
  args:        Record<string, unknown>
  outcome:     'success' | 'error'
  latencyMs:   number
  error?:      string
  sessionId?:  string
  gatewayId?:  string
  userAgent?:  string
  resultJson?: string
}): void {
  const result = entry.resultJson
    ? (entry.resultJson.length > RESULT_MAX ? entry.resultJson.slice(0, RESULT_MAX) + '\n…[truncated]' : entry.resultJson)
    : null
  db().prepare(
    'INSERT INTO tool_call_log (timestamp, platform, action, args_json, outcome, latency_ms, error, session_id, gateway_id, user_agent, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(Date.now(), entry.platform, entry.action, JSON.stringify(entry.args), entry.outcome, entry.latencyMs, entry.error ?? null, entry.sessionId ?? null, entry.gatewayId ?? null, entry.userAgent ?? null, result)
}

export interface CallRecord {
  id:           number
  timestamp:    number
  platform:     string
  action:       string
  args_json:    string
  outcome:      string
  latency_ms:   number
  error:        string | null
  gateway_id:   string | null
  gateway_name: string | null
  user_agent:   string | null
  result_json:  string | null
}

function p95(sorted: number[]): number {
  if (!sorted.length) return 0
  return sorted[Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1)]
}

export function getInsights(days = 7, platform?: string) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  const pf    = platform ? ' AND platform = @platform' : ''
  const bp    = { since, platform: platform ?? null }

  const summaryRow = db().prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as successes,
           COALESCE(AVG(latency_ms), 0) as avgLatency
    FROM tool_call_log WHERE timestamp > @since${pf}
  `).get(bp) as { total: number; successes: number; avgLatency: number }

  const retryRow = db().prepare(`
    SELECT
      COUNT(*) as total_with_session,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM tool_call_log t2
        WHERE t2.session_id = t1.session_id
          AND t2.platform   = t1.platform
          AND t2.id         < t1.id
          AND t2.outcome    = 'error'
      ) THEN 1 ELSE 0 END) as retries
    FROM tool_call_log t1
    WHERE t1.timestamp > @since AND t1.session_id IS NOT NULL${pf}
  `).get(bp) as { total_with_session: number; retries: number }

  const retryRate = retryRow.total_with_session > 0
    ? Math.round((retryRow.retries / retryRow.total_with_session) * 100)
    : 0

  const summary = { ...summaryRow, retryRate }

  const callsPerDay = db().prepare(`
    SELECT date(timestamp / 1000, 'unixepoch') as date,
           COUNT(*) as total,
           SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) as errors
    FROM tool_call_log WHERE timestamp > @since${pf}
    GROUP BY date ORDER BY date ASC
  `).all(bp) as Array<{ date: string; total: number; errors: number }>

  const perPlatform = db().prepare(`
    SELECT platform, COUNT(*) as total,
           SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) as errors
    FROM tool_call_log WHERE timestamp > @since
    GROUP BY platform ORDER BY total DESC
  `).all({ since }) as Array<{ platform: string; total: number; errors: number }>

  const topActionsRaw = db().prepare(`
    SELECT platform, action, COUNT(*) as total,
           CAST(AVG(latency_ms) AS INTEGER) as avgLatency,
           SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) as errors
    FROM tool_call_log WHERE timestamp > @since${pf}
    GROUP BY platform, action ORDER BY total DESC LIMIT 15
  `).all(bp) as Array<{ platform: string; action: string; total: number; avgLatency: number; errors: number }>

  const latencyRows = db().prepare(`
    SELECT platform, action, latency_ms
    FROM tool_call_log WHERE timestamp > @since${pf}
    ORDER BY platform, action, latency_ms ASC
  `).all(bp) as Array<{ platform: string; action: string; latency_ms: number }>

  const latencyMap = new Map<string, number[]>()
  for (const r of latencyRows) {
    const key = `${r.platform}:${r.action}`
    const arr = latencyMap.get(key)
    if (arr) arr.push(r.latency_ms)
    else latencyMap.set(key, [r.latency_ms])
  }

  const topActions = topActionsRaw.map((a) => ({
    ...a,
    p95Latency: p95(latencyMap.get(`${a.platform}:${a.action}`) ?? []),
  }))

  const pfT = platform ? ' AND t.platform = @platform' : ''
  const recentCalls = db().prepare(`
    SELECT t.id, t.timestamp, t.platform, t.action, t.args_json, t.outcome, t.latency_ms, t.error, t.gateway_id, t.user_agent, t.result_json,
           COALESCE(g.name, ns.name) as gateway_name
    FROM tool_call_log t
    LEFT JOIN gateways   g  ON g.id  = t.gateway_id
    LEFT JOIN namespaces ns ON ns.id = t.gateway_id
    WHERE t.timestamp > @since${pfT}
    ORDER BY t.timestamp DESC LIMIT 150
  `).all(bp) as CallRecord[]

  const perUA = db().prepare(`
    SELECT COALESCE(user_agent, 'unknown') as ua, COUNT(*) as total,
           SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) as errors
    FROM tool_call_log WHERE timestamp > @since${pf}
    GROUP BY ua ORDER BY total DESC LIMIT 10
  `).all(bp) as Array<{ ua: string; total: number; errors: number }>

  const heatmap = db().prepare(`
    SELECT
      CAST(strftime('%H', timestamp / 1000, 'unixepoch') AS INTEGER) as hour,
      CAST(strftime('%w', timestamp / 1000, 'unixepoch') AS INTEGER) as dow,
      COUNT(*) as total
    FROM tool_call_log WHERE timestamp > @since${pf}
    GROUP BY hour, dow
  `).all(bp) as Array<{ hour: number; dow: number; total: number }>

  const errorPatterns = db().prepare(`
    SELECT platform, action, COALESCE(error, 'unknown error') as error,
           COUNT(*) as total, MAX(timestamp) as last_seen
    FROM tool_call_log
    WHERE timestamp > @since AND outcome = 'error'${pf}
    GROUP BY platform, action, error
    ORDER BY total DESC LIMIT 20
  `).all(bp) as Array<{ platform: string; action: string; error: string; total: number; last_seen: number }>

  const latencyTrendRaw = db().prepare(`
    SELECT date(timestamp / 1000, 'unixepoch') as date,
           platform,
           CAST(AVG(latency_ms) AS INTEGER) as avgLatency
    FROM tool_call_log WHERE timestamp > @since${pf}
    GROUP BY date, platform ORDER BY date ASC
  `).all(bp) as Array<{ date: string; platform: string; avgLatency: number }>

  const top5 = new Set(perPlatform.slice(0, 5).map((p) => p.platform))
  const latencyTrend = platform ? latencyTrendRaw : latencyTrendRaw.filter((r) => top5.has(r.platform))

  const cooccurrence = db().prepare(`
    SELECT a.platform || ':' || a.action as tool_a,
           b.platform || ':' || b.action as tool_b,
           COUNT(DISTINCT a.session_id) as sessions
    FROM tool_call_log a
    JOIN tool_call_log b ON a.session_id = b.session_id
      AND a.session_id IS NOT NULL
      AND (a.platform || ':' || a.action) < (b.platform || ':' || b.action)
    WHERE a.timestamp > @since AND b.timestamp > @since
    GROUP BY tool_a, tool_b
    ORDER BY sessions DESC LIMIT 15
  `).all({ since }) as Array<{ tool_a: string; tool_b: string; sessions: number }>

  const tokenBurnRaw = db().prepare(`
    SELECT platform, action,
           SUM(LENGTH(args_json) / 4) as inputTokens,
           SUM(COALESCE(LENGTH(result_json), 0) / 4) as outputTokens,
           COUNT(*) as calls
    FROM tool_call_log WHERE timestamp > @since${pf}
    GROUP BY platform, action
    ORDER BY (SUM(LENGTH(args_json)) + SUM(COALESCE(LENGTH(result_json), 0))) DESC
    LIMIT 15
  `).all(bp) as Array<{ platform: string; action: string; inputTokens: number; outputTokens: number; calls: number }>

  const tokenTotals = db().prepare(`
    SELECT SUM(LENGTH(args_json) / 4) as totalInput,
           SUM(COALESCE(LENGTH(result_json), 0) / 4) as totalOutput
    FROM tool_call_log WHERE timestamp > @since${pf}
  `).get(bp) as { totalInput: number | null; totalOutput: number | null }

  const tokenBurn = {
    totalInputTokens:  tokenTotals.totalInput  ?? 0,
    totalOutputTokens: tokenTotals.totalOutput ?? 0,
    perAction:         tokenBurnRaw,
  }

  return { summary, callsPerDay, perPlatform, topActions, recentCalls, perUA, heatmap, errorPatterns, latencyTrend, cooccurrence, tokenBurn }
}

export interface SessionSummary {
  session_id:       string
  calls:            number
  platforms:        number
  started_at:       number
  ended_at:         number
  errors:           number
  platform_list:    string
  user_agent:       string
  total_latency_ms: number
}

export function getSessions(days = 7): SessionSummary[] {
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  return db().prepare(`
    SELECT session_id,
           COUNT(*) as calls,
           COUNT(DISTINCT platform) as platforms,
           MIN(timestamp) as started_at,
           MAX(timestamp) as ended_at,
           SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) as errors,
           GROUP_CONCAT(DISTINCT platform) as platform_list,
           COALESCE(MAX(user_agent), 'unknown') as user_agent,
           SUM(latency_ms) as total_latency_ms
    FROM tool_call_log
    WHERE timestamp > ? AND session_id IS NOT NULL
    GROUP BY session_id
    ORDER BY started_at DESC
    LIMIT 100
  `).all(since) as SessionSummary[]
}

export function getSessionCalls(sessionId: string): CallRecord[] {
  return db().prepare(`
    SELECT t.id, t.timestamp, t.platform, t.action, t.args_json, t.outcome,
           t.latency_ms, t.error, t.gateway_id, t.user_agent, t.result_json,
           COALESCE(g.name, ns.name) as gateway_name
    FROM tool_call_log t
    LEFT JOIN gateways   g  ON g.id  = t.gateway_id
    LEFT JOIN namespaces ns ON ns.id = t.gateway_id
    WHERE t.session_id = ?
    ORDER BY t.timestamp ASC
  `).all(sessionId) as CallRecord[]
}

export function isToolEnabled(mcpId: string, toolName: string, type?: string): boolean {
  const instanceRow = db().prepare(
    'SELECT enabled FROM tool_filters WHERE mcp_id = ? AND tool_name = ?'
  ).get(mcpId, toolName) as { enabled: number } | undefined
  if (instanceRow !== undefined) return instanceRow.enabled === 1

  if (type && type !== mcpId) {
    const typeRow = db().prepare(
      'SELECT enabled FROM tool_filters WHERE mcp_id = ? AND tool_name = ?'
    ).get(type, toolName) as { enabled: number } | undefined
    if (typeRow !== undefined) return typeRow.enabled === 1
  }

  return true
}

export function clearToolFilters(mcpId: string): void {
  db().prepare('DELETE FROM tool_filters WHERE mcp_id = ?').run(mcpId)
}

// ─── Description overrides ────────────────────────────────────────────────────

export function setDescriptionOverride(instanceId: string, toolName: string, description: string): void {
  db().prepare('INSERT OR REPLACE INTO description_overrides (instance_id, tool_name, description) VALUES (?, ?, ?)').run(instanceId, toolName, description)
  logChange('desc_override', `${instanceId}:${toolName}`)
}

export function clearDescriptionOverride(instanceId: string, toolName: string): void {
  db().prepare('DELETE FROM description_overrides WHERE instance_id = ? AND tool_name = ?').run(instanceId, toolName)
}

export function getDescriptionOverrides(instanceId: string): Record<string, string> {
  const rows = db().prepare('SELECT tool_name, description FROM description_overrides WHERE instance_id = ?').all(instanceId) as Array<{ tool_name: string; description: string }>
  const out: Record<string, string> = {}
  for (const r of rows) out[r.tool_name] = r.description
  return out
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

// ─── Gateways ─────────────────────────────────────────────────────────────────

export interface GatewayRecord {
  id:            string
  name:          string
  createdAt:     number
  instanceIds:   string[]
  contextPrefix: string
}

export function createGateway(id: string, name: string, keyHash: string): GatewayRecord {
  const now = Date.now()
  db().prepare('INSERT INTO gateways (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)').run(id, name, keyHash, now)
  logChange('gateway_create', id, name)
  return { id, name, createdAt: now, instanceIds: [], contextPrefix: '' }
}

export function listGateways(): GatewayRecord[] {
  const gws = db().prepare('SELECT id, name, created_at, COALESCE(context_prefix, \'\') as context_prefix FROM gateways ORDER BY created_at DESC').all() as Array<{ id: string; name: string; created_at: number; context_prefix: string }>
  const allInstances = db().prepare('SELECT gateway_id, instance_id FROM gateway_instances').all() as Array<{ gateway_id: string; instance_id: string }>
  const instanceMap = new Map<string, string[]>()
  for (const row of allInstances) {
    const arr = instanceMap.get(row.gateway_id) ?? []
    arr.push(row.instance_id)
    instanceMap.set(row.gateway_id, arr)
  }
  return gws.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, instanceIds: instanceMap.get(r.id) ?? [], contextPrefix: r.context_prefix }))
}

export function setGatewayContextPrefix(gatewayId: string, prefix: string): void {
  db().prepare("UPDATE gateways SET context_prefix = ? WHERE id = ?").run(prefix, gatewayId)
  logChange('gateway_context_prefix', gatewayId)
}

export function deleteGateway(id: string): void {
  logChange('gateway_delete', id)
  db().transaction(() => {
    db().prepare('DELETE FROM gateway_instances WHERE gateway_id = ?').run(id)
    db().prepare("DELETE FROM tool_filters WHERE mcp_id LIKE ? ESCAPE '\\'").run(`${escapeLike(id)}:%`)
    db().prepare('DELETE FROM rate_limits WHERE gateway_id = ?').run(id)
    db().prepare('DELETE FROM gateways WHERE id = ?').run(id)
  })()
}

export function renameGateway(id: string, name: string): void {
  db().prepare('UPDATE gateways SET name = ? WHERE id = ?').run(name, id)
  logChange('gateway_rename', id, name)
}

export function updateGatewayKeyHash(id: string, keyHash: string): void {
  db().prepare('UPDATE gateways SET key_hash = ? WHERE id = ?').run(keyHash, id)
}

export function findGatewayByKeyHash(keyHash: string): GatewayRecord | null {
  const row = db().prepare("SELECT id, name, created_at, COALESCE(context_prefix, '') as context_prefix FROM gateways WHERE key_hash = ?").get(keyHash) as { id: string; name: string; created_at: number; context_prefix: string } | undefined
  if (!row) return null
  return { id: row.id, name: row.name, createdAt: row.created_at, instanceIds: getGatewayInstances(row.id), contextPrefix: row.context_prefix }
}

export function setGatewayInstances(gatewayId: string, instanceIds: string[]): void {
  db().transaction(() => {
    db().prepare('DELETE FROM gateway_instances WHERE gateway_id = ?').run(gatewayId)
    for (const instanceId of instanceIds) {
      db().prepare('INSERT INTO gateway_instances (gateway_id, instance_id) VALUES (?, ?)').run(gatewayId, instanceId)
    }
  })()
}

export function getGatewayInstances(gatewayId: string): string[] {
  return (db().prepare('SELECT instance_id FROM gateway_instances WHERE gateway_id = ?').all(gatewayId) as Array<{ instance_id: string }>).map((r) => r.instance_id)
}

export function isToolEnabledForGateway(gatewayId: string, instanceId: string, toolName: string, type?: string): boolean {
  const gwKey = `${gatewayId}:${instanceId}`
  const gwRow = db().prepare('SELECT enabled FROM tool_filters WHERE mcp_id = ? AND tool_name = ?').get(gwKey, toolName) as { enabled: number } | undefined
  if (gwRow !== undefined) return gwRow.enabled === 1
  return isToolEnabled(instanceId, toolName, type)
}

export function duplicateGateway(sourceId: string, newId: string, newName: string, newKeyHash: string): GatewayRecord {
  const now = Date.now()
  db().transaction(() => {
    const src = db().prepare("SELECT COALESCE(context_prefix, '') as context_prefix FROM gateways WHERE id = ?").get(sourceId) as { context_prefix: string } | undefined
    db().prepare('INSERT INTO gateways (id, name, key_hash, created_at, context_prefix) VALUES (?, ?, ?, ?, ?)').run(newId, newName, newKeyHash, now, src?.context_prefix ?? '')
    const instances = (db().prepare('SELECT instance_id FROM gateway_instances WHERE gateway_id = ?').all(sourceId) as Array<{ instance_id: string }>).map((r) => r.instance_id)
    for (const instId of instances) {
      db().prepare('INSERT INTO gateway_instances (gateway_id, instance_id) VALUES (?, ?)').run(newId, instId)
    }
    const filterRows = db().prepare("SELECT mcp_id, tool_name, enabled FROM tool_filters WHERE mcp_id LIKE ? ESCAPE '\\'").all(`${escapeLike(sourceId)}:%`) as Array<{ mcp_id: string; tool_name: string; enabled: number }>
    for (const row of filterRows) {
      const newMcpId = `${newId}:${row.mcp_id.slice(sourceId.length + 1)}`
      db().prepare('INSERT OR REPLACE INTO tool_filters (mcp_id, tool_name, enabled) VALUES (?, ?, ?)').run(newMcpId, row.tool_name, row.enabled)
    }
  })()
  const instanceIds = getGatewayInstances(newId)
  return { id: newId, name: newName, createdAt: now, instanceIds, contextPrefix: '' }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  db().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
  logChange('setting', key)
}

export function setSettings(map: Record<string, string>): void {
  const stmt = db().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  db().transaction(() => { for (const [k, v] of Object.entries(map)) stmt.run(k, v) })()
  const keys = Object.keys(map)
  if (keys.length) logChange('setting', keys.join(', '))
}

export function getSettingsMap(): Record<string, string> {
  const rows = db().prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const out: Record<string, string> = {}
  for (const r of rows) out[r.key] = r.value
  return out
}

// ─── Rate limits ──────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  gatewayId:  string
  maxCalls:   number
  windowSecs: number
}

export function getRateLimit(gatewayId: string): RateLimitConfig | null {
  const row = db().prepare('SELECT max_calls, window_secs FROM rate_limits WHERE gateway_id = ?').get(gatewayId) as { max_calls: number; window_secs: number } | undefined
  if (!row) return null
  return { gatewayId, maxCalls: row.max_calls, windowSecs: row.window_secs }
}

export function setRateLimit(gatewayId: string, maxCalls: number, windowSecs: number): void {
  db().prepare('INSERT OR REPLACE INTO rate_limits (gateway_id, max_calls, window_secs) VALUES (?, ?, ?)').run(gatewayId, maxCalls, windowSecs)
}

export function deleteRateLimit(gatewayId: string): void {
  db().prepare('DELETE FROM rate_limits WHERE gateway_id = ?').run(gatewayId)
}

export function getAllRateLimits(): RateLimitConfig[] {
  return (db().prepare('SELECT gateway_id, max_calls, window_secs FROM rate_limits').all() as Array<{ gateway_id: string; max_calls: number; window_secs: number }>)
    .map((r) => ({ gatewayId: r.gateway_id, maxCalls: r.max_calls, windowSecs: r.window_secs }))
}

// ─── Health checks ────────────────────────────────────────────────────────────

export function updateHealthCheckConfig(instanceId: string, intervalSeconds: number, failThreshold: number): void {
  db().prepare('UPDATE installed_mcps SET health_check_interval_seconds = ?, health_check_fail_threshold = ? WHERE instance_id = ?').run(intervalSeconds, failThreshold, instanceId)
}

export function getInstancesForHealthCheck(): InstalledMCP[] {
  return (db().prepare(`SELECT ${MCP_COLS} FROM installed_mcps WHERE health_check_interval_seconds > 0 OR auto_disabled = 1`).all() as MCPRow[]).map(mapMCPRow)
}

export function recordHealthOk(instanceId: string): void {
  const row = db().prepare('SELECT auto_disabled FROM installed_mcps WHERE instance_id = ?').get(instanceId) as { auto_disabled: number } | undefined
  const wasAutoDisabled = (row?.auto_disabled ?? 0) === 1
  db().prepare(`UPDATE installed_mcps SET
    health_consecutive_fails = 0,
    health_last_checked_at   = ?,
    health_last_status       = 'ok',
    health_last_error        = NULL,
    auto_disabled            = 0,
    enabled                  = CASE WHEN auto_disabled = 1 THEN 1 ELSE enabled END
    WHERE instance_id = ?`).run(Date.now(), instanceId)
  if (wasAutoDisabled) logChange('health_recovered', instanceId)
}

export function recordHealthFail(instanceId: string, error: string): { autoDisabledNow: boolean } {
  const row = db().prepare('SELECT health_consecutive_fails, health_check_fail_threshold, auto_disabled FROM installed_mcps WHERE instance_id = ?')
    .get(instanceId) as { health_consecutive_fails: number; health_check_fail_threshold: number; auto_disabled: number } | undefined
  if (!row) return { autoDisabledNow: false }

  const newFails = (row.health_consecutive_fails ?? 0) + 1
  const threshold = row.health_check_fail_threshold ?? 3
  const alreadyDisabled = (row.auto_disabled ?? 0) === 1
  const shouldDisable = !alreadyDisabled && newFails >= threshold

  db().prepare(`UPDATE installed_mcps SET
    health_consecutive_fails = ?,
    health_last_checked_at   = ?,
    health_last_status       = 'fail',
    health_last_error        = ?,
    auto_disabled            = CASE WHEN ? THEN 1 ELSE auto_disabled END,
    enabled                  = CASE WHEN ? THEN 0 ELSE enabled END
    WHERE instance_id = ?`).run(newFails, Date.now(), error, shouldDisable ? 1 : 0, shouldDisable ? 1 : 0, instanceId)

  if (shouldDisable) logChange('health_auto_disabled', instanceId, `after ${newFails} fails: ${error}`)
  return { autoDisabledNow: shouldDisable }
}

// ─── Approval rules ───────────────────────────────────────────────────────────

export interface ApprovalRule { pattern: string; enabled: boolean }

export function getApprovalRules(instanceId: string): ApprovalRule[] {
  return (db().prepare('SELECT action_pattern, enabled FROM approval_rules WHERE instance_id = ?').all(instanceId) as Array<{ action_pattern: string; enabled: number }>)
    .map((r) => ({ pattern: r.action_pattern, enabled: r.enabled === 1 }))
}

export function setApprovalRules(instanceId: string, rules: ApprovalRule[]): void {
  db().transaction(() => {
    db().prepare('DELETE FROM approval_rules WHERE instance_id = ?').run(instanceId)
    const stmt = db().prepare('INSERT INTO approval_rules (instance_id, action_pattern, enabled) VALUES (?, ?, ?)')
    for (const r of rules) stmt.run(instanceId, r.pattern, r.enabled ? 1 : 0)
  })()
}

function globMatch(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) return pattern === value
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
  return re.test(value)
}

export function matchesApprovalRule(instanceId: string, action: string): boolean {
  const rules = db().prepare('SELECT action_pattern FROM approval_rules WHERE instance_id = ? AND enabled = 1').all(instanceId) as Array<{ action_pattern: string }>
  return rules.some((r) => globMatch(r.action_pattern, action))
}

// ─── Approval queue ───────────────────────────────────────────────────────────

export interface ApprovalRequest {
  id:           string
  instanceId:   string
  action:       string
  argsJson:     string
  status:       'pending' | 'approved' | 'rejected'
  createdAt:    number
  decidedAt:    number | null
  decisionBy:   string | null
  rejectReason: string | null
  resultJson:   string | null
}

function mapApprovalRow(r: { id: string; instance_id: string; action: string; args_json: string; status: string; created_at: number; decided_at: number | null; decision_by: string | null; reject_reason: string | null; result_json: string | null }): ApprovalRequest {
  return { id: r.id, instanceId: r.instance_id, action: r.action, argsJson: r.args_json, status: r.status as ApprovalRequest['status'], createdAt: r.created_at, decidedAt: r.decided_at, decisionBy: r.decision_by, rejectReason: r.reject_reason, resultJson: r.result_json }
}

export function createApprovalRequest(instanceId: string, action: string, argsJson: string, approvalId: string): void {
  db().prepare('INSERT INTO approval_queue (id, instance_id, action, args_json, created_at) VALUES (?, ?, ?, ?, ?)').run(approvalId, instanceId, action, argsJson, Date.now())
}

export function getApprovalRequest(id: string): ApprovalRequest | null {
  const r = db().prepare('SELECT id, instance_id, action, args_json, status, created_at, decided_at, decision_by, reject_reason, result_json FROM approval_queue WHERE id = ?').get(id) as Parameters<typeof mapApprovalRow>[0] | undefined
  return r ? mapApprovalRow(r) : null
}

export function listApprovalQueue(status?: string): ApprovalRequest[] {
  const rows = status
    ? (db().prepare('SELECT id, instance_id, action, args_json, status, created_at, decided_at, decision_by, reject_reason, result_json FROM approval_queue WHERE status = ? ORDER BY created_at DESC LIMIT 100').all(status) as Parameters<typeof mapApprovalRow>[0][])
    : (db().prepare('SELECT id, instance_id, action, args_json, status, created_at, decided_at, decision_by, reject_reason, result_json FROM approval_queue ORDER BY created_at DESC LIMIT 100').all() as Parameters<typeof mapApprovalRow>[0][])
  return rows.map(mapApprovalRow)
}

export function decideApproval(id: string, decision: 'approved' | 'rejected', by: string, reason?: string): void {
  db().prepare('UPDATE approval_queue SET status = ?, decided_at = ?, decision_by = ?, reject_reason = ? WHERE id = ?').run(decision, Date.now(), by, reason ?? null, id)
}

export function storeApprovalResult(id: string, resultJson: string): void {
  db().prepare('UPDATE approval_queue SET result_json = ? WHERE id = ?').run(resultJson, id)
}

// ─── Diff tracking ────────────────────────────────────────────────────────────

export function getActionSnapshot(instanceId: string, action: string, argsHash: string): { snapshotJson: string; updatedAt: number } | null {
  const r = db().prepare('SELECT snapshot_json, updated_at FROM action_snapshots WHERE instance_id = ? AND action = ? AND args_hash = ?').get(instanceId, action, argsHash) as { snapshot_json: string; updated_at: number } | undefined
  return r ? { snapshotJson: r.snapshot_json, updatedAt: r.updated_at } : null
}

export function setActionSnapshot(instanceId: string, action: string, argsHash: string, snapshotJson: string, itemCount: number): void {
  db().prepare('INSERT OR REPLACE INTO action_snapshots (instance_id, action, args_hash, snapshot_json, item_count, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(instanceId, action, argsHash, snapshotJson, itemCount, Date.now())
}

export function isDiffShown(sessionId: string, instanceId: string, action: string, argsHash: string): boolean {
  return !!db().prepare('SELECT 1 FROM diff_shown WHERE session_id = ? AND instance_id = ? AND action = ? AND args_hash = ?').get(sessionId, instanceId, action, argsHash)
}

export function markDiffShown(sessionId: string, instanceId: string, action: string, argsHash: string): void {
  db().prepare('INSERT OR IGNORE INTO diff_shown (session_id, instance_id, action, args_hash, shown_at) VALUES (?, ?, ?, ?, ?)').run(sessionId, instanceId, action, argsHash, Date.now())
}

// ─── Schema token log ─────────────────────────────────────────────────────────

export function logSchemaTokens(gatewayId: string | null, totalTokens: number, breakdownJson: string): void {
  db().prepare('INSERT INTO schema_token_log (timestamp, gateway_id, total_tokens, breakdown_json) VALUES (?, ?, ?, ?)').run(Date.now(), gatewayId, totalTokens, breakdownJson)
  db().prepare('DELETE FROM schema_token_log WHERE timestamp < ?').run(Date.now() - 30 * 24 * 60 * 60 * 1000)
}

export interface SchemaTokenEntry {
  timestamp:     number
  gatewayId:     string | null
  totalTokens:   number
  breakdownJson: string
}

export function getSchemaTokenTrend(days = 7): SchemaTokenEntry[] {
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  return (db().prepare('SELECT timestamp, gateway_id, total_tokens, breakdown_json FROM schema_token_log WHERE timestamp > ? ORDER BY timestamp ASC').all(since) as Array<{ timestamp: number; gateway_id: string | null; total_tokens: number; breakdown_json: string }>)
    .map((r) => ({ timestamp: r.timestamp, gatewayId: r.gateway_id, totalTokens: r.total_tokens, breakdownJson: r.breakdown_json }))
}

// ─── Namespaces ───────────────────────────────────────────────────────────────

export interface NamespaceKey {
  id:        string
  label:     string
  createdAt: number
}

export interface NamespaceRecord {
  id:          string
  name:        string
  createdAt:   number
  instanceIds: string[]
  keys:        NamespaceKey[]
  middleware:  Record<string, unknown>
}

function buildNamespace(
  r:         { id: string; name: string; created_at: number },
  servers:   Map<string, string[]>,
  keys:      Map<string, NamespaceKey[]>,
  mw:        Map<string, Record<string, unknown>>
): NamespaceRecord {
  return { id: r.id, name: r.name, createdAt: r.created_at, instanceIds: servers.get(r.id) ?? [], keys: keys.get(r.id) ?? [], middleware: mw.get(r.id) ?? {} }
}

export function createNamespace(id: string, name: string): NamespaceRecord {
  const now = Date.now()
  db().prepare('INSERT INTO namespaces (id, name, created_at) VALUES (?, ?, ?)').run(id, name, now)
  logChange('namespace_create', id, name)
  return { id, name, createdAt: now, instanceIds: [], keys: [], middleware: {} }
}

export function listNamespaces(): NamespaceRecord[] {
  const rows = db().prepare('SELECT id, name, created_at FROM namespaces ORDER BY created_at DESC').all() as Array<{ id: string; name: string; created_at: number }>
  const serverRows = db().prepare('SELECT namespace_id, instance_id FROM namespace_servers').all() as Array<{ namespace_id: string; instance_id: string }>
  const keyRows    = db().prepare('SELECT id, namespace_id, label, created_at FROM namespace_keys ORDER BY created_at ASC').all() as Array<{ id: string; namespace_id: string; label: string; created_at: number }>
  const mwRows     = db().prepare('SELECT namespace_id, type, config_json FROM namespace_middleware').all() as Array<{ namespace_id: string; type: string; config_json: string }>

  const servers = new Map<string, string[]>()
  for (const r of serverRows) { const a = servers.get(r.namespace_id) ?? []; a.push(r.instance_id); servers.set(r.namespace_id, a) }

  const keysMap = new Map<string, NamespaceKey[]>()
  for (const r of keyRows) { const a = keysMap.get(r.namespace_id) ?? []; a.push({ id: r.id, label: r.label, createdAt: r.created_at }); keysMap.set(r.namespace_id, a) }

  const mwMap = new Map<string, Record<string, unknown>>()
  for (const r of mwRows) {
    const m = mwMap.get(r.namespace_id) ?? {}
    try { m[r.type] = JSON.parse(r.config_json) } catch { m[r.type] = r.config_json }
    mwMap.set(r.namespace_id, m)
  }

  return rows.map((r) => buildNamespace(r, servers, keysMap, mwMap))
}

export function getNamespace(id: string): NamespaceRecord | null {
  const r = db().prepare('SELECT id, name, created_at FROM namespaces WHERE id = ?').get(id) as { id: string; name: string; created_at: number } | undefined
  if (!r) return null
  const instanceIds = (db().prepare('SELECT instance_id FROM namespace_servers WHERE namespace_id = ?').all(id) as Array<{ instance_id: string }>).map((x) => x.instance_id)
  const keys = (db().prepare('SELECT id, label, created_at FROM namespace_keys WHERE namespace_id = ? ORDER BY created_at ASC').all(id) as Array<{ id: string; label: string; created_at: number }>).map((k) => ({ id: k.id, label: k.label, createdAt: k.created_at }))
  const mwRows = db().prepare('SELECT type, config_json FROM namespace_middleware WHERE namespace_id = ?').all(id) as Array<{ type: string; config_json: string }>
  const middleware: Record<string, unknown> = {}
  for (const m of mwRows) { try { middleware[m.type] = JSON.parse(m.config_json) } catch { middleware[m.type] = m.config_json } }
  return { id: r.id, name: r.name, createdAt: r.created_at, instanceIds, keys, middleware }
}

export function deleteNamespace(id: string): void {
  logChange('namespace_delete', id)
  db().transaction(() => {
    db().prepare('DELETE FROM namespace_servers      WHERE namespace_id = ?').run(id)
    db().prepare('DELETE FROM namespace_keys         WHERE namespace_id = ?').run(id)
    db().prepare('DELETE FROM namespace_tool_filters WHERE namespace_id = ?').run(id)
    db().prepare('DELETE FROM namespace_middleware   WHERE namespace_id = ?').run(id)
    db().prepare('DELETE FROM namespaces             WHERE id = ?').run(id)
  })()
}

export function renameNamespace(id: string, name: string): void {
  db().prepare('UPDATE namespaces SET name = ? WHERE id = ?').run(name, id)
  logChange('namespace_rename', id, name)
}

export function setNamespaceServers(namespaceId: string, instanceIds: string[]): void {
  db().transaction(() => {
    db().prepare('DELETE FROM namespace_servers WHERE namespace_id = ?').run(namespaceId)
    for (const id of instanceIds) {
      db().prepare('INSERT INTO namespace_servers (namespace_id, instance_id) VALUES (?, ?)').run(namespaceId, id)
    }
  })()
}

export function addNamespaceKey(namespaceId: string, keyHash: string, label: string): string {
  const id  = randomBytes(6).toString('hex')
  const now = Date.now()
  db().prepare('INSERT INTO namespace_keys (id, namespace_id, key_hash, label, created_at) VALUES (?, ?, ?, ?, ?)').run(id, namespaceId, keyHash, label, now)
  logChange('namespace_key_add', namespaceId, label || id)
  return id
}

export function deleteNamespaceKey(keyId: string): void {
  db().prepare('DELETE FROM namespace_keys WHERE id = ?').run(keyId)
}

export function findNamespaceByKeyHash(keyHash: string): { namespaceId: string; keyId: string } | null {
  const r = db().prepare('SELECT id, namespace_id FROM namespace_keys WHERE key_hash = ?').get(keyHash) as { id: string; namespace_id: string } | undefined
  return r ? { namespaceId: r.namespace_id, keyId: r.id } : null
}

export function isToolEnabledForNamespace(namespaceId: string, instanceId: string, toolName: string, type?: string): boolean {
  const nsRow = db().prepare('SELECT enabled FROM namespace_tool_filters WHERE namespace_id = ? AND instance_id = ? AND tool_name = ?').get(namespaceId, instanceId, toolName) as { enabled: number } | undefined
  if (nsRow !== undefined) return nsRow.enabled === 1
  return isToolEnabled(instanceId, toolName, type)
}

export function setNamespaceToolFilters(namespaceId: string, instanceId: string, filters: Record<string, boolean>): void {
  const stmt = db().prepare('INSERT OR REPLACE INTO namespace_tool_filters (namespace_id, instance_id, tool_name, enabled) VALUES (?, ?, ?, ?)')
  db().transaction(() => {
    for (const [name, enabled] of Object.entries(filters)) stmt.run(namespaceId, instanceId, name, enabled ? 1 : 0)
  })()
}

export function getNamespaceToolFilters(namespaceId: string, instanceId: string): Record<string, boolean> {
  const rows = db().prepare('SELECT tool_name, enabled FROM namespace_tool_filters WHERE namespace_id = ? AND instance_id = ?').all(namespaceId, instanceId) as Array<{ tool_name: string; enabled: number }>
  const out: Record<string, boolean> = {}
  for (const r of rows) out[r.tool_name] = r.enabled === 1
  return out
}

export function setNamespaceMiddleware(namespaceId: string, type: string, config: unknown): void {
  db().prepare('INSERT OR REPLACE INTO namespace_middleware (namespace_id, type, config_json) VALUES (?, ?, ?)').run(namespaceId, type, JSON.stringify(config))
  logChange('namespace_middleware', `${namespaceId}:${type}`)
}

export function getLatestSchemaTokenBreakdown(gatewayId: string | null): SchemaTokenEntry | null {
  const r = gatewayId === null
    ? (db().prepare('SELECT timestamp, gateway_id, total_tokens, breakdown_json FROM schema_token_log WHERE gateway_id IS NULL ORDER BY timestamp DESC LIMIT 1').get() as { timestamp: number; gateway_id: string | null; total_tokens: number; breakdown_json: string } | undefined)
    : (db().prepare('SELECT timestamp, gateway_id, total_tokens, breakdown_json FROM schema_token_log WHERE gateway_id = ? ORDER BY timestamp DESC LIMIT 1').get(gatewayId) as { timestamp: number; gateway_id: string | null; total_tokens: number; breakdown_json: string } | undefined)
  return r ? { timestamp: r.timestamp, gatewayId: r.gateway_id, totalTokens: r.total_tokens, breakdownJson: r.breakdown_json } : null
}
