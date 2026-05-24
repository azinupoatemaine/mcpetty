import { NextRequest, NextResponse } from 'next/server'
import { getInstalledMCPs, isToolEnabled } from '../../../lib/db'
import { findCatalogEntry } from '../../../lib/mcp-catalog'
import { callTool } from '../../../lib/mcp-client'
import { isAuthorizedRequest } from '../../../lib/auth'
import { getStdioBridge } from '../../../lib/process-manager'
import { NATIVE } from '../../../lib/native'

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { mcpId, toolName, args } = await req.json()

  const installed = getInstalledMCPs().find((m) => m.instanceId === mcpId)
  if (!installed) return NextResponse.json({ error: 'MCP not installed' }, { status: 404 })

  const entry = findCatalogEntry(installed.type)
  if (!entry) return NextResponse.json({ error: 'MCP type not in catalog' }, { status: 404 })

  if (!isToolEnabled(mcpId, toolName, installed.type))
    return NextResponse.json({ error: `Action "${toolName}" is disabled` }, { status: 403 })

  try {
    if (entry.transport === 'native') {
      const handler = NATIVE[installed.type]
      if (!handler) return NextResponse.json({ error: 'No native handler' }, { status: 500 })
      return NextResponse.json({ result: await handler.call(installed.instanceId, toolName, args ?? {}) })
    }

    if (entry.transport === 'stdio') {
      const bridge = getStdioBridge(installed.instanceId)
      if (!bridge) return NextResponse.json({ error: 'Stdio process not running' }, { status: 503 })
      return NextResponse.json({ result: await bridge.callTool(toolName, args ?? {}) })
    }

    return NextResponse.json({ result: await callTool(`http://127.0.0.1:${installed.port}/mcp`, {}, toolName, args) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Something broke.' }, { status: 500 })
  }
}
