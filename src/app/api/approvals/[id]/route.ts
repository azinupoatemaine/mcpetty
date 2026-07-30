import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest, getSessionUsernameFromRequest } from '../../../../lib/auth'
import { withActor } from '../../../../lib/audit'
import { writeAuditEvent } from '../../../../lib/db'
import { getApprovalRequest, decideApproval, getInstalledMCPs, storeApprovalResult, isApprovalExpired } from '../../../../lib/db'
import { secretEquals } from '../../../../lib/crypto'
import { getApproverKey } from '../../../../lib/db'
import { NATIVE } from '../../../../lib/native'
import { findCatalogEntry } from '../../../../lib/mcp-catalog'

// Only the dedicated approver key may decide approvals over Bearer auth. Gateway and
// namespace keys are explicitly NOT accepted: those are handed to the MCP client, so
// honouring them would let an agent approve the request its own call just raised —
// defeating the entire point of an approval rule.
function isAuthorizedBearer(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return false
  return secretEquals(auth.slice(7), getApproverKey())
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionOk = isAuthorizedRequest(req)
  const bearerOk  = !sessionOk && isAuthorizedBearer(req)
  if (!sessionOk && !bearerOk) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const approval = getApprovalRequest(id)
  if (!approval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })
  if (approval.status !== 'pending') return NextResponse.json({ error: 'Already decided' }, { status: 409 })
  if (isApprovalExpired(approval)) return NextResponse.json({ error: 'Approval request expired' }, { status: 410 })

  const { decision, reason } = await req.json() as { decision: 'approved' | 'rejected'; reason?: string }
  if (decision !== 'approved' && decision !== 'rejected') return NextResponse.json({ error: 'decision must be approved or rejected' }, { status: 400 })

  const by = bearerOk ? 'webhook' : 'dashboard'
  decideApproval(id, decision, by, reason)
  const actorId = bearerOk ? 'webhook' : getSessionUsernameFromRequest(req)
  withActor({ actorType: bearerOk ? 'gateway' : 'user', actorId }, () => {
    writeAuditEvent('approval_decided', id, { decision, action: approval.action, instanceId: approval.instanceId, reason: reason ?? null })
  })

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
