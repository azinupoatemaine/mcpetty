import { NextRequest, NextResponse } from 'next/server'
import { getMasterGatewayKey } from '../../lib/db'
import {
  checkOrigin, checkProtocolVersion,
  createMasterScope, handleMcpPost, handleMcpGet, handleMcpDelete,
} from '../../lib/mcp-handler'

export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? ''
  return auth.startsWith('Bearer ') && auth.slice(7) === getMasterGatewayKey()
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return new NextResponse('Forbidden', { status: 403 })
  if (!authorized(req)) return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized — add Authorization: Bearer <key> header (get key from MCPetty dashboard)' } },
    { status: 401 }
  )
  const proto = checkProtocolVersion(req)
  if (!proto.ok) return new NextResponse(`Unsupported MCP-Protocol-Version: ${proto.version}`, { status: 400 })
  return handleMcpPost(req, createMasterScope())
}

export async function GET(req: NextRequest) {
  if (!checkOrigin(req)) return new NextResponse('Forbidden', { status: 403 })
  if (!authorized(req)) return new NextResponse('Unauthorized', { status: 401 })
  return handleMcpGet(req)
}

export async function DELETE(req: NextRequest) {
  if (!authorized(req)) return new NextResponse('Unauthorized', { status: 401 })
  return handleMcpDelete(req)
}
