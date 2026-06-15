'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Nav, Footer } from './nav'
import { S } from './styles'
import { useAnon, buildAnonMap, ap } from './anon'
import { useDemo } from './demo'

const PLAT_COLORS = [S.green, '#00bfff', S.yellow, '#ff69b4', '#a855f7', '#f97316', '#06b6d4']

interface Summary    { total: number; successes: number; avgLatency: number; retryRate: number }
interface DayData    { date: string; total: number; errors: number }
interface PlatData   { platform: string; total: number; errors: number }
interface GatewayData { gateway_label: string; gateway_id: string | null; total: number; errors: number }
interface ActionData { platform: string; action: string; total: number; errors: number; avgLatency: number; p95Latency: number }
interface CallRecord { id: number; timestamp: number; platform: string; action: string; args_json: string; outcome: string; latency_ms: number; error: string | null; gateway_id: string | null; gateway_name: string | null; user_agent: string | null; result_json: string | null }
interface UAData     { ua: string; total: number; errors: number }
interface HeatCell   { hour: number; dow: number; total: number }
interface ErrPattern { platform: string; action: string; error: string; total: number; last_seen: number }
interface LatTrend   { date: string; platform: string; avgLatency: number }
interface CoOccur    { tool_a: string; tool_b: string; sessions: number }
interface SessionSummary { session_id: string; calls: number; platforms: number; started_at: number; ended_at: number; errors: number; platform_list: string; user_agent: string; total_latency_ms: number }

interface TokenBurnAction { platform: string; action: string; inputTokens: number; outputTokens: number; calls: number }
interface TokenBurn      { totalInputTokens: number; totalOutputTokens: number; perAction: TokenBurnAction[] }

interface SchemaTokenEntry { timestamp: number; gatewayId: string | null; totalTokens: number; breakdownJson: string }

interface InsightsData {
  summary:       Summary
  callsPerDay:   DayData[]
  perPlatform:   PlatData[]
  perGateway:    GatewayData[]
  topActions:    ActionData[]
  recentCalls:   CallRecord[]
  perUA:         UAData[]
  heatmap:       HeatCell[]
  errorPatterns: ErrPattern[]
  latencyTrend:  LatTrend[]
  cooccurrence:  CoOccur[]
  tokenBurn:     TokenBurn
  schemaTrend:   SchemaTokenEntry[]
  latestSchema:  SchemaTokenEntry | null
  allPlatforms:  Array<{ instanceId: string; name: string }>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLastNDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (n - 1 - i))
    return d.toISOString().slice(0, 10)
  })
}

function dayLabel(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function fmtArgs(json: string): string {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>
    const pairs = Object.entries(obj).map(([k, v]) => {
      const s = typeof v === 'string' ? `"${v.length > 40 ? v.slice(0, 40) + '…' : v}"` : String(v)
      return `${k}: ${s}`
    })
    const full = pairs.join(', ')
    return full.length > 90 ? full.slice(0, 90) + '…' : full
  } catch { return json.slice(0, 90) }
}

function parseUA(ua: string | null): string {
  if (!ua || ua === 'unknown') return 'unknown'
  if (/claude.?code/i.test(ua))    return 'Claude Code'
  if (/claude.?desktop/i.test(ua)) return 'Claude Desktop'
  if (/anthropic/i.test(ua))       return 'Anthropic'
  if (/electron/i.test(ua))        return 'Desktop (Electron)'
  const m = ua.match(/^([A-Za-z0-9_\-.]+)\//)
  return m ? m[1] : ua.slice(0, 20)
}

function errorColor(errors: number, total: number): string {
  if (total === 0) return S.dim
  const r = errors / total
  if (r >= 0.2) return S.red
  if (r >= 0.05) return S.yellow
  return S.green
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: '14px 18px', flex: 1 }}>
      <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{label}</div>
      <div style={{ color: S.text, fontSize: 22, fontWeight: 'bold', fontFamily: 'monospace' }}>{value}</div>
      {sub && <div style={{ color: S.dim, fontSize: 11, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ─── Day chart ────────────────────────────────────────────────────────────────

function DayChart({ data, daysArr }: { data: DayData[]; daysArr: string[] }) {
  const map    = new Map(data.map((d) => [d.date, d]))
  const filled = daysArr.map((date) => map.get(date) ?? { date, total: 0, errors: 0 })
  const max    = Math.max(...filled.map((d) => d.total), 1)
  const slim   = daysArr.length > 14

  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Calls per day</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: slim ? 3 : 8, height: 80 }}>
        {filled.map((d) => {
          const h    = Math.max((d.total / max) * 80, d.total > 0 ? 4 : 0)
          const errH = d.total > 0 ? (d.errors / d.total) * h : 0
          const okH  = h - errH
          return (
            <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 80 }}>
                {d.total > 0 ? (
                  <div style={{ width: '100%' }}>
                    {errH > 0 && <div style={{ height: errH, background: S.red, opacity: 0.8, borderRadius: '2px 2px 0 0' }} />}
                    {okH  > 0 && <div style={{ height: okH, background: S.green, opacity: 0.7, borderRadius: errH > 0 ? 0 : '2px 2px 0 0' }} />}
                  </div>
                ) : (
                  <div style={{ height: 2, background: 'var(--border)', borderRadius: 1 }} />
                )}
              </div>
              {!slim && <div style={{ color: S.dim, fontSize: 9, marginTop: 6 }}>{dayLabel(d.date)}</div>}
              {!slim && d.total > 0 && <div style={{ color: S.muted, fontSize: 9 }}>{d.total}</div>}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: S.dim }}>
          <span style={{ width: 8, height: 8, background: S.green, opacity: 0.7, borderRadius: 1, display: 'inline-block' }} /> success
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: S.dim }}>
          <span style={{ width: 8, height: 8, background: S.red, opacity: 0.8, borderRadius: 1, display: 'inline-block' }} /> error
        </span>
      </div>
    </div>
  )
}

// ─── Latency trend (SVG line chart) ──────────────────────────────────────────

function LatencyTrend({ data, daysArr, anon, anonMap }: { data: LatTrend[]; daysArr: string[]; anon?: boolean; anonMap?: Map<string, string> }) {
  if (!data.length) return null

  const platforms = [...new Set(data.map((r) => r.platform))]
  const maxY      = Math.max(...data.map((r) => r.avgLatency), 1)
  const W = 560, H = 100, PL = 40, PR = 10, PT = 10, PB = 20
  const iW = W - PL - PR
  const iH = H - PT - PB

  function xOf(date: string) {
    const i = daysArr.indexOf(date)
    if (i < 0) return null
    return PL + (i / Math.max(daysArr.length - 1, 1)) * iW
  }
  function yOf(v: number) { return PT + (1 - v / maxY) * iH }

  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Avg latency trend</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {[0, 0.5, 1].map((frac) => {
          const y = PT + frac * iH
          const v = Math.round(maxY * (1 - frac))
          return (
            <g key={frac}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} strokeWidth={1} style={{ stroke: 'var(--border)' }} />
              <text x={PL - 4} y={y + 4} fill={S.dim} fontSize={8} textAnchor="end">{v}ms</text>
            </g>
          )
        })}
        {platforms.map((plat, pi) => {
          const pts    = data.filter((r) => r.platform === plat)
          const coords = pts
            .map((r) => { const x = xOf(r.date); return x !== null ? { x, y: yOf(r.avgLatency) } : null })
            .filter((p): p is { x: number; y: number } => p !== null)
          if (!coords.length) return null
          const color  = PLAT_COLORS[pi % PLAT_COLORS.length]
          const points = coords.map((c) => `${c.x},${c.y}`).join(' ')
          return (
            <g key={plat}>
              {coords.length > 1 && (
                <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" opacity={0.85} />
              )}
              {coords.map((c, i) => (
                <circle key={i} cx={c.x} cy={c.y} r={2.5} fill={color} opacity={0.9} />
              ))}
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 8 }}>
        {platforms.map((plat, pi) => (
          <span key={plat} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: S.dim }}>
            <span style={{ width: 10, height: 2, background: PLAT_COLORS[pi % PLAT_COLORS.length], display: 'inline-block', borderRadius: 1 }} />
            {anon && anonMap ? ap(plat, anonMap) : plat}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Top actions ──────────────────────────────────────────────────────────────

function TopActions({ data, anon, anonMap }: { data: ActionData[]; anon?: boolean; anonMap?: Map<string, string> }) {
  if (!data.length) return null
  const max = Math.max(...data.map((d) => d.total), 1)
  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Top actions</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 28px 44px 44px', gap: '0 8px', marginBottom: 8, padding: '0 0 6px 0', borderBottom: `1px solid ${S.border}` }}>
        <span style={{ color: S.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>Action</span>
        <span style={{ color: S.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>n</span>
        <span style={{ color: S.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>avg</span>
        <span style={{ color: S.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>p95</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map((d) => {
          const errRate   = d.total > 0 ? Math.round((d.errors / d.total) * 100) : 0
          const platLabel = anon && anonMap ? ap(d.platform, anonMap) : d.platform
          return (
            <div key={`${d.platform}:${d.action}`}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 28px 44px 44px', gap: '0 8px', alignItems: 'center' }}>
                <span style={{ color: S.muted, fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: S.green }}>{platLabel}</span>:{anon ? d.action : d.action}
                </span>
                <span style={{ color: S.muted, fontSize: 11, textAlign: 'right', fontFamily: 'monospace' }}>{d.total}</span>
                <span style={{ color: S.dim, fontSize: 10, textAlign: 'right', fontFamily: 'monospace' }}>{d.avgLatency}ms</span>
                <span style={{ color: S.dim, fontSize: 10, textAlign: 'right', fontFamily: 'monospace' }}>{d.p95Latency}ms</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 2 }}>
                  <div style={{ width: `${(d.total / max) * 100}%`, height: '100%', background: S.green, opacity: 0.6, borderRadius: 2 }} />
                </div>
                {d.errors > 0 && (
                  <span style={{ color: errorColor(d.errors, d.total), fontSize: 9, fontFamily: 'monospace', flexShrink: 0 }}>
                    {errRate}% err
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Platform breakdown ───────────────────────────────────────────────────────

function PlatformChart({ data, anon, anonMap }: { data: PlatData[]; anon?: boolean; anonMap?: Map<string, string> }) {
  if (!data.length) return null
  const total = data.reduce((s, d) => s + d.total, 0) || 1
  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>By platform</div>
      {data.map((d, i) => (
        <div key={d.platform} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: PLAT_COLORS[i % PLAT_COLORS.length], flexShrink: 0, display: 'inline-block' }} />
          <span style={{ color: S.muted, fontSize: 12, flex: 1, fontFamily: 'monospace' }}>
            {anon && anonMap ? ap(d.platform, anonMap) : d.platform}
          </span>
          <span style={{ color: PLAT_COLORS[i % PLAT_COLORS.length], fontSize: 12, fontFamily: 'monospace' }}>
            {Math.round((d.total / total) * 100)}%
          </span>
          <span style={{ color: S.dim, fontSize: 11 }}>{d.total}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Gateway breakdown ────────────────────────────────────────────────────────

function GatewayChart({ data, anon }: { data: GatewayData[]; anon?: boolean }) {
  if (!data.length) return null
  const total = data.reduce((s, d) => s + d.total, 0) || 1
  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>By gateway</div>
      {data.map((d, i) => (
        <div key={d.gateway_label + i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: PLAT_COLORS[i % PLAT_COLORS.length], flexShrink: 0, display: 'inline-block' }} />
          <span style={{ color: S.muted, fontSize: 12, flex: 1, fontFamily: 'monospace' }}>
            {anon ? (d.gateway_id ? `gateway-${i + 1}` : 'master') : d.gateway_label}
          </span>
          <span style={{ color: PLAT_COLORS[i % PLAT_COLORS.length], fontSize: 12, fontFamily: 'monospace' }}>
            {Math.round((d.total / total) * 100)}%
          </span>
          <span style={{ color: S.dim, fontSize: 11 }}>{d.total}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Recent calls ─────────────────────────────────────────────────────────────

const COL = '140px 110px 80px 1fr 48px 36px'

function gwLabel(c: CallRecord): string {
  return c.gateway_name ?? (c.gateway_id ? c.gateway_id : 'master')
}

function RecentCalls({ calls, anon, anonMap }: { calls: CallRecord[]; anon?: boolean; anonMap?: Map<string, string> }) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [search, setSearch]     = useState('')

  const q        = search.trim().toLowerCase()
  const filtered = q
    ? calls.filter((c) =>
        c.platform.toLowerCase().includes(q) ||
        c.action.toLowerCase().includes(q) ||
        gwLabel(c).toLowerCase().includes(q) ||
        c.args_json.toLowerCase().includes(q)
      )
    : calls.slice(0, 20)

  function dispPlatform(p: string) { return anon && anonMap ? ap(p, anonMap) : p }
  function dispArgs(j: string) { return anon ? '{ … }' : fmtArgs(j) }
  function dispGw(c: CallRecord) {
    if (anon) return c.gateway_id ? 'gateway' : 'master'
    return gwLabel(c)
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
          Recent calls{' '}
          <span style={{ color: S.dim2, textTransform: 'none' as const, letterSpacing: 0 }}>
            — {q ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : `${filtered.length} latest · click to expand`}
          </span>
        </div>
        <input
          type="text" placeholder="search calls…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ background: S.card, border: `1px solid ${q ? S.green : S.border}`, borderRadius: 4, color: q ? S.text : S.dim, fontSize: 11, padding: '4px 10px', fontFamily: 'monospace', outline: 'none', width: 180 }}
        />
      </div>
      {!calls.length ? (
        <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 24, textAlign: 'center', color: S.dim, fontSize: 13 }}>
          No calls yet. When Claude uses a tool through the gateway, it shows up here.
        </div>
      ) : !filtered.length ? (
        <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 24, textAlign: 'center', color: S.dim, fontSize: 13 }}>
          No calls match &quot;{search}&quot;.
        </div>
      ) : (
        <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: COL, padding: '8px 14px', borderBottom: `1px solid ${S.border}`, color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
            <span>Time</span><span>Platform · Action</span><span>Via</span><span>Args</span><span>Latency</span><span></span>
          </div>
          {filtered.map((c) => (
            <div key={c.id}>
              <div
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                style={{ display: 'grid', gridTemplateColumns: COL, padding: '9px 14px', borderBottom: `1px solid ${S.border}`, cursor: 'pointer', background: expanded === c.id ? S.card : 'transparent' }}
              >
                <span style={{ color: S.dim, fontSize: 11, fontFamily: 'monospace' }}>{fmtTime(c.timestamp)}</span>
                <span style={{ color: S.muted, fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: S.green }}>{dispPlatform(c.platform)}</span>:{c.action}
                </span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: c.gateway_name ? '#00bfff' : S.dim }}>
                  {dispGw(c)}
                </span>
                <span style={{ color: S.dim, fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {dispArgs(c.args_json)}
                </span>
                <span style={{ color: S.dim, fontSize: 11, textAlign: 'right', fontFamily: 'monospace' }}>{c.latency_ms}ms</span>
                <span style={{ textAlign: 'center', fontSize: 12 }}>
                  {c.outcome === 'success' ? <span style={{ color: S.green }}>✓</span> : <span style={{ color: S.red }}>✗</span>}
                </span>
              </div>
              {expanded === c.id && (
                <div style={{ padding: '10px 14px', background: S.bg, borderBottom: `1px solid ${S.border}` }}>
                  <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Args</div>
                  <pre style={{ color: S.muted, fontSize: 11, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {anon ? '{ … redacted … }' : JSON.stringify(JSON.parse(c.args_json || '{}'), null, 2)}
                  </pre>
                  {c.result_json && !anon && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Result</div>
                      <pre style={{ color: '#7ec87e', fontSize: 11, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflowY: 'auto' }}>
                        {c.result_json}
                      </pre>
                    </div>
                  )}
                  {c.result_json && anon && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Result</div>
                      <div style={{ color: S.dim, fontSize: 11 }}>[ redacted ]</div>
                    </div>
                  )}
                  {c.error && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Error</div>
                      <div style={{ color: S.red, fontSize: 11 }}>{anon ? '[error redacted]' : c.error}</div>
                    </div>
                  )}
                  {c.user_agent && !anon && (
                    <div style={{ marginTop: 8, color: S.dim, fontSize: 10 }}>
                      <span style={{ textTransform: 'uppercase', letterSpacing: 1 }}>UA</span>{' '}
                      <span style={{ fontFamily: 'monospace', color: S.dim }}>{c.user_agent}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ─── Sessions tab ─────────────────────────────────────────────────────────────

function SessionRow({ s, anon, anonMap }: { s: SessionSummary; anon?: boolean; anonMap?: Map<string, string> }) {
  const [open, setOpen]         = useState(false)
  const [calls, setCalls]       = useState<CallRecord[] | null>(null)
  const [loading, setLoading]   = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  async function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (calls) return
    setLoading(true)
    try {
      const res = await fetch(`/api/insights/sessions?session_id=${encodeURIComponent(s.session_id)}`)
      setCalls(await res.json())
    } finally { setLoading(false) }
  }

  const wallClock = s.ended_at - s.started_at
  const dur       = wallClock > 0 ? wallClock : s.total_latency_ms
  const durLabel  = wallClock > 0 ? fmtDuration(dur) : dur > 0 ? `~${fmtDuration(dur)}` : '—'
  const uaLabel   = parseUA(s.user_agent)

  function dispPlatformList(list: string) {
    if (!anon || !anonMap) return list
    return list.split(',').map((p) => ap(p.trim(), anonMap)).join(', ')
  }

  return (
    <div style={{ borderBottom: `1px solid ${S.border}` }}>
      <div
        onClick={toggle}
        style={{ display: 'grid', gridTemplateColumns: '140px 60px 50px 1fr 60px 28px', gap: '0 8px', padding: '9px 14px', cursor: 'pointer', background: open ? S.card : 'transparent', alignItems: 'center' }}
      >
        <span style={{ color: S.dim, fontSize: 11, fontFamily: 'monospace' }}>{fmtTime(s.started_at)}</span>
        <span style={{ color: wallClock > 0 ? S.muted : S.dim, fontSize: 11, fontFamily: 'monospace' }} title={wallClock > 0 ? 'wall-clock duration' : 'sum of call latencies (single-call session)'}>{durLabel}</span>
        <span style={{ color: S.dim, fontSize: 11, fontFamily: 'monospace', textAlign: 'right' }}>{s.calls}</span>
        <span style={{ color: S.dim, fontSize: 10, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dispPlatformList(s.platform_list ?? '').split(',').map((p, i) => (
            <span key={p} style={{ color: PLAT_COLORS[i % PLAT_COLORS.length], marginRight: 6 }}>{p.trim()}</span>
          ))}
        </span>
        <span style={{ color: S.dim, fontSize: 10, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={anon ? undefined : (s.user_agent || undefined)}>{anon ? parseUA(s.user_agent) : uaLabel}</span>
        <span style={{ textAlign: 'center', fontSize: 12 }}>
          {s.errors > 0 ? <span style={{ color: S.red }}>{s.errors}✗</span> : <span style={{ color: S.green }}>✓</span>}
        </span>
      </div>
      {open && (
        <div style={{ background: S.bg, padding: '8px 14px 12px' }}>
          {loading && <div style={{ color: S.dim, fontSize: 11 }}>Loading...</div>}
          {calls && calls.map((c) => {
            const offset = c.timestamp - s.started_at
            const platLabel = anon && anonMap ? ap(c.platform, anonMap) : c.platform
            return (
              <div key={c.id} style={{ marginBottom: 2 }}>
                <div
                  onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  style={{ display: 'grid', gridTemplateColumns: '52px 1fr 52px 18px', gap: '0 8px', padding: '5px 8px', cursor: 'pointer', borderRadius: 4, background: expandedId === c.id ? S.card : 'transparent' }}
                >
                  <span style={{ color: S.dim, fontSize: 10, fontFamily: 'monospace' }}>+{fmtDuration(offset)}</span>
                  <span style={{ color: S.muted, fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: PLAT_COLORS[s.platform_list?.split(',').indexOf(c.platform) % PLAT_COLORS.length] ?? S.green }}>{platLabel}</span>:{c.action}
                    {' '}<span style={{ color: S.dim2, fontSize: 10 }}>{anon ? '{ … }' : fmtArgs(c.args_json)}</span>
                  </span>
                  <span style={{ color: S.dim, fontSize: 10, textAlign: 'right', fontFamily: 'monospace' }}>{c.latency_ms}ms</span>
                  <span style={{ textAlign: 'center', fontSize: 11 }}>
                    {c.outcome === 'success' ? <span style={{ color: S.green }}>✓</span> : <span style={{ color: S.red }}>✗</span>}
                  </span>
                </div>
                {expandedId === c.id && (
                  <div style={{ padding: '6px 8px 8px', borderLeft: `2px solid ${S.border}`, marginLeft: 8, marginTop: 2 }}>
                    <div style={{ color: S.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>Args</div>
                    <pre style={{ color: S.muted, fontSize: 10, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {anon ? '{ … redacted … }' : JSON.stringify(JSON.parse(c.args_json || '{}'), null, 2)}
                    </pre>
                    {c.result_json && !anon && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ color: S.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>Result</div>
                        <pre style={{ color: '#7ec87e', fontSize: 10, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 240, overflowY: 'auto' }}>
                          {c.result_json}
                        </pre>
                      </div>
                    )}
                    {c.error && <div style={{ color: S.red, fontSize: 10, marginTop: 4 }}>{anon ? '[error redacted]' : c.error}</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SessionsTab({ days, anon, anonMap }: { days: number; anon?: boolean; anonMap?: Map<string, string> }) {
  const [sessions, setSessions]   = useState<SessionSummary[] | null>(null)
  const [loading, setLoading]     = useState(true)
  const [cooccur, setCooccur]     = useState<CoOccur[]>([])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/insights/sessions?days=${days}`).then(r => r.json()),
      fetch(`/api/insights?days=${days}`).then(r => r.json()),
    ]).then(([sess, ins]) => {
      setSessions(sess)
      setCooccur((ins as InsightsData).cooccurrence ?? [])
    }).finally(() => setLoading(false))
  }, [days])

  if (loading) return <div style={{ color: S.dim, textAlign: 'center', paddingTop: 40 }}>Loading...</div>

  function dispTool(t: string) {
    if (!anon || !anonMap) return t
    const [plat, ...rest] = t.split(':')
    return `${ap(plat, anonMap)}:${rest.join(':')}`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {cooccur.length > 0 && (
        <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
          <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Tool pairs (co-occur in same session)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 48px', gap: '0 12px', borderBottom: `1px solid ${S.border}`, paddingBottom: 6, marginBottom: 8 }}>
            <span style={{ color: S.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>Tool A</span>
            <span style={{ color: S.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>Tool B</span>
            <span style={{ color: S.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>Sessions</span>
          </div>
          {cooccur.map((r) => (
            <div key={`${r.tool_a}${r.tool_b}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 48px', gap: '0 12px', padding: '4px 0' }}>
              <span style={{ color: S.muted, fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dispTool(r.tool_a)}</span>
              <span style={{ color: S.muted, fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dispTool(r.tool_b)}</span>
              <span style={{ color: S.green, fontSize: 11, fontFamily: 'monospace', textAlign: 'right' }}>{r.sessions}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 60px 50px 1fr 60px 28px', gap: '0 8px', padding: '8px 14px', borderBottom: `1px solid ${S.border}`, color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
          <span>Started</span><span>Duration</span><span style={{ textAlign: 'right' }}>Calls</span><span>Platforms</span><span>Client</span><span></span>
        </div>
        {!sessions?.length ? (
          <div style={{ padding: 24, textAlign: 'center', color: S.dim, fontSize: 13 }}>No sessions with IDs found. Session IDs require an MCP-aware client.</div>
        ) : (
          sessions.map((s) => <SessionRow key={s.session_id} s={s} anon={anon} anonMap={anonMap} />)
        )}
      </div>
    </div>
  )
}

// ─── Errors tab ───────────────────────────────────────────────────────────────

function normalizeError(msg: string): string {
  return msg
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '{ip}')
    .replace(/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi, '{ipv6}')
    .replace(/:[0-9]{2,5}\b/g, ':{port}')
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, '{uuid}')
    .replace(/\b\d+\s*ms\b/g, '{n}ms')
    .replace(/\b0x[0-9a-f]+\b/gi, '{hex}')
    .replace(/\b\d{6,}\b/g, '{n}')
    .replace(/\s+/g, ' ')
    .trim()
}

interface GroupedError { key: string; total: number; lastSeen: number; items: ErrPattern[] }

function groupErrors(data: ErrPattern[]): GroupedError[] {
  const map = new Map<string, GroupedError>()
  for (const d of data) {
    const key = normalizeError(d.error)
    const existing = map.get(key)
    if (existing) {
      existing.total   += d.total
      existing.lastSeen = Math.max(existing.lastSeen, d.last_seen)
      existing.items.push(d)
    } else {
      map.set(key, { key, total: d.total, lastSeen: d.last_seen, items: [d] })
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

function ErrorsTab({ data, anon, anonMap }: { data: ErrPattern[]; anon?: boolean; anonMap?: Map<string, string> }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (!data.length) return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 32, textAlign: 'center', color: S.dim, fontSize: 13 }}>
      No errors recorded. Something is either working perfectly or Claude gave up.
    </div>
  )

  const groups = groupErrors(data)
  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {groups.map((g) => {
        const open   = expanded.has(g.key)
        const merged = g.items.length === 1
        const platforms = [...new Set(g.items.map((i) => i.platform))]
        return (
          <div key={g.key} style={{ background: S.card, border: `1px solid #2a1414`, borderRadius: 8, overflow: 'hidden' }}>
            <div
              onClick={() => !merged && toggle(g.key)}
              style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '10px 14px', cursor: merged ? 'default' : 'pointer', alignItems: 'start' }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ background: '#2a0a0a', border: `1px solid #440000`, borderRadius: 3, color: S.red, fontSize: 11, padding: '1px 6px', fontFamily: 'monospace' }}>{g.total}×</span>
                  {platforms.map((p) => (
                    <span key={p} style={{ color: S.green, fontSize: 10, fontFamily: 'monospace' }}>
                      {anon && anonMap ? ap(p, anonMap) : p}
                    </span>
                  ))}
                  <span style={{ color: S.dim, fontSize: 10 }}>{fmtTime(g.lastSeen)}</span>
                  {!merged && <span style={{ color: S.dim2, fontSize: 10, marginLeft: 'auto' }}>{open ? '▼' : '▶'} {g.items.length} variant{g.items.length !== 1 ? 's' : ''}</span>}
                </div>
                <div style={{ color: '#cc4444', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-word', lineHeight: 1.5 }}>{g.key}</div>
              </div>
            </div>
            {open && (
              <div style={{ borderTop: `1px solid ${S.border}` }}>
                {g.items.map((item, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '150px 120px 1fr 36px', gap: '0 8px', padding: '7px 14px', borderTop: i > 0 ? `1px solid ${S.border}` : undefined, alignItems: 'start', background: S.bg, fontSize: 11 }}>
                    <span style={{ color: S.green, fontFamily: 'monospace' }}>
                      {anon && anonMap ? ap(item.platform, anonMap) : item.platform}
                    </span>
                    <span style={{ color: S.muted, fontFamily: 'monospace' }}>{item.action}</span>
                    <span style={{ color: '#884444', fontFamily: 'monospace', wordBreak: 'break-word' }}>{anon ? '[error redacted]' : item.error}</span>
                    <span style={{ color: S.dim, fontFamily: 'monospace', textAlign: 'right' }}>{item.total}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Heatmap tab ─────────────────────────────────────────────────────────────

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function HeatmapTab({ data }: { data: HeatCell[] }) {
  const map = new Map<string, number>()
  for (const r of data) map.set(`${r.dow}:${r.hour}`, r.total)
  const maxVal = Math.max(...data.map((r) => r.total), 1)

  function cellColor(v: number): string {
    if (!v) return 'var(--bg)'
    const intensity = v / maxVal
    const g = Math.round(255 * intensity)
    const r = Math.round(57 * intensity)
    return `rgb(${r}, ${g}, 20)`
  }

  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Calls by hour (UTC) × day of week</div>
      <div style={{ color: S.dim2, fontSize: 10, marginBottom: 16 }}>darker = more calls</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 20 }}>
          {DOW.map((d) => (
            <div key={d} style={{ height: 20, color: S.dim, fontSize: 10, display: 'flex', alignItems: 'center', width: 28, flexShrink: 0 }}>{d}</div>
          ))}
        </div>
        <div style={{ flex: 1, overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 3, marginBottom: 3 }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ flex: 1, minWidth: 18, color: S.dim, fontSize: 9, textAlign: 'center' }}>{h === 0 || h % 6 === 0 ? `${h}h` : ''}</div>
            ))}
          </div>
          {DOW.map((_, dow) => (
            <div key={dow} style={{ display: 'flex', gap: 3, marginBottom: 3 }}>
              {Array.from({ length: 24 }, (_, hour) => {
                const v = map.get(`${dow}:${hour}`) ?? 0
                return (
                  <div
                    key={hour}
                    title={`${DOW[dow]} ${hour}:00 — ${v} call${v !== 1 ? 's' : ''}`}
                    style={{ flex: 1, minWidth: 18, height: 20, borderRadius: 2, background: cellColor(v) }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Callers tab ──────────────────────────────────────────────────────────────

function CallersTab({ perUA, perPlatform, recentCalls, anon, anonMap }: { perUA: UAData[]; perPlatform: PlatData[]; recentCalls: CallRecord[]; anon?: boolean; anonMap?: Map<string, string> }) {
  const totalCalls = perUA.reduce((s, u) => s + u.total, 0) || 1

  const matrix = new Map<string, Map<string, number>>()
  for (const c of recentCalls) {
    const ua = parseUA(c.user_agent)
    if (!matrix.has(ua)) matrix.set(ua, new Map())
    const pm = matrix.get(ua)!
    pm.set(c.platform, (pm.get(c.platform) ?? 0) + 1)
  }
  const uas  = [...new Set(perUA.map((u) => parseUA(u.ua)))]
  const plats = perPlatform.slice(0, 8).map((p) => p.platform)

  function dispPlat(p: string) { return anon && anonMap ? ap(p, anonMap) : p }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
        <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Callers</div>
        {!perUA.length ? (
          <div style={{ color: S.dim, fontSize: 12 }}>No UA data yet — make some tool calls first.</div>
        ) : perUA.map((u, i) => {
          const label = parseUA(u.ua)
          return (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: S.muted, fontSize: 12, fontFamily: 'monospace' }}>{label}</span>
                <span style={{ color: S.dim, fontSize: 11 }}>{u.total} calls · {Math.round((u.total / totalCalls) * 100)}%</span>
              </div>
              <div style={{ height: 4, background: 'var(--border)', borderRadius: 2 }}>
                <div style={{ width: `${(u.total / totalCalls) * 100}%`, height: '100%', background: PLAT_COLORS[i % PLAT_COLORS.length], borderRadius: 2, opacity: 0.8 }} />
              </div>
              {u.errors > 0 && (
                <div style={{ color: S.red, fontSize: 10, marginTop: 2 }}>{u.errors} errors ({Math.round((u.errors / u.total) * 100)}%)</div>
              )}
              {!anon && label !== u.ua && (
                <div style={{ color: S.dim2, fontSize: 9, fontFamily: 'monospace', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.ua}</div>
              )}
            </div>
          )
        })}
      </div>

      {uas.length > 0 && plats.length > 0 && (
        <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16, overflowX: 'auto' }}>
          <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Caller × platform matrix</div>
          <table style={{ borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 10, width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', color: S.dim, fontWeight: 'normal', padding: '4px 10px 4px 0', borderBottom: `1px solid ${S.border}` }}>UA</th>
                {plats.map((p) => (
                  <th key={p} style={{ textAlign: 'right', color: S.green, fontWeight: 'normal', padding: '4px 6px', borderBottom: `1px solid ${S.border}`, whiteSpace: 'nowrap' }}>{dispPlat(p)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uas.map((ua) => (
                <tr key={ua}>
                  <td style={{ color: S.muted, padding: '5px 10px 5px 0', whiteSpace: 'nowrap' }}>{ua}</td>
                  {plats.map((p) => {
                    const v = matrix.get(ua)?.get(p) ?? 0
                    return (
                      <td key={p} style={{ textAlign: 'right', padding: '5px 6px', color: v ? S.text : S.dim2 }}>{v || '·'}</td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Token burn tab ───────────────────────────────────────────────────────────

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function TokenBurnTab({ data, anon, anonMap }: { data: TokenBurn; anon?: boolean; anonMap?: Map<string, string> }) {
  const total    = data.totalInputTokens + data.totalOutputTokens
  const maxTotal = Math.max(...data.perAction.map((a) => a.inputTokens + a.outputTokens), 1)

  function dispPlatform(p: string) { return anon && anonMap ? ap(p, anonMap) : p }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <Stat label="Total tokens"  value={fmtTok(total)}                      sub="~char÷4 estimate" />
        <Stat label="Input tokens"  value={fmtTok(data.totalInputTokens)}  sub="from args" />
        <Stat label="Output tokens" value={fmtTok(data.totalOutputTokens)} sub="from results" />
      </div>
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
        <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Top actions by token cost</div>
        {!data.perAction.length ? (
          <div style={{ color: S.dim, fontSize: 12 }}>No data yet.</div>
        ) : data.perAction.map((a, i) => {
          const rowTotal  = a.inputTokens + a.outputTokens
          const inputFrac = rowTotal > 0 ? a.inputTokens / rowTotal : 0
          const barW      = (rowTotal / maxTotal) * 100
          const perCall   = a.calls > 0 ? Math.round(rowTotal / a.calls) : 0
          return (
            <div key={i} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: S.green, fontSize: 11, fontFamily: 'monospace' }}>
                  {dispPlatform(a.platform)}<span style={{ color: S.dim }}>:</span>{a.action}
                </span>
                <span style={{ color: S.muted, fontSize: 11 }}>
                  {fmtTok(rowTotal)} tok · {a.calls} calls · {fmtTok(perCall)}/call
                </span>
              </div>
              <div style={{ height: 10, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${barW}%`, height: '100%', display: 'flex' }}>
                  <div style={{ width: `${inputFrac * 100}%`, background: '#00bfff', opacity: 0.7 }} />
                  <div style={{ flex: 1, background: S.green, opacity: 0.7 }} />
                </div>
              </div>
            </div>
          )
        })}
        <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: S.dim }}>
            <span style={{ width: 8, height: 8, background: '#00bfff', opacity: 0.7, borderRadius: 1, display: 'inline-block' }} /> input (args)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: S.dim }}>
            <span style={{ width: 8, height: 8, background: S.green, opacity: 0.7, borderRadius: 1, display: 'inline-block' }} /> output (results)
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Schema token tab ─────────────────────────────────────────────────────────

const CONTEXT_WINDOWS = [
  { label: 'GPT-4o',    tokens: 128_000 },
  { label: 'Claude',    tokens: 200_000 },
  { label: 'Gemini',    tokens: 1_000_000 },
]

function SchemaTab({ trend, latest, anon, anonMap }: { trend: SchemaTokenEntry[]; latest: SchemaTokenEntry | null; anon?: boolean; anonMap?: Map<string, string> }) {
  const [expandedInst, setExpandedInst] = useState<string | null>(null)

  const breakdown: Record<string, number> = latest ? (() => {
    try { return JSON.parse(latest.breakdownJson) as Record<string, number> } catch { return {} }
  })() : {}

  const total      = latest?.totalTokens ?? 0
  const instances  = Object.entries(breakdown).sort((a, b) => b[1] - a[1])
  const maxInstTok = instances.length ? instances[0][1] : 1

  const trendDays = new Map<string, number>()
  for (const e of trend) {
    const day = new Date(e.timestamp).toISOString().slice(0, 10)
    if (!trendDays.has(day)) trendDays.set(day, e.totalTokens)
  }
  const trendArr = [...trendDays.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const maxTrend = trendArr.length ? Math.max(...trendArr.map((d) => d[1]), 1) : 1

  function barColor(pct: number): string {
    if (pct >= 0.5) return S.red
    if (pct >= 0.2) return S.yellow
    return S.green
  }

  if (!latest) {
    return (
      <div style={{ color: S.dim, fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
        No schema data yet — make a tools/list call first.<br />
        <span style={{ fontSize: 11 }}>Connect Claude Code and run any tool to populate this.</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: '24px 28px' }}>
        <div style={{ color: S.green, fontSize: 42, fontWeight: 'bold', fontFamily: 'monospace', lineHeight: 1 }}>{fmtTok(total)}</div>
        <div style={{ color: S.muted, fontSize: 13, marginTop: 6 }}>tokens consumed by tool schema per turn</div>
        <div style={{ color: S.dim, fontSize: 11, marginTop: 3 }}>charged before your conversation even starts</div>
      </div>

      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
        <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Context window impact</div>
        {CONTEXT_WINDOWS.map((cw) => {
          const pct = total / cw.tokens
          return (
            <div key={cw.label} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: S.muted, fontSize: 12, fontFamily: 'monospace', width: 80 }}>{cw.label}</span>
                <span style={{ color: S.dim, fontSize: 11 }}>{(cw.tokens / 1000).toFixed(0)}K</span>
                <div style={{ flex: 1, height: 12, background: 'var(--border)', borderRadius: 2, margin: '0 12px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(pct * 100, 100)}%`, height: '100%', background: barColor(pct), borderRadius: 2, opacity: 0.8 }} />
                </div>
                <span style={{ color: barColor(pct), fontSize: 11, fontFamily: 'monospace', width: 40, textAlign: 'right' }}>{Math.round(pct * 100)}%</span>
              </div>
            </div>
          )
        })}
      </div>

      {instances.length > 0 && (
        <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
          <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Per-instance breakdown</div>
          {instances.map(([name, tokens]) => {
            const pct    = tokens / total
            const barPct = tokens / maxInstTok
            const expanded = expandedInst === name
            const dispName = anon && anonMap ? ap(name, anonMap) : name
            return (
              <div key={name} style={{ marginBottom: 10 }}>
                <div
                  onClick={() => setExpandedInst(expanded ? null : name)}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}
                >
                  <span style={{ color: S.green, fontSize: 12, fontFamily: 'monospace', width: 140, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dispName}</span>
                  <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${barPct * 100}%`, height: '100%', background: barColor(pct), borderRadius: 2, opacity: 0.8 }} />
                  </div>
                  <span style={{ color: S.muted, fontSize: 11, fontFamily: 'monospace', width: 80, textAlign: 'right', flexShrink: 0 }}>
                    {fmtTok(tokens)} ({Math.round(pct * 100)}%)
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {trendArr.length > 1 && (
        <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
          <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Schema size trend</div>
          <svg viewBox={`0 0 ${trendArr.length * 30} 60`} style={{ width: '100%', height: 60, display: 'block' }}>
            {trendArr.map(([day, v], i) => {
              const x = i * 30 + 15
              const h = Math.max((v / maxTrend) * 50, 2)
              const y = 55 - h
              return (
                <g key={day}>
                  <rect x={x - 8} y={y} width={16} height={h} fill={S.green} opacity={0.6} rx={1} />
                  {trendArr.length <= 14 && <text x={x} y={58} fontSize={7} fill={S.dim} textAnchor="middle">{day.slice(5)}</text>}
                </g>
              )
            })}
          </svg>
        </div>
      )}
    </div>
  )
}

// ─── Tab nav ──────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'sessions' | 'errors' | 'heatmap' | 'callers' | 'tokens' | 'schema'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'errors',   label: 'Errors' },
  { id: 'heatmap',  label: 'Heatmap' },
  { id: 'callers',  label: 'Callers' },
  { id: 'tokens',   label: 'Tokens' },
  { id: 'schema',   label: 'Schema' },
]

// ─── Main ─────────────────────────────────────────────────────────────────────

// ─── Demo data ──────────────────────────────────────────────────────────────
// Invented, fully-populated insights shown when demo mode is on, so every chart
// looks "in use" for screenshots. No network, no DB — purely presentational.

const DEMO_PLATS = [
  { id: 'proxmox-prod',   name: 'Production Cluster' },
  { id: 'portainer-home', name: 'Home Lab Docker' },
  { id: 'wikijs-kb',      name: 'Knowledge Base' },
  { id: 'firefly-fin',    name: 'Finances' },
  { id: 'proxmox-backup', name: 'Backup Node' },
]

function demoInsights(days: number): InsightsData {
  const daysArr = getLastNDays(days)
  const now = Date.now()
  const pattern = [142, 98, 167, 203, 178, 89, 134, 156, 187, 145, 199, 121, 165, 178, 156, 143, 188, 97, 176, 211, 165, 88, 145, 167, 198, 134, 176, 145, 167, 189]
  const callsPerDay: DayData[] = daysArr.map((date, i) => {
    const total = pattern[i % pattern.length]
    return { date, total, errors: Math.max(1, Math.round(total * 0.038)) }
  })
  const total  = callsPerDay.reduce((a, d) => a + d.total, 0)
  const errors = callsPerDay.reduce((a, d) => a + d.errors, 0)

  const weights = [0.34, 0.27, 0.18, 0.14, 0.07]
  const perPlatform: PlatData[] = DEMO_PLATS.map((p, i) => ({
    platform: p.id, total: Math.round(total * weights[i]), errors: Math.round(errors * weights[i]),
  }))

  const perGateway: GatewayData[] = [
    { gateway_label: 'claude-code',    gateway_id: 'gw_code',    total: Math.round(total * 0.7), errors: Math.round(errors * 0.6) },
    { gateway_label: 'claude-desktop', gateway_id: 'gw_desktop', total: Math.round(total * 0.3), errors: Math.round(errors * 0.4) },
  ]

  const topActions: ActionData[] = [
    { platform: 'proxmox-prod',   action: 'list_vms',          total: 487, errors: 3, avgLatency: 64,  p95Latency: 142 },
    { platform: 'portainer-home', action: 'list_containers',   total: 421, errors: 7, avgLatency: 91,  p95Latency: 230 },
    { platform: 'wikijs-kb',      action: 'search_pages',      total: 312, errors: 2, avgLatency: 58,  p95Latency: 134 },
    { platform: 'proxmox-prod',   action: 'vm_status',         total: 268, errors: 1, avgLatency: 47,  p95Latency: 98  },
    { platform: 'firefly-fin',    action: 'list_transactions', total: 196, errors: 4, avgLatency: 73,  p95Latency: 168 },
    { platform: 'portainer-home', action: 'container_logs',    total: 174, errors: 9, avgLatency: 128, p95Latency: 410 },
    { platform: 'wikijs-kb',      action: 'get_page',          total: 142, errors: 0, avgLatency: 39,  p95Latency: 81  },
    { platform: 'proxmox-prod',   action: 'start_vm',          total: 88,  errors: 2, avgLatency: 212, p95Latency: 540 },
  ]

  let idc = 9000
  const rc = (platform: string, action: string, args: Record<string, unknown>, latency: number, minAgo: number, error: string | null = null): CallRecord => ({
    id: idc++, timestamp: now - minAgo * 60_000, platform, action,
    args_json: JSON.stringify(args), outcome: error ? 'error' : 'success', latency_ms: latency, error,
    gateway_id: null, gateway_name: null, user_agent: 'claude-code/2.1.0', result_json: null,
  })
  const recentCalls: CallRecord[] = [
    rc('proxmox-prod',   'list_vms',           { node: 'pve-01' }, 58, 2),
    rc('portainer-home', 'restart_container',  { id: 'a3f9', name: 'jellyfin' }, 412, 7),
    rc('wikijs-kb',      'search_pages',       { query: 'nginx reverse proxy' }, 44, 13),
    rc('firefly-fin',    'list_transactions',  { account: 'checking', limit: 25 }, 81, 19),
    rc('portainer-home', 'container_logs',     { name: 'paperless', tail: 200 }, 134, 26, 'container not found'),
    rc('proxmox-prod',   'vm_status',          { node: 'pve-02', vmid: 104 }, 39, 33),
    rc('wikijs-kb',      'get_page',           { id: 217 }, 36, 41),
    rc('proxmox-prod',   'start_vm',           { node: 'pve-01', vmid: 112 }, 248, 52),
    rc('firefly-fin',    'account_balance',    { account: 'savings' }, 67, 60),
    rc('portainer-home', 'list_stacks',        {}, 95, 74),
    rc('proxmox-backup', 'list_backups',       { datastore: 'main' }, 156, 88),
    rc('wikijs-kb',      'search_pages',       { query: 'proxmox gpu passthrough' }, 51, 103),
    rc('proxmox-prod',   'cluster_resources',  {}, 72, 121),
    rc('firefly-fin',    'search_transactions',{ query: 'amazon', range: '30d' }, 119, 140),
  ]

  const trendPlats = ['proxmox-prod', 'portainer-home', 'wikijs-kb']
  const trendBase: Record<string, number> = { 'proxmox-prod': 55, 'portainer-home': 95, 'wikijs-kb': 48 }
  const latencyTrend: LatTrend[] = []
  daysArr.forEach((date, i) => {
    trendPlats.forEach((p) => {
      const wobble = ((i * 7 + p.length * 3) % 11) - 5
      latencyTrend.push({ date, platform: p, avgLatency: trendBase[p] + wobble * 4 })
    })
  })

  const heatmap: HeatCell[] = []
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const work    = hour >= 8 && hour <= 20 ? 1 : 0.2
      const weekday = dow >= 1 && dow <= 5 ? 1 : 0.5
      const peak    = hour >= 9 && hour <= 12 ? 1.4 : hour >= 14 && hour <= 18 ? 1.2 : 1
      const v = Math.round(18 * work * weekday * peak + ((hour * 3 + dow * 5) % 7))
      if (v > 0) heatmap.push({ hour, dow, total: v })
    }
  }

  const perUA: UAData[] = [
    { ua: 'claude-code/2.1.0',    total: Math.round(total * 0.62), errors: Math.round(errors * 0.5) },
    { ua: 'claude-desktop/1.4.2', total: Math.round(total * 0.28), errors: Math.round(errors * 0.3) },
    { ua: 'cursor-mcp/0.9.1',     total: Math.round(total * 0.10), errors: Math.round(errors * 0.2) },
  ]

  const errorPatterns: ErrPattern[] = [
    { platform: 'portainer-home', action: 'container_logs',    error: 'container not found',            total: 14, last_seen: now - 26 * 60_000 },
    { platform: 'proxmox-prod',   action: 'start_vm',          error: 'VM is locked (backup running)',  total: 6,  last_seen: now - 3 * 3_600_000 },
    { platform: 'firefly-fin',    action: 'list_transactions', error: '401 unauthorized — token expired', total: 4, last_seen: now - 9 * 3_600_000 },
  ]

  const cooccurrence: CoOccur[] = [
    { tool_a: 'list_vms',        tool_b: 'vm_status',       sessions: 38 },
    { tool_a: 'list_containers', tool_b: 'container_logs',  sessions: 31 },
    { tool_a: 'search_pages',    tool_b: 'get_page',        sessions: 27 },
    { tool_a: 'list_vms',        tool_b: 'start_vm',        sessions: 14 },
  ]

  const perAction: TokenBurnAction[] = topActions.slice(0, 6).map((a) => ({
    platform: a.platform, action: a.action, inputTokens: a.total * 180, outputTokens: a.total * 420, calls: a.total,
  }))
  const tokenBurn: TokenBurn = {
    totalInputTokens:  perAction.reduce((s, a) => s + a.inputTokens, 0),
    totalOutputTokens: perAction.reduce((s, a) => s + a.outputTokens, 0),
    perAction,
  }

  const breakdownJson = JSON.stringify(DEMO_PLATS.map((p) => ({ instanceId: p.id, tokens: 600 + p.id.length * 40 })))
  const schemaTrend: SchemaTokenEntry[] = daysArr.filter((_, i) => i % 2 === 0).map((d) => ({
    timestamp: new Date(d + 'T12:00:00').getTime(), gatewayId: null, totalTokens: 3800 + (d.charCodeAt(8) % 9) * 60, breakdownJson,
  }))
  const latestSchema: SchemaTokenEntry = { timestamp: now - 3_600_000, gatewayId: null, totalTokens: 4120, breakdownJson }

  return {
    summary: { total, successes: total - errors, avgLatency: 78, retryRate: 6 },
    callsPerDay, perPlatform, perGateway, topActions, recentCalls, perUA, heatmap,
    errorPatterns, latencyTrend, cooccurrence, tokenBurn, schemaTrend, latestSchema,
    allPlatforms: DEMO_PLATS.map((p) => ({ instanceId: p.id, name: p.name })),
  }
}

export default function InsightsClient() {
  const [data, setData]         = useState<InsightsData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [days, setDays]         = useState(7)
  const [platform, setPlatform] = useState('')
  const [tab, setTab]           = useState<Tab>('overview')
  const daysArr                 = getLastNDays(days)
  const anon                    = useAnon()
  const demo                    = useDemo()
  const reqId                   = useRef(0)

  const anonMap = useMemo(() => {
    if (!data) return new Map<string, string>()
    const ids = [
      ...(data.allPlatforms ?? []).map((p) => p.instanceId),
      ...data.perPlatform.map((p) => p.platform),
    ]
    return buildAnonMap(ids)
  }, [data])

  const load = useCallback(async () => {
    const id = ++reqId.current
    if (demo) {
      setData(demoInsights(days))
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const url  = `/api/insights?days=${days}${platform ? `&platform=${encodeURIComponent(platform)}` : ''}`
      const next = await fetch(url).then((r) => r.json())
      if (id !== reqId.current) return   // a newer load (e.g. demo toggled) superseded this one
      setData(next)
    } finally { if (id === reqId.current) setLoading(false) }
  }, [days, platform, demo])

  useEffect(() => { load() }, [load])

  const successRate = data
    ? data.summary.total > 0 ? Math.round((data.summary.successes / data.summary.total) * 100) : 100
    : 0

  return (
    <div style={{ minHeight: '100vh', padding: '32px 24px', maxWidth: 900, margin: '0 auto', fontFamily: 'monospace' }}>
      <Nav active="Insights" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ color: S.text, fontSize: 18, fontWeight: 'bold' }}>Insights</div>
          <div style={{ color: S.dim, fontSize: 12, marginTop: 2 }}>What your AI agents actually did with your MCPs</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {data && (data.allPlatforms ?? []).length > 1 && (
            <select
              value={platform} onChange={(e) => setPlatform(e.target.value)}
              style={{ background: S.card, border: `1px solid ${platform ? S.green : S.border}`, borderRadius: 4, color: platform ? S.green : S.dim, fontSize: 11, padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', outline: 'none' }}
            >
              <option value="">all MCPs</option>
              {(data.allPlatforms ?? data.perPlatform.map((p) => ({ instanceId: p.platform, name: p.platform }))).map((p) => {
                const hasData = data.perPlatform.some((pp) => pp.platform === p.instanceId)
                const label   = anon ? ap(p.instanceId, anonMap) : p.name
                return (
                  <option key={p.instanceId} value={p.instanceId}>
                    {label}{!hasData ? ' (no data)' : ''}
                  </option>
                )
              })}
            </select>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            {[7, 14, 30].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                style={{ background: days === d ? S.green : 'none', color: days === d ? '#000' : S.dim, border: `1px solid ${days === d ? S.green : S.border}`, borderRadius: 4, fontSize: 11, padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace' }}
              >{d}d</button>
            ))}
            <button onClick={load} disabled={loading}
              style={{ background: 'none', border: `1px solid ${S.border}`, borderRadius: 4, color: S.dim, fontSize: 11, padding: '4px 10px', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'monospace', marginLeft: 8 }}
            >{loading ? '...' : '↺'}</button>
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: `1px solid ${S.border}` }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ background: 'none', border: 'none', borderBottom: `2px solid ${tab === t.id ? S.green : 'transparent'}`, color: tab === t.id ? S.green : S.dim, fontSize: 12, padding: '6px 14px', cursor: 'pointer', fontFamily: 'monospace', marginBottom: -1 }}
          >{t.label}</button>
        ))}
      </div>

      {loading && !data ? (
        <div style={{ color: S.dim, textAlign: 'center', paddingTop: 80 }}>Loading...</div>
      ) : data ? (
        <>
          {tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <Stat label="Total calls"  value={String(data.summary.total)} sub={`last ${days} days`} />
                <Stat label="Success rate" value={`${successRate}%`} sub={`${data.summary.total - data.summary.successes} errors`} />
                <Stat label="Avg latency"  value={`${Math.round(data.summary.avgLatency)}ms`} />
                <Stat label="Retry rate"   value={`${data.summary.retryRate}%`} sub="calls after a prior error" />
              </div>
              <DayChart data={data.callsPerDay} daysArr={daysArr} />
              {data.latencyTrend.length > 0 && (
                <LatencyTrend data={data.latencyTrend} daysArr={daysArr} anon={anon} anonMap={anonMap} />
              )}
              {(() => {
                const showGw = (data.perGateway ?? []).length > 1
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: showGw ? '1fr 1fr 2fr' : '1fr 2fr', gap: 16 }}>
                    <PlatformChart data={data.perPlatform} anon={anon} anonMap={anonMap} />
                    {showGw && <GatewayChart data={data.perGateway} anon={anon} />}
                    <TopActions    data={data.topActions}  anon={anon} anonMap={anonMap} />
                  </div>
                )
              })()}
              <RecentCalls calls={data.recentCalls} anon={anon} anonMap={anonMap} />
            </div>
          )}
          {tab === 'sessions' && <SessionsTab days={days} anon={anon} anonMap={anonMap} />}
          {tab === 'errors'   && <ErrorsTab   data={data.errorPatterns} anon={anon} anonMap={anonMap} />}
          {tab === 'heatmap'  && <HeatmapTab  data={data.heatmap} />}
          {tab === 'callers'  && <CallersTab  perUA={data.perUA} perPlatform={data.perPlatform} recentCalls={data.recentCalls} anon={anon} anonMap={anonMap} />}
          {tab === 'tokens'   && <TokenBurnTab data={data.tokenBurn} anon={anon} anonMap={anonMap} />}
          {tab === 'schema'   && <SchemaTab trend={data.schemaTrend ?? []} latest={data.latestSchema ?? null} anon={anon} anonMap={anonMap} />}
        </>
      ) : null}

      <Footer motto="your calls, your problem" />
    </div>
  )
}
