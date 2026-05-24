import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join } from 'path'
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
  `)
  migrateInstalledMCPs()
  migrateInstalledMCPsTag()
  migrateToolCallLog()
  migrateSessionsTable()
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
  instanceId:  string
  type:        string
  name:        string
  port:        number
  installedAt: number
  enabled:     boolean
  tags:        string[]
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

export function getInstalledMCPs(): InstalledMCP[] {
  return (db().prepare('SELECT instance_id, type, name, port, installed_at, enabled, tag FROM installed_mcps').all() as Array<{
    instance_id: string; type: string; name: string; port: number; installed_at: number; enabled: number; tag: string | null
  }>).map((r) => ({ instanceId: r.instance_id, type: r.type, name: r.name, port: r.port, installedAt: r.installed_at, enabled: r.enabled === 1, tags: parseTags(r.tag) }))
}

export function isInstanceInstalled(instanceId: string): boolean {
  return !!db().prepare('SELECT 1 FROM installed_mcps WHERE instance_id = ?').get(instanceId)
}

export function getInstancesByType(type: string): InstalledMCP[] {
  return (db().prepare('SELECT instance_id, type, name, port, installed_at, enabled, tag FROM installed_mcps WHERE type = ?').all(type) as Array<{
    instance_id: string; type: string; name: string; port: number; installed_at: number; enabled: number; tag: string | null
  }>).map((r) => ({ instanceId: r.instance_id, type: r.type, name: r.name, port: r.port, installedAt: r.installed_at, enabled: r.enabled === 1, tags: parseTags(r.tag) }))
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
    SELECT t.id, t.timestamp, t.platform, t.action, t.args_json, t.outcome, t.latency_ms, t.error, t.gateway_id, t.user_agent, t.result_json, g.name as gateway_name
    FROM tool_call_log t
    LEFT JOIN gateways g ON g.id = t.gateway_id
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
           t.latency_ms, t.error, t.gateway_id, t.user_agent, t.result_json, g.name as gateway_name
    FROM tool_call_log t
    LEFT JOIN gateways g ON g.id = t.gateway_id
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
  id:          string
  name:        string
  createdAt:   number
  instanceIds: string[]
}

export function createGateway(id: string, name: string, keyHash: string): GatewayRecord {
  const now = Date.now()
  db().prepare('INSERT INTO gateways (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)').run(id, name, keyHash, now)
  logChange('gateway_create', id, name)
  return { id, name, createdAt: now, instanceIds: [] }
}

export function listGateways(): GatewayRecord[] {
  const gws = db().prepare('SELECT id, name, created_at FROM gateways ORDER BY created_at DESC').all() as Array<{ id: string; name: string; created_at: number }>
  const allInstances = db().prepare('SELECT gateway_id, instance_id FROM gateway_instances').all() as Array<{ gateway_id: string; instance_id: string }>
  const instanceMap = new Map<string, string[]>()
  for (const row of allInstances) {
    const arr = instanceMap.get(row.gateway_id) ?? []
    arr.push(row.instance_id)
    instanceMap.set(row.gateway_id, arr)
  }
  return gws.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, instanceIds: instanceMap.get(r.id) ?? [] }))
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
  const row = db().prepare('SELECT id, name, created_at FROM gateways WHERE key_hash = ?').get(keyHash) as { id: string; name: string; created_at: number } | undefined
  if (!row) return null
  return { id: row.id, name: row.name, createdAt: row.created_at, instanceIds: getGatewayInstances(row.id) }
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
    db().prepare('INSERT INTO gateways (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)').run(newId, newName, newKeyHash, now)
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
  return { id: newId, name: newName, createdAt: now, instanceIds }
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
