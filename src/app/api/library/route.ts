import { NextRequest, NextResponse } from 'next/server'
import { CATALOG, findCatalogEntry } from '../../../lib/mcp-catalog'
import { installMCP, uninstallMCP, getInstancesByType, credentialStatus, setCredential, slugify, uniqueInstanceId } from '../../../lib/db'
import { startMCP, stopMCP } from '../../../lib/process-manager'
import { isAuthorizedRequest, getSessionUsernameFromRequest } from '../../../lib/auth'
import { withActor } from '../../../lib/audit'
import { writeAuditEvent } from '../../../lib/db'
import { NATIVE } from '../../../lib/native'
import { broadcastNotification } from '../../../lib/sse-bus'

// GET /api/library — catalog types with their installed instances
export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = CATALOG.filter((entry) => !entry.builtin).map((entry) => {
    const instances = getInstancesByType(entry.id).map((inst) => ({
      instanceId:  inst.instanceId,
      name:        inst.name,
      installedAt: inst.installedAt,
      credentials: entry.credentials.map((cred) => ({
        ...cred,
        ...credentialStatus(inst.instanceId, cred.key),
      })),
    }))
    const tools = entry.transport === 'native' && NATIVE[entry.id]
      ? NATIVE[entry.id].tools.map((t) => ({ name: t.name, description: t.description ?? '' }))
      : []
    return { ...entry, instances, tools }
  })

  return NextResponse.json(result)
}

// POST /api/library — install a new instance: { type, instanceName, credentials }
export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type, instanceName, instanceId: requestedId, credentials } = await req.json() as {
    type: string
    instanceName: string
    instanceId?: string
    credentials: Record<string, string>
  }

  const entry = findCatalogEntry(type)
  if (!entry) return NextResponse.json({ error: 'Not in catalog' }, { status: 404 })

  for (const cred of entry.credentials) {
    if (cred.required && !credentials?.[cred.key]?.trim()) {
      return NextResponse.json({ error: `Missing required credential: ${cred.key}` }, { status: 400 })
    }
  }

  const baseId    = requestedId?.trim() || slugify(instanceName || type)
  const instanceId = uniqueInstanceId(baseId)

  for (const [key, value] of Object.entries(credentials ?? {})) {
    if (value?.trim()) setCredential(instanceId, key, value.trim())
  }

  installMCP(instanceId, type, instanceName || type, entry.internalPort ?? 0)
  startMCP(instanceId, type, entry.internalPort ?? 0)
  broadcastNotification({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })

  withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
    writeAuditEvent('mcp_install', instanceId, { type, name: instanceName || type })
  })

  return NextResponse.json({ ok: true, instanceId })
}

// DELETE /api/library?instanceId=xxx
export async function DELETE(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const instanceId = req.nextUrl.searchParams.get('instanceId')
  if (!instanceId) return NextResponse.json({ error: 'instanceId required' }, { status: 400 })

  withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
    writeAuditEvent('mcp_uninstall', instanceId)
  })
  stopMCP(instanceId)
  uninstallMCP(instanceId)
  broadcastNotification({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })

  return NextResponse.json({ ok: true })
}
