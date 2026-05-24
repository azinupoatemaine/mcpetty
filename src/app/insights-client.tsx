'use client'

import { useEffect, useState, useCallback } from 'react'
import { Nav, Footer } from './nav'

const S = {
  bg: 'var(--bg)', card: 'var(--card)', border: 'var(--border)', text: 'var(--text)',
  muted: 'var(--muted)', dim: 'var(--dim)', green: 'var(--green)', red: 'var(--red)', yellow: 'var(--yellow)',
}

const PLAT_COLORS = [S.green, '#00bfff', S.yellow, '#ff69b4', '#a855f7', '#f97316', '#06b6d4']

interface Summary    { total: number; successes: number; avgLatency: number; retryRate: number }
interface DayData    { date: string; total: number; errors: number }
interface PlatData   { platform: string; total: number; errors: number }
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

interface InsightsData {
  summary:       Summary
  callsPerDay:   DayData[]
  perPlatform:   PlatData[]
  topActions:    ActionData[]
  recentCalls:   CallRecord[]
  perUA:         UAData[]
  heatmap:       HeatCell[]
  errorPatterns: ErrPattern[]
  latencyTrend:  LatTrend[]
  cooccurrence:  CoOccur[]
  tokenBurn:     TokenBurn
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

function LatencyTrend({ data, daysArr }: { data: LatTrend[]; daysArr: string[] }) {
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
          const pts = data.filter((r) => r.platform === plat)
          const points = pts
            .map((r) => { const x = xOf(r.date); return x !== null ? `${x},${yOf(r.avgLatency)}` : null })
            .filter(Boolean)
            .join(' ')
          if (!points) return null
          const color = PLAT_COLORS[pi % PLAT_COLORS.length]
          return <polyline key={plat} points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" opacity={0.85} />
        })}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 8 }}>
        {platforms.map((plat, pi) => (
          <span key={plat} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: S.dim }}>
            <span style={{ width: 10, height: 2, background: PLAT_COLORS[pi % PLAT_COLORS.length], display: 'inline-block', borderRadius: 1 }} />
            {plat}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Top actions ──────────────────────────────────────────────────────────────

function TopActions({ data }: { data: ActionData[] }) {
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
          const errRate = d.total > 0 ? Math.round((d.errors / d.total) * 100) : 0
          return (
            <div key={`${d.platform}:${d.action}`}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 28px 44px 44px', gap: '0 8px', alignItems: 'center' }}>
                <span style={{ color: S.muted, fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: S.green }}>{d.platform}</span>:{d.action}
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

function PlatformChart({ data }: { data: PlatData[] }) {
  if (!data.length) return null
  const total = data.reduce((s, d) => s + d.total, 0) || 1
  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>By platform</div>
      {data.map((d, i) => (
        <div key={d.platform} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: PLAT_COLORS[i % PLAT_COLORS.length], flexShrink: 0, display: 'inline-block' }} />
          <span style={{ color: S.muted, fontSize: 12, flex: 1, fontFamily: 'monospace' }}>{d.platform}</span>
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

function RecentCalls({ calls }: { calls: CallRecord[] }) {
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

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
          Recent calls{' '}
          <span style={{ color: '#333', textTransform: 'none', letterSpacing: 0 }}>
            — {q ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : `${filtered.length} latest · click to expand`}
          </span>
        </div>
        <input
          type="text" placeholder="search calls…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ background: S.card, border: `1px solid ${q ? S.green : '#222'}`, borderRadius: 4, color: q ? S.text : S.dim, fontSize: 11, padding: '4px 10px', fontFamily: 'monospace', outline: 'none', width: 180 }}
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
                style={{ display: 'grid', gridTemplateColumns: COL, padding: '9px 14px', borderBottom: `1px solid #141414`, cursor: 'pointer', background: expanded === c.id ? '#141414' : 'transparent' }}
              >
                <span style={{ color: S.dim, fontSize: 11, fontFamily: 'monospace' }}>{fmtTime(c.timestamp)}</span>
                <span style={{ color: S.muted, fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: S.green }}>{c.platform}</span>:{c.action}
                </span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: c.gateway_name ? '#00bfff' : S.dim }}>
                  {gwLabel(c)}
                </span>
                <span style={{ color: '#666', fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {fmtArgs(c.args_json)}
                </span>
                <span style={{ color: S.dim, fontSize: 11, textAlign: 'right', fontFamily: 'monospace' }}>{c.latency_ms}ms</span>
                <span style={{ textAlign: 'center', fontSize: 12 }}>
                  {c.outcome === 'success' ? <span style={{ color: S.green }}>✓</span> : <span style={{ color: S.red }}>✗</span>}
                </span>
              </div>
              {expanded === c.id && (
                <div style={{ padding: '10px 14px', background: '#0d0d0d', borderBottom: `1px solid #141414` }}>
                  <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Args</div>
                  <pre style={{ color: S.muted, fontSize: 11, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {JSON.stringify(JSON.parse(c.args_json || '{}'), null, 2)}
                  </pre>
                  {c.result_json && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Result</div>
                      <pre style={{ color: '#7ec87e', fontSize: 11, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflowY: 'auto' }}>
                        {c.result_json}
                      </pre>
                    </div>
                  )}
                  {c.error && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Error</div>
                      <div style={{ color: S.red, fontSize: 11 }}>{c.error}</div>
                    </div>
                  )}
                  {c.user_agent && (
                    <div style={{ marginTop: 8, color: S.dim, fontSize: 10 }}>
                      <span style={{ textTransform: 'uppercase', letterSpacing: 1 }}>UA</span>{' '}
                      <span style={{ fontFamily: 'monospace', color: '#444' }}>{c.user_agent}</span>
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

function SessionRow({ s, days }: { s: SessionSummary; days: number }) {
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

  return (
    <div style={{ borderBottom: `1px solid #141414` }}>
      <div
        onClick={toggle}
        style={{ display: 'grid', gridTemplateColumns: '140px 60px 50px 1fr 60px 28px', gap: '0 8px', padding: '9px 14px', cursor: 'pointer', background: open ? '#141414' : 'transparent', alignItems: 'center' }}
      >
        <span style={{ color: S.dim, fontSize: 11, fontFamily: 'monospace' }}>{fmtTime(s.started_at)}</span>
        <span style={{ color: wallClock > 0 ? S.muted : S.dim, fontSize: 11, fontFamily: 'monospace' }} title={wallClock > 0 ? 'wall-clock duration' : 'sum of call latencies (single-call session)'}>{durLabel}</span>
        <span style={{ color: S.dim, fontSize: 11, fontFamily: 'monospace', textAlign: 'right' }}>{s.calls}</span>
        <span style={{ color: '#444', fontSize: 10, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {s.platform_list?.split(',').map((p, i) => (
            <span key={p} style={{ color: PLAT_COLORS[i % PLAT_COLORS.length], marginRight: 6 }}>{p}</span>
          ))}
        </span>
        <span style={{ color: S.dim, fontSize: 10, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.user_agent || undefined}>{uaLabel}</span>
        <span style={{ textAlign: 'center', fontSize: 12 }}>
          {s.errors > 0 ? <span style={{ color: S.red }}>{s.errors}✗</span> : <span style={{ color: S.green }}>✓</span>}
        </span>
      </div>
      {open && (
        <div style={{ background: '#0d0d0d', padding: '8px 14px 12px' }}>
          {loading && <div style={{ color: S.dim, fontSize: 11 }}>Loading...</div>}
          {calls && calls.map((c) => {
            const offset = c.timestamp - s.started_at
            return (
              <div key={c.id} style={{ marginBottom: 2 }}>
                <div
                  onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  style={{ display: 'grid', gridTemplateColumns: '52px 1fr 52px 18px', gap: '0 8px', padding: '5px 8px', cursor: 'pointer', borderRadius: 4, background: expandedId === c.id ? '#141414' : 'transparent' }}
                >
                  <span style={{ color: S.dim, fontSize: 10, fontFamily: 'monospace' }}>+{fmtDuration(offset)}</span>
                  <span style={{ color: S.muted, fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: PLAT_COLORS[s.platform_list?.split(',').indexOf(c.platform) % PLAT_COLORS.length] ?? S.green }}>{c.platform}</span>:{c.action}
                    {' '}<span style={{ color: '#333', fontSize: 10 }}>{fmtArgs(c.args_json)}</span>
                  </span>
                  <span style={{ color: S.dim, fontSize: 10, textAlign: 'right', fontFamily: 'monospace' }}>{c.latency_ms}ms</span>
                  <span style={{ textAlign: 'center', fontSize: 11 }}>
                    {c.outcome === 'success' ? <span style={{ color: S.green }}>✓</span> : <span style={{ color: S.red }}>✗</span>}
                  </span>
                </div>
                {expandedId === c.id && (
                  <div style={{ padding: '6px 8px 8px', borderLeft: `2px solid #1e1e1e`, marginLeft: 8, marginTop: 2 }}>
                    <div style={{ color: S.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>Args</div>
                    <pre style={{ color: S.muted, fontSize: 10, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {JSON.stringify(JSON.parse(c.args_json || '{}'), null, 2)}
                    </pre>
                    {c.result_json && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ color: S.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>Result</div>
                        <pre style={{ color: '#7ec87e', fontSize: 10, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 240, overflowY: 'auto' }}>
                          {c.result_json}
                        </pre>
                      </div>
                    )}
                    {c.error && <div style={{ color: S.red, fontSize: 10, marginTop: 4 }}>{c.error}</div>}
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

function SessionsTab({ days }: { days: number }) {
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
              <span style={{ color: S.muted, fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.tool_a}</span>
              <span style={{ color: S.muted, fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.tool_b}</span>
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
          sessions.map((s) => <SessionRow key={s.session_id} s={s} days={days} />)
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

function ErrorsTab({ data }: { data: ErrPattern[] }) {
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
                    <span key={p} style={{ color: S.green, fontSize: 10, fontFamily: 'monospace' }}>{p}</span>
                  ))}
                  <span style={{ color: S.dim, fontSize: 10 }}>{fmtTime(g.lastSeen)}</span>
                  {!merged && <span style={{ color: '#333', fontSize: 10, marginLeft: 'auto' }}>{open ? '▼' : '▶'} {g.items.length} variant{g.items.length !== 1 ? 's' : ''}</span>}
                </div>
                <div style={{ color: '#cc4444', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-word', lineHeight: 1.5 }}>{g.key}</div>
              </div>
            </div>
            {open && (
              <div style={{ borderTop: `1px solid #1a1a1a` }}>
                {g.items.map((item, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '150px 120px 1fr 36px', gap: '0 8px', padding: '7px 14px', borderTop: i > 0 ? `1px solid #141414` : undefined, alignItems: 'start', background: '#0d0a0a', fontSize: 11 }}>
                    <span style={{ color: S.green, fontFamily: 'monospace' }}>{item.platform}</span>
                    <span style={{ color: S.muted, fontFamily: 'monospace' }}>{item.action}</span>
                    <span style={{ color: '#884444', fontFamily: 'monospace', wordBreak: 'break-word' }}>{item.error}</span>
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
    if (!v) return '#0f0f0f'
    const intensity = v / maxVal
    const g = Math.round(255 * intensity)
    const r = Math.round(57 * intensity)
    return `rgb(${r}, ${g}, 20)`
  }

  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Calls by hour (UTC) × day of week</div>
      <div style={{ color: '#333', fontSize: 10, marginBottom: 16 }}>darker = more calls</div>
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
                    style={{ flex: 1, minWidth: 18, height: 20, borderRadius: 2, background: cellColor(v), cursor: v ? 'default' : 'default' }}
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

function CallersTab({ perUA, perPlatform, recentCalls }: { perUA: UAData[]; perPlatform: PlatData[]; recentCalls: CallRecord[] }) {
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
              <div style={{ height: 4, background: '#1a1a1a', borderRadius: 2 }}>
                <div style={{ width: `${(u.total / totalCalls) * 100}%`, height: '100%', background: PLAT_COLORS[i % PLAT_COLORS.length], borderRadius: 2, opacity: 0.8 }} />
              </div>
              {u.errors > 0 && (
                <div style={{ color: S.red, fontSize: 10, marginTop: 2 }}>{u.errors} errors ({Math.round((u.errors / u.total) * 100)}%)</div>
              )}
              {label !== u.ua && (
                <div style={{ color: '#333', fontSize: 9, fontFamily: 'monospace', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.ua}</div>
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
                  <th key={p} style={{ textAlign: 'right', color: S.green, fontWeight: 'normal', padding: '4px 6px', borderBottom: `1px solid ${S.border}`, whiteSpace: 'nowrap' }}>{p}</th>
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
                      <td key={p} style={{ textAlign: 'right', padding: '5px 6px', color: v ? S.text : '#222' }}>{v || '·'}</td>
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

function TokenBurnTab({ data }: { data: TokenBurn }) {
  const total    = data.totalInputTokens + data.totalOutputTokens
  const maxTotal = Math.max(...data.perAction.map((a) => a.inputTokens + a.outputTokens), 1)

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
                  {a.platform}<span style={{ color: S.dim }}>:</span>{a.action}
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

// ─── Tab nav ──────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'sessions' | 'errors' | 'heatmap' | 'callers' | 'tokens'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'errors',   label: 'Errors' },
  { id: 'heatmap',  label: 'Heatmap' },
  { id: 'callers',  label: 'Callers' },
  { id: 'tokens',   label: 'Tokens' },
]

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function InsightsClient() {
  const [data, setData]         = useState<InsightsData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [days, setDays]         = useState(7)
  const [platform, setPlatform] = useState('')
  const [tab, setTab]           = useState<Tab>('overview')
  const daysArr                 = getLastNDays(days)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url = `/api/insights?days=${days}${platform ? `&platform=${encodeURIComponent(platform)}` : ''}`
      setData(await fetch(url).then((r) => r.json()))
    } finally { setLoading(false) }
  }, [days, platform])

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
          <div style={{ color: S.dim, fontSize: 12, marginTop: 2 }}>What Claude actually did with your MCPs</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {data && data.perPlatform.length > 1 && (
            <select
              value={platform} onChange={(e) => setPlatform(e.target.value)}
              style={{ background: S.card, border: `1px solid ${platform ? S.green : '#222'}`, borderRadius: 4, color: platform ? S.green : S.dim, fontSize: 11, padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', outline: 'none' }}
            >
              <option value="">all MCPs</option>
              {data.perPlatform.map((p) => (
                <option key={p.platform} value={p.platform}>{p.platform}</option>
              ))}
            </select>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            {[7, 14, 30].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                style={{ background: days === d ? S.green : 'none', color: days === d ? '#000' : S.dim, border: `1px solid ${days === d ? S.green : '#222'}`, borderRadius: 4, fontSize: 11, padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace' }}
              >{d}d</button>
            ))}
            <button onClick={load} disabled={loading}
              style={{ background: 'none', border: '1px solid #222', borderRadius: 4, color: S.dim, fontSize: 11, padding: '4px 10px', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'monospace', marginLeft: 8 }}
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
              {data.latencyTrend.length > 0 && <LatencyTrend data={data.latencyTrend} daysArr={daysArr} />}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
                <PlatformChart data={data.perPlatform} />
                <TopActions    data={data.topActions} />
              </div>
              <RecentCalls calls={data.recentCalls} />
            </div>
          )}
          {tab === 'sessions' && <SessionsTab days={days} />}
          {tab === 'errors'   && <ErrorsTab   data={data.errorPatterns} />}
          {tab === 'heatmap'  && <HeatmapTab  data={data.heatmap} />}
          {tab === 'callers'  && <CallersTab  perUA={data.perUA} perPlatform={data.perPlatform} recentCalls={data.recentCalls} />}
          {tab === 'tokens'   && <TokenBurnTab data={data.tokenBurn} />}
        </>
      ) : null}

      <Footer motto="your calls, your problem" />
    </div>
  )
}
