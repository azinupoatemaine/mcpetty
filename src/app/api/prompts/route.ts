import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest, getSessionUsernameFromRequest } from '../../../lib/auth'
import { withActor } from '../../../lib/audit'
import {
  listAllPrompts, upsertPrompt, deletePrompt, writeAuditEvent,
  getNamespace, type PromptArgument,
} from '../../../lib/db'
import { broadcastNotification } from '../../../lib/sse-bus'

export const dynamic = 'force-dynamic'

// Prompt names become slash commands in the client (/mcpetty:diagnose-stack), so they have
// to survive that round trip intact.
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

function parseArguments(raw: unknown): PromptArgument[] | string {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) return 'arguments must be an array'
  const out: PromptArgument[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return 'each argument must be an object'
    const { name, description, required } = item as Record<string, unknown>
    if (typeof name !== 'string' || !NAME_RE.test(name)) {
      return `invalid argument name "${String(name)}" — lowercase letters, digits, _ and - only`
    }
    out.push({ name, description: typeof description === 'string' ? description : '', required: required === true })
  }
  return out
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(listAllPrompts())
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as {
    id?: string; namespaceId?: string | null; name?: string
    description?: string; arguments?: unknown; template?: string
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const name = body.name?.trim() ?? ''
  if (!NAME_RE.test(name)) {
    return NextResponse.json({ error: 'Name must be lowercase letters, digits, _ or - (max 64 chars)' }, { status: 400 })
  }

  const template = body.template ?? ''
  if (!template.trim()) return NextResponse.json({ error: 'Template is required' }, { status: 400 })

  const args = parseArguments(body.arguments)
  if (typeof args === 'string') return NextResponse.json({ error: args }, { status: 400 })

  const namespaceId = body.namespaceId?.trim() || null
  if (namespaceId && !getNamespace(namespaceId)) {
    return NextResponse.json({ error: `Namespace "${namespaceId}" not found` }, { status: 400 })
  }

  // A required argument with no placeholder is dead weight the client will still prompt
  // for; catching it here beats discovering it from the other side of a slash command.
  const unused = args.filter((a) => !new RegExp(`\\{\\{\\s*${a.name}\\s*\\}\\}`).test(template))
  if (unused.length) {
    return NextResponse.json({
      error: `Argument${unused.length > 1 ? 's' : ''} never used in the template: ${unused.map((a) => `{{${a.name}}}`).join(', ')}`,
    }, { status: 400 })
  }

  try {
    const saved = upsertPrompt({
      id:          body.id,
      namespaceId,
      name,
      description: body.description?.trim() ?? '',
      arguments:   args,
      template,
    })
    withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
      writeAuditEvent('prompt_upsert', name, { namespaceId, id: saved.id })
    })
    broadcastNotification({ jsonrpc: '2.0', method: 'notifications/prompts/list_changed' })
    return NextResponse.json(saved)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to save prompt'
    return NextResponse.json(
      { error: msg.includes('UNIQUE') ? `A prompt named "${name}" already exists in this scope` : msg },
      { status: 400 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  withActor({ actorType: 'user', actorId: getSessionUsernameFromRequest(req) }, () => {
    writeAuditEvent('prompt_delete', id)
  })
  deletePrompt(id)
  broadcastNotification({ jsonrpc: '2.0', method: 'notifications/prompts/list_changed' })
  return NextResponse.json({ ok: true })
}
