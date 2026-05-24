import { NextRequest, NextResponse } from 'next/server'
import { isInstanceInstalled, installMCP, uninstallMCP } from '../../../lib/db'
import { isAuthorizedRequest } from '../../../lib/auth'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ installed: isInstanceInstalled('mcpetty') })
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { enabled } = await req.json() as { enabled: boolean }
  if (enabled) {
    installMCP('mcpetty', 'mcpetty', 'MCPetty Meta', 0)
  } else {
    uninstallMCP('mcpetty')
  }
  return NextResponse.json({ ok: true, installed: enabled })
}
