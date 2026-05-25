import { NextRequest, NextResponse } from 'next/server'
import { findCatalogEntry } from '../../../lib/mcp-catalog'
import { setCredential, deleteCredential, credentialStatus, getInstalledMCPs } from '../../../lib/db'
import { isAuthorizedRequest, getSessionUsernameFromRequest } from '../../../lib/auth'
import { withActor } from '../../../lib/audit'
import { writeAuditEvent } from '../../../lib/db'

function resolveType(instanceId: string, typeId?: string | null): string | null {
  if (typeId) return typeId
  return getInstalledMCPs().find((m) => m.instanceId === instanceId)?.type ?? null
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const instanceId = req.nextUrl.searchParams.get('id')
  if (!instanceId) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const typeId = resolveType(instanceId, req.nextUrl.searchParams.get('type'))
  const entry  = typeId ? findCatalogEntry(typeId) : null
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const result: Record<string, { isSet: boolean; updatedAt: number | null }> = {}
  for (const cred of entry.credentials) {
    result[cred.key] = credentialStatus(instanceId, cred.key)
  }
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: instanceId, type: typeIdRaw, key, value } = await req.json()
  if (!instanceId) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const typeId = resolveType(instanceId, typeIdRaw)
  const entry  = typeId ? findCatalogEntry(typeId) : null
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const declared = entry.credentials.map((c) => c.key)
  if (!declared.includes(key)) {
    return NextResponse.json({ error: 'Credential key not declared for this MCP' }, { status: 400 })
  }

  try {
    setCredential(instanceId, key, value)
    withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
      writeAuditEvent('credential_set', instanceId, { key })
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Encryption failed' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id  = req.nextUrl.searchParams.get('instanceId') ?? req.nextUrl.searchParams.get('id')
  const key = req.nextUrl.searchParams.get('key')
  if (!id || !key) return NextResponse.json({ error: 'instanceId and key required' }, { status: 400 })
  deleteCredential(id, key)
  withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
    writeAuditEvent('credential_delete', id, { key })
  })
  return NextResponse.json({ ok: true })
}
