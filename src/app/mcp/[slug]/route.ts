import { NextRequest, NextResponse } from 'next/server'
import { hashGatewayKey } from '../../../lib/crypto'
import { getNamespace, findNamespaceByKeyHash, isToolEnabledForNamespace, getDescriptionOverrides } from '../../../lib/db'
import {
  MCPScope, checkOrigin, checkProtocolVersion,
  handleMcpPost, handleMcpGet, handleMcpDelete,
} from '../../../lib/mcp-handler'

export const dynamic = 'force-dynamic'

function buildNamespaceScope(ns: NonNullable<ReturnType<typeof getNamespace>>): MCPScope {
  const ctxMw = ns.middleware.context_prefix as { text?: string } | undefined
  const rlMw  = ns.middleware.rate_limit    as { max_calls?: number; window_secs?: number } | undefined
  return {
    id:                      ns.id,
    name:                    ns.name,
    instanceIds:             ns.instanceIds.length > 0 ? ns.instanceIds : [],
    isActionEnabled:         (instanceId, action, type) => isToolEnabledForNamespace(ns.id, instanceId, action, type),
    getDescriptionOverrides: (instanceId) => getDescriptionOverrides(instanceId),
    contextPrefix:           ctxMw?.text ?? '',
    rateLimit:               rlMw?.max_calls ? { maxCalls: rlMw.max_calls, windowSecs: rlMw.window_secs ?? 60 } : null,
  }
}

function resolveNamespace(req: NextRequest, slug: string): ReturnType<typeof getNamespace> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  const hash = hashGatewayKey(auth.slice(7))
  const ref  = findNamespaceByKeyHash(hash)
  if (!ref || ref.namespaceId !== slug) return null
  return getNamespace(slug)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!checkOrigin(req)) return new NextResponse('Forbidden', { status: 403 })
  const { slug } = await params
  const ns = resolveNamespace(req, slug)
  if (!ns) return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: `Unauthorized or namespace "${slug}" not found` } },
    { status: 401 }
  )
  const proto = checkProtocolVersion(req)
  if (!proto.ok) return new NextResponse(`Unsupported MCP-Protocol-Version: ${proto.version}`, { status: 400 })
  return handleMcpPost(req, buildNamespaceScope(ns))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!checkOrigin(req)) return new NextResponse('Forbidden', { status: 403 })
  const { slug } = await params
  const ns = resolveNamespace(req, slug)
  if (!ns) return new NextResponse('Unauthorized', { status: 401 })
  return handleMcpGet(req)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ns = resolveNamespace(req, slug)
  if (!ns) return new NextResponse('Unauthorized', { status: 401 })
  return handleMcpDelete(req)
}
