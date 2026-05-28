import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '../../../../../../lib/auth'
import { getNamespaceToolFilters } from '../../../../../../lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; instanceId: string }> }
) {
  if (!isAuthorizedRequest(req)) return new NextResponse('Unauthorized', { status: 401 })
  const { id, instanceId } = await params
  return NextResponse.json(getNamespaceToolFilters(id, instanceId))
}
