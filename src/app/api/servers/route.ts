import { NextRequest, NextResponse } from 'next/server'
import { getInstalledMCPs, getCredential } from '../../../lib/db'
import { findCatalogEntry } from '../../../lib/mcp-catalog'
import { checkServer, analyzeServer } from '../../../lib/mcp-client'
import { isRunning, getStdioBridge } from '../../../lib/process-manager'
import { isAuthorizedRequest } from '../../../lib/auth'
import { NATIVE } from '../../../lib/native'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const installed = getInstalledMCPs()

  const results = await Promise.all(
    installed.map(async ({ instanceId, type, name, port, tags, healthCheckIntervalSeconds, healthCheckFailThreshold, healthConsecutiveFails, healthLastCheckedAt, healthLastStatus, healthLastError, autoDisabled }) => {
      const entry = findCatalogEntry(type)
      if (!entry) return null

      const healthFields = { healthCheckIntervalSeconds, healthCheckFailThreshold, healthConsecutiveFails, healthLastCheckedAt, healthLastStatus, healthLastError, autoDisabled }
      const base = { id: instanceId, type, name, description: entry.description, credentials: entry.credentials, tags, ...healthFields }

      if (entry.transport === 'native') {
        const handler = NATIVE[type]
        if (!handler) return null
        const start = Date.now()
        const { ok, error } = await handler.ping(instanceId)
        const flags = analyzeServer(`native:${instanceId}`, {}, handler.tools, true)
        return { ...base, url: `native:${instanceId}`, native: true, online: ok, processRunning: true, tools: ok ? handler.tools : [], flags, error, latencyMs: Date.now() - start }
      }

      if (entry.transport === 'stdio') {
        const bridge = getStdioBridge(instanceId)
        const start  = Date.now()
        if (!bridge) return { ...base, url: `stdio:${instanceId}`, online: false, processRunning: false, tools: [], flags: [], error: 'Process not running', latencyMs: 0 }
        try {
          const tools = await bridge.listTools()
          return { ...base, url: `stdio:${instanceId}`, online: true, processRunning: true, tools, flags: analyzeServer(`stdio:${instanceId}`, {}, tools, true), latencyMs: Date.now() - start }
        } catch (e) {
          return { ...base, url: `stdio:${instanceId}`, online: false, processRunning: isRunning(instanceId), tools: [], flags: [], error: e instanceof Error ? e.message : 'Unknown', latencyMs: Date.now() - start }
        }
      }

      if (entry.transport === 'http-proxy') {
        const url   = getCredential(instanceId, 'MCP_URL')
        const token = getCredential(instanceId, 'MCP_TOKEN')
        if (!url) return { ...base, url: '', online: false, processRunning: false, tools: [], flags: [], error: 'MCP_URL not configured', latencyMs: 0 }
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
        const status = await checkServer(url, headers)
        return { ...base, url, processRunning: true, ...status }
      }

      const url    = `http://127.0.0.1:${port}/mcp`
      const status = await checkServer(url, {})
      return { ...base, url, processRunning: isRunning(instanceId), ...status }
    })
  )

  return NextResponse.json(results.filter(Boolean))
}
