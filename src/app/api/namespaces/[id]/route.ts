import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest, getSessionUsernameFromRequest } from '../../../../lib/auth'
import { withActor } from '../../../../lib/audit'
import { writeAuditEvent } from '../../../../lib/db'
import { randomBytes } from 'crypto'
import { hashGatewayKey } from '../../../../lib/crypto'
import {
  getNamespace, deleteNamespace, renameNamespace,
  addNamespaceKey, deleteNamespaceKey,
  setNamespaceServers, setNamespaceToolFilters, setNamespaceMiddleware,
} from '../../../../lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedRequest(req)) return new NextResponse('Unauthorized', { status: 401 })
  const { id } = await params
  const ns = getNamespace(id)
  if (!ns) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(ns)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedRequest(req)) return new NextResponse('Unauthorized', { status: 401 })
  const { id } = await params
  withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
    writeAuditEvent('namespace_delete', id)
  })
  deleteNamespace(id)
  return new NextResponse(null, { status: 204 })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedRequest(req)) return new NextResponse('Unauthorized', { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  if (body.name?.trim()) {
    renameNamespace(id, body.name.trim())
    withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
      writeAuditEvent('namespace_rename', id, { name: body.name!.trim() })
    })
  }
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedRequest(req)) return new NextResponse('Unauthorized', { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body?.action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  switch (body.action as string) {
    case 'add_key': {
      const rawKey = randomBytes(32).toString('base64url')
      const hash   = hashGatewayKey(rawKey)
      const keyId  = addNamespaceKey(id, hash, body.label ?? '')
      withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
        writeAuditEvent('namespace_key_add', id, { keyId, label: body.label ?? '' })
      })
      return NextResponse.json({ keyId, key: rawKey })
    }
    case 'delete_key': {
      if (!body.keyId) return NextResponse.json({ error: 'keyId required' }, { status: 400 })
      deleteNamespaceKey(body.keyId)
      withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
        writeAuditEvent('namespace_key_delete', id, { keyId: body.keyId })
      })
      return NextResponse.json({ ok: true })
    }
    case 'set_servers': {
      if (!Array.isArray(body.instanceIds)) return NextResponse.json({ error: 'instanceIds array required' }, { status: 400 })
      setNamespaceServers(id, body.instanceIds)
      return NextResponse.json({ ok: true })
    }
    case 'set_tool_filters': {
      if (!body.instanceId || !body.filters) return NextResponse.json({ error: 'instanceId and filters required' }, { status: 400 })
      setNamespaceToolFilters(id, body.instanceId, body.filters as Record<string, boolean>)
      return NextResponse.json({ ok: true })
    }
    case 'set_middleware': {
      if (!body.type) return NextResponse.json({ error: 'type required' }, { status: 400 })
      setNamespaceMiddleware(id, body.type, body.config ?? {})
      return NextResponse.json({ ok: true })
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
  }
}
