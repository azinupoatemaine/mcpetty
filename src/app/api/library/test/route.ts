import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { isAuthorizedRequest } from '../../../../lib/auth'
import { findCatalogEntry } from '../../../../lib/mcp-catalog'
import { setCredential, deleteAllCredentials, getCredential } from '../../../../lib/db'
import { checkServer } from '../../../../lib/mcp-client'
import { NATIVE } from '../../../../lib/native'

export const dynamic = 'force-dynamic'

// POST /api/library/test — { type, credentials, instanceId? }
//
// Answers "are these credentials right?" before anything is installed, instead of the
// operator discovering a typo minutes later when a dashboard card turns red. Credentials
// are written under a throwaway instance id and deleted in a finally block, so a probe
// never mutates a real instance and never leaves residue behind.
//
// With instanceId set (re-testing an installed instance) any credential the caller leaves
// blank falls back to the stored value — that's how you verify one rotated field without
// having to re-type the rest.
export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type, credentials, instanceId } = await req.json() as {
    type:        string
    credentials: Record<string, string>
    instanceId?: string
  }

  const entry = findCatalogEntry(type)
  if (!entry) return NextResponse.json({ ok: false, error: 'Not in catalog' }, { status: 404 })

  const resolved: Record<string, string> = {}
  for (const cred of entry.credentials) {
    const supplied = credentials?.[cred.key]?.trim()
    const value    = supplied || (instanceId ? getCredential(instanceId, cred.key) ?? '' : '')
    if (value) resolved[cred.key] = value
    if (cred.required && !value) {
      return NextResponse.json({ ok: false, error: `Missing required credential: ${cred.key}` }, { status: 400 })
    }
  }

  const probeId = `__test_${randomBytes(8).toString('hex')}`
  try {
    for (const [key, value] of Object.entries(resolved)) setCredential(probeId, key, value)

    if (entry.transport === 'native') {
      const handler = NATIVE[type]
      if (!handler) return NextResponse.json({ ok: false, error: 'No native handler' }, { status: 500 })
      const started = Date.now()
      const { ok, error } = await handler.ping(probeId)
      return NextResponse.json({ ok, error, latencyMs: Date.now() - started, toolCount: ok ? handler.tools.length : 0 })
    }

    if (entry.transport === 'http-proxy') {
      const url = resolved['MCP_URL']
      const headers: Record<string, string> = resolved['MCP_TOKEN'] ? { Authorization: `Bearer ${resolved['MCP_TOKEN']}` } : {}
      const status = await checkServer(url, headers)
      return NextResponse.json({
        ok:        status.online,
        error:     status.error,
        latencyMs: status.latencyMs,
        toolCount: status.tools.length,
        // Worth showing: a remote MCP that connects but exposes nothing usually means the
        // token is valid yet scoped to nothing.
        serverName: status.serverInfo?.name,
      })
    }

    // stdio / http transports only come up after the subprocess is spawned, which install
    // does — there is nothing to probe ahead of time.
    return NextResponse.json({ ok: true, skipped: true, error: `${entry.transport} transport is only testable after install` })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Test failed' })
  } finally {
    deleteAllCredentials(probeId)
  }
}
