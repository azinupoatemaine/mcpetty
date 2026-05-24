import { getInstalledMCPs, getInsights, getSessions } from '../db'
import type { MCPTool } from '../mcp-client'

export const TOOLS: MCPTool[] = [
  {
    name: 'get_status',
    description: 'List all installed MCP instances and their enabled state.',
    inputSchema: { type: 'object', properties: {} },
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

export async function call(_instanceId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const days = Math.min(Number(args.days ?? 7), 30)

  switch (toolName) {
    case 'get_status': {
      const mcps = getInstalledMCPs()
      return mcps.map((m) => ({ instanceId: m.instanceId, type: m.type, name: m.name, enabled: m.enabled }))
    }

    case 'get_insights_summary': {
      const ins = getInsights(days)
      const successRate = ins.summary.total > 0
        ? Math.round((ins.summary.successes / ins.summary.total) * 100)
        : 100
      return {
        days,
        total:       ins.summary.total,
        successRate: `${successRate}%`,
        avgLatency:  `${Math.round(ins.summary.avgLatency)}ms`,
        retryRate:   `${ins.summary.retryRate}%`,
        topPlatforms: ins.perPlatform.slice(0, 5).map((p) => ({ platform: p.platform, calls: p.total, errors: p.errors })),
        callsPerDay: ins.callsPerDay,
      }
    }

    case 'get_recent_calls': {
      const limit = Math.min(Number(args.limit ?? 20), 100)
      const platform = typeof args.platform === 'string' ? args.platform : undefined
      const ins = getInsights(days, platform)
      return ins.recentCalls.slice(0, limit).map((c) => ({
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
      return ins.errorPatterns.map((e) => ({
        platform:  e.platform,
        action:    e.action,
        error:     e.error,
        count:     e.total,
        lastSeen:  new Date(e.last_seen).toISOString(),
      }))
    }

    case 'get_top_actions': {
      const ins = getInsights(days)
      return ins.topActions.map((a) => ({
        platform:   a.platform,
        action:     a.action,
        calls:      a.total,
        errors:     a.errors,
        avgLatency: `${a.avgLatency}ms`,
        p95Latency: `${a.p95Latency}ms`,
      }))
    }

    case 'get_sessions': {
      const sessions = getSessions(days)
      return sessions.map((s) => ({
        sessionId:  s.session_id,
        started:    new Date(s.started_at).toISOString(),
        duration:   `${Math.round((s.ended_at - s.started_at) / 1000)}s`,
        calls:      s.calls,
        platforms:  s.platform_list?.split(',') ?? [],
        errors:     s.errors,
      }))
    }

    default:
      throw new Error(`Unknown MCPetty Meta tool: ${toolName}`)
  }
}
