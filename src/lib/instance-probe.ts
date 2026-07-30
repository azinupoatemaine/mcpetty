import { getCredential, type InstalledMCP } from './db'
import { findCatalogEntry } from './mcp-catalog'
import { checkServer, analyzeServer, type MCPTool, type SecurityFlag, type MCPServerStatus } from './mcp-client'
import { isRunning, getStdioBridge } from './process-manager'
import { NATIVE } from './native'

// The dashboard probes every installed instance on every load, in one Promise.all, so the
// page waits for the slowest backend. Unreachable instances cost a full timeout each, which
// is what made the front page feel slow on navigation and reload even when nothing changed.
//
// Only the *network* half is cached here. Name, tags and health config come from SQLite on
// every request — they're cheap and must never look stale after an edit.
const PROBE_TTL_MS = 30_000

export interface InstanceProbe {
  url:             string
  online:          boolean
  processRunning:  boolean
  tools:           MCPTool[]
  flags:           SecurityFlag[]
  error?:          string
  latencyMs:       number
  native?:         boolean
  serverInfo?:     MCPServerStatus['serverInfo']
  /** When this probe actually ran. Lets the UI say "as of N seconds ago" if it wants to. */
  probedAt:        number
}

const cache = new Map<string, { probe: InstanceProbe; expiresAt: number }>()

export function invalidateInstanceProbe(instanceId?: string): void {
  if (instanceId) cache.delete(instanceId)
  else cache.clear()
}

async function runProbe(inst: InstalledMCP): Promise<InstanceProbe | null> {
  const { instanceId, type, port } = inst
  const entry = findCatalogEntry(type)
  if (!entry) return null

  const probedAt = Date.now()
  const start    = Date.now()

  if (entry.transport === 'native') {
    const handler = NATIVE[type]
    if (!handler) return null
    const { ok, error } = await handler.ping(instanceId)
    return {
      url: `native:${instanceId}`, native: true, online: ok, processRunning: true,
      tools: ok ? handler.tools : [],
      flags: analyzeServer(`native:${instanceId}`, {}, handler.tools, true),
      error, latencyMs: Date.now() - start, probedAt,
    }
  }

  if (entry.transport === 'stdio') {
    const bridge = getStdioBridge(instanceId)
    if (!bridge) {
      return { url: `stdio:${instanceId}`, online: false, processRunning: false, tools: [], flags: [], error: 'Process not running', latencyMs: 0, probedAt }
    }
    try {
      const tools = await bridge.listTools()
      return { url: `stdio:${instanceId}`, online: true, processRunning: true, tools, flags: analyzeServer(`stdio:${instanceId}`, {}, tools, true), latencyMs: Date.now() - start, probedAt }
    } catch (e) {
      return { url: `stdio:${instanceId}`, online: false, processRunning: isRunning(instanceId), tools: [], flags: [], error: e instanceof Error ? e.message : 'Unknown', latencyMs: Date.now() - start, probedAt }
    }
  }

  if (entry.transport === 'http-proxy') {
    const url   = getCredential(instanceId, 'MCP_URL')
    const token = getCredential(instanceId, 'MCP_TOKEN')
    if (!url) return { url: '', online: false, processRunning: false, tools: [], flags: [], error: 'MCP_URL not configured', latencyMs: 0, probedAt }
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
    const status = await checkServer(url, headers)
    return { url, processRunning: true, latencyMs: 0, ...status, probedAt }
  }

  const url    = `http://127.0.0.1:${port}/mcp`
  const status = await checkServer(url, {})
  return { url, processRunning: isRunning(instanceId), latencyMs: 0, ...status, probedAt }
}

// fresh=true skips the cache — used by the dashboard's manual refresh and its auto-poll, so
// an operator who clicks refresh always gets a real probe.
export async function probeInstance(inst: InstalledMCP, fresh: boolean): Promise<InstanceProbe | null> {
  if (!fresh) {
    const hit = cache.get(inst.instanceId)
    if (hit && Date.now() < hit.expiresAt) return hit.probe
  }
  const probe = await runProbe(inst)
  if (probe) cache.set(inst.instanceId, { probe, expiresAt: Date.now() + PROBE_TTL_MS })
  return probe
}
