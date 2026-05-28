import { NextRequest, NextResponse } from 'next/server'
import { getMasterGatewayKey, getSetting } from '../../lib/db'
import {
  checkOrigin, checkProtocolVersion,
  createMasterScope, handleMcpPost, handleMcpGet, handleMcpDelete,
} from '../../lib/mcp-handler'

export const dynamic = 'force-dynamic'

function masterEnabled(): boolean {
  return getSetting('master_gateway_enabled') === 'true'
}

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? ''
  return auth.startsWith('Bearer ') && auth.slice(7) === getMasterGatewayKey()
}

const DISABLED_RESP = NextResponse.json(
  { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Master gateway is disabled. Use a namespace endpoint instead (/mcp/<slug>). Enable in MCPetty Settings.' } },
  { status: 403 }
)

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return new NextResponse('Forbidden', { status: 403 })
  if (!masterEnabled()) return DISABLED_RESP
  if (!authorized(req)) return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized — add Authorization: Bearer <key> header (get key from MCPetty settings)' } },
    { status: 401 }
  )
  const proto = checkProtocolVersion(req)
  if (!proto.ok) return new NextResponse(`Unsupported MCP-Protocol-Version: ${proto.version}`, { status: 400 })
  return handleMcpPost(req, createMasterScope())
}

export async function GET(req: NextRequest) {
  if (!checkOrigin(req)) return new NextResponse('Forbidden', { status: 403 })
  if (!masterEnabled()) return new NextResponse('Master gateway disabled', { status: 403 })
  if (!authorized(req)) return new NextResponse('Unauthorized', { status: 401 })
  return handleMcpGet(req)
}

export async function DELETE(req: NextRequest) {
  if (!masterEnabled()) return new NextResponse('Master gateway disabled', { status: 403 })
  if (!authorized(req)) return new NextResponse('Unauthorized', { status: 401 })
  return handleMcpDelete(req)
}
