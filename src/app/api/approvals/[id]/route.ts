import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '../../../../lib/auth'
import { getApprovalRequest, decideApproval, getInstalledMCPs, storeApprovalResult } from '../../../../lib/db'
import { getGatewayApiKey, hashGatewayKey } from '../../../../lib/crypto'
import { findGatewayByKeyHash } from '../../../../lib/db'
import { NATIVE } from '../../../../lib/native'
import { findCatalogEntry } from '../../../../lib/mcp-catalog'

function isAuthorizedBearer(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return false
  const key = auth.slice(7)
  if (key === getGatewayApiKey()) return true
  const gw = findGatewayByKeyHash(hashGatewayKey(key))
  return !!gw
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionOk = isAuthorizedRequest(req)
  const bearerOk  = !sessionOk && isAuthorizedBearer(req)
  if (!sessionOk && !bearerOk) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const approval = getApprovalRequest(id)
  if (!approval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })
  if (approval.status !== 'pending') return NextResponse.json({ error: 'Already decided' }, { status: 409 })

  const { decision, reason } = await req.json() as { decision: 'approved' | 'rejected'; reason?: string }
  if (decision !== 'approved' && decision !== 'rejected') return NextResponse.json({ error: 'decision must be approved or rejected' }, { status: 400 })

  const by = bearerOk ? 'webhook' : 'dashboard'
  decideApproval(id, decision, by, reason)

  if (decision === 'approved') {
    const instance = getInstalledMCPs().find((m) => m.instanceId === approval.instanceId)
    if (instance) {
      const entry = findCatalogEntry(instance.type)
      if (entry?.transport === 'native') {
        const handler = NATIVE[instance.type]
        if (handler) {
          try {
            const result = await handler.call(instance.instanceId, approval.action, JSON.parse(approval.argsJson))
            storeApprovalResult(id, JSON.stringify(result))
          } catch { /* result will be computed on check_approval */ }
        }
      }
    }
  }

  return NextResponse.json({ ok: true })
}
