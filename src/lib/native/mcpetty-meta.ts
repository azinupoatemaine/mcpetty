import { getInstalledMCPs, getInsights, getSessions } from '../db'
import type { MCPTool } from '../mcp-client'
import type { CallScope } from './index'

export const TOOLS: MCPTool[] = [
  {
    name: 'get_status',
    description: 'List all installed MCP instances and their enabled state. Optionally filter by tag.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Filter to instances with this tag' },
      },
    },
  },
  {
    name: 'get_insights_summary',
    description: 'Summary stats for tool calls over the last N days: total, success rate, avg latency, retry rate, top platforms.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Lookback window in days (default 7, max 30)' },
      },
    },
  },
  {
    name: 'get_recent_calls',
    description: 'Most recent tool calls through the gateway, newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:    { type: 'number',  description: 'Number of calls to return (default 20, max 100)' },
        platform: { type: 'string',  description: 'Filter to a specific MCP instance ID' },
      },
    },
  },
  {
    name: 'get_error_patterns',
    description: 'Top recurring errors grouped by platform, action, and message — with counts and last-seen timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Lookback window in days (default 7)' },
      },
    },
  },
  {
    name: 'get_top_actions',
    description: 'Most frequently called actions across all platforms, with avg/p95 latency and error rates.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Lookback window in days (default 7)' },
      },
    },
  },
  {
    name: 'get_sessions',
    description: 'Recent Claude sessions — call count, platforms used, duration, and error count per session.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Lookback window in days (default 7)' },
      },
    },
  },
]

export async function ping(_instanceId: string): Promise<{ ok: boolean }> {
  return { ok: true }
}

// This handler reports on MCPetty itself, so every one of its answers is a view across
// instances — and a namespace-scoped key must not use it to enumerate or observe the
// instances it was denied. Everything below is filtered to the caller's scope.
export async function call(_instanceId: string, toolName: string, args: Record<string, unknown>, scope?: CallScope): Promise<unknown> {
  const days    = Math.min(Number(args.days ?? 7), 30)
  const allowed = scope?.instanceIds ?? null
  const visible = (platform: string) => allowed === null || allowed.includes(platform)

  switch (toolName) {
    case 'get_status': {
      const mcps = getInstalledMCPs().filter((m) => visible(m.instanceId))
      const tag  = typeof args.tag === 'string' ? args.tag.trim() : undefined
      const list = tag ? mcps.filter((m) => (m.tags ?? []).includes(tag)) : mcps
      return list.map((m) => ({ instanceId: m.instanceId, type: m.type, name: m.name, enabled: m.enabled, tags: m.tags ?? [] }))
    }

    case 'get_insights_summary': {
      const ins = getInsights(days)
      const perPlatform = ins.perPlatform.filter((p) => visible(p.platform))
      // Totals come from perPlatform rather than ins.summary, which is un-scoped.
      const total     = perPlatform.reduce((n, p) => n + p.total, 0)
      const errors    = perPlatform.reduce((n, p) => n + p.errors, 0)
      const successRate = total > 0 ? Math.round(((total - errors) / total) * 100) : 100
      return {
        days,
        total,
        successRate: `${successRate}%`,
        avgLatency:  `${Math.round(ins.summary.avgLatency)}ms`,
        retryRate:   `${ins.summary.retryRate}%`,
        topPlatforms: perPlatform.slice(0, 5).map((p) => ({ platform: p.platform, calls: p.total, errors: p.errors })),
        ...(allowed === null ? { callsPerDay: ins.callsPerDay } : {}),
      }
    }

    case 'get_recent_calls': {
      const limit = Math.min(Number(args.limit ?? 20), 100)
      const requested = typeof args.platform === 'string' ? args.platform : undefined
      if (requested && !visible(requested)) throw new Error(`Platform "${requested}" is not in this namespace`)
      const ins = getInsights(days, requested)
      return ins.recentCalls.filter((c) => visible(c.platform)).slice(0, limit).map((c) => ({
        time:     new Date(c.timestamp).toISOString(),
        platform: c.platform,
        action:   c.action,
        outcome:  c.outcome,
        latency:  `${c.latency_ms}ms`,
        error:    c.error ?? undefined,
      }))
    }

    case 'get_error_patterns': {
      const ins = getInsights(days)
      return ins.errorPatterns.filter((e) => visible(e.platform)).map((e) => ({
        platform:  e.platform,
        action:    e.action,
        error:     e.error,
        count:     e.total,
        lastSeen:  new Date(e.last_seen).toISOString(),
      }))
    }

    case 'get_top_actions': {
      const ins = getInsights(days)
      return ins.topActions.filter((a) => visible(a.platform)).map((a) => ({
        platform:   a.platform,
        action:     a.action,
        calls:      a.total,
        errors:     a.errors,
        avgLatency: `${a.avgLatency}ms`,
        p95Latency: `${a.p95Latency}ms`,
      }))
    }

    case 'get_sessions': {
      // A session that touched any out-of-scope platform is dropped entirely rather than
      // listed with its platform list trimmed — the call/error counts would still describe
      // activity the caller cannot see.
      const sessions = getSessions(days)
        .map((s) => ({ s, platforms: s.platform_list?.split(',').filter(Boolean) ?? [] }))
        .filter(({ platforms }) => platforms.every(visible))
      return sessions.map(({ s, platforms }) => ({
        sessionId:  s.session_id,
        started:    new Date(s.started_at).toISOString(),
        duration:   `${Math.round((s.ended_at - s.started_at) / 1000)}s`,
        calls:      s.calls,
        platforms,
        errors:     s.errors,
      }))
    }

    default:
      throw new Error(`Unknown MCPetty Meta tool: ${toolName}`)
  }
}
