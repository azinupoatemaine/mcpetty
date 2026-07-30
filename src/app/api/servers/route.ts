import { NextRequest, NextResponse } from 'next/server'
import { getInstalledMCPs } from '../../../lib/db'
import { findCatalogEntry } from '../../../lib/mcp-catalog'
import { isAuthorizedRequest } from '../../../lib/auth'
import { probeInstance } from '../../../lib/instance-probe'

// GET /api/servers[?fresh=1]
//
// Probes are cached for 30s (see instance-probe.ts) because this runs on every dashboard
// mount and waits on the slowest backend. `fresh=1` forces a real probe — the dashboard
// sends it for the manual refresh button and the auto-poll, so only navigation and reloads
// are served from cache.
export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fresh     = req.nextUrl.searchParams.get('fresh') === '1'
  const installed = getInstalledMCPs()

  const results = await Promise.all(
    installed.map(async (inst) => {
      const entry = findCatalogEntry(inst.type)
      if (!entry) return null

      const probe = await probeInstance(inst, fresh)
      if (!probe) return null

      // DB-derived fields are read fresh every time — only the network probe is cached.
      return {
        id:          inst.instanceId,
        type:        inst.type,
        name:        inst.name,
        description: entry.description,
        credentials: entry.credentials,
        tags:        inst.tags,
        healthCheckIntervalSeconds: inst.healthCheckIntervalSeconds,
        healthCheckFailThreshold:   inst.healthCheckFailThreshold,
        healthConsecutiveFails:     inst.healthConsecutiveFails,
        healthLastCheckedAt:        inst.healthLastCheckedAt,
        healthLastStatus:           inst.healthLastStatus,
        healthLastError:            inst.healthLastError,
        autoDisabled:               inst.autoDisabled,
        ...probe,
      }
    })
  )

  return NextResponse.json(results.filter(Boolean))
}
