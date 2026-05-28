'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Nav, Footer } from './nav'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MCPTool {
  name: string
  description?: string
  inputSchema: {
    type: string
    properties?: Record<string, { type: string; description?: string }>
    required?: string[]
  }
}

interface SecurityFlag {
  level: 'danger' | 'warning' | 'info'
  code: string
  message: string
  detail: string
}

interface ServerData {
  id: string
  type: string
  name: string
  description: string
  url: string
  online: boolean
  processRunning: boolean
  native?: boolean
  serverInfo?: { name: string; version: string }
  tools: MCPTool[]
  flags: SecurityFlag[]
  error?: string
  latencyMs?: number
  credentials: Array<{ key: string; label: string; type: string; required: boolean }>
  tags?: string[]
  healthCheckIntervalSeconds?: number
  healthCheckFailThreshold?: number
  healthConsecutiveFails?: number
  healthLastCheckedAt?: number | null
  healthLastStatus?: string | null
  healthLastError?: string | null
  autoDisabled?: boolean
}

interface ApprovalRequest {
  id:           string
  instanceId:   string
  action:       string
  argsJson:     string
  status:       'pending' | 'approved' | 'rejected'
  createdAt:    number
  decidedAt:    number | null
  decisionBy:   string | null
  rejectReason: string | null
  resultJson:   string | null
}

interface CatalogCredential {
  key: string
  label: string
  description: string
  type: 'url' | 'secret' | 'text'
  required: boolean
  isSet: boolean
  updatedAt: number | null
}

interface CatalogEntry {
  id: string
  name: string
  description: string
  installed: boolean
  credentials: CatalogCredential[]
}

interface InvokeModal { mcpId: string; serverName: string; tool: MCPTool }

// ─── Constants ────────────────────────────────────────────────────────────────

const SNARKY_ONLINE  = [
  'Somehow still running.', 'Against all odds, alive.', 'Still up. Shocking.',
  'Held together by zip ties and prayers.', 'A brisk breeze could take this down.',
  "It's working, but nobody touch anything.", 'Defying both logic and thermodynamics.',
  'Currently operational. Enjoy it while it lasts.',
  'Congratulations, it survived the last 5 minutes.', 'Surprising everyone, including the kernel.',
  'Technically online, if you stretch the definition.', 'Sipping power, breathing smoke.',
  'The uptime is high, the standards are low.', 'Running smoothly, unlike your career choices.',
  'It works. Barely. Just like your sleep schedule.',
]
const SNARKY_OFFLINE = [
  'It died. Typical.', 'Gone. Pour one out.', 'Offline. Classic.',
  "Aaaand it's gone.", 'Resting in pieces.', 'Finally, inner peace (for the CPU).',
  'The magic smoke has escaped.', 'Offline. Go touch some grass.',
  "DNS again. It's always DNS.", 'Docker did a thing. A bad thing.',
  'One YAML spacing error to rule them all.', "Don't look at me, check the logs.",
  'Your containers have entered a strike.',
  'Total system failure. Much like this entire setup.',
  'It died doing what it loved: letting you down.',
  'Dead. Just delete the volume and start over.',
  'Your homelab has left the chat. Permanently?', '0 days since the last incident.',
  'Your electricity provider thanks you.',
]
const SNARKY_LOADING = ['Pinging your little servers...', 'Checking if anything survived...', 'Pretending to care about uptime...']
const rand = (a: string[]) => a[Math.floor(Math.random() * a.length)]

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const S = {
  bg: 'var(--bg)', card: 'var(--card)', border: 'var(--border)', text: 'var(--text)',
  muted: 'var(--muted)', dim: 'var(--dim)', green: 'var(--green)', red: 'var(--red)', yellow: 'var(--yellow)',
}

// ─── Graphs ───────────────────────────────────────────────────────────────────

function Charts({ servers }: { servers: ServerData[] }) {
  if (servers.length === 0) return null

  const online     = servers.filter((s) => s.online)
  const maxLatency = Math.max(...online.map((s) => s.latencyMs ?? 0), 100)
  const ratio      = servers.length > 0 ? online.length / servers.length : 0

  const R         = 22
  const circum    = 2 * Math.PI * R
  const dashArray = `${ratio * circum} ${circum}`
  const ringColor = ratio === 1 ? S.green : ratio > 0 ? S.yellow : S.red

  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16, marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr auto', gap: 20, alignItems: 'start' }}>
      <div>
        <div style={{ color: S.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Servers <span style={{ color: S.dim, textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>— latency · tools</span>
        </div>
        {servers.map((s) => {
          const ms    = s.latencyMs ?? 0
          const count = s.tools?.length ?? 0
          const pct   = Math.min(ms / maxLatency * 100, 100)
          const col   = ms < 100 ? S.green : ms < 500 ? S.yellow : S.red
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.online ? S.green : S.red, flexShrink: 0, boxShadow: s.online ? `0 0 4px ${S.green}` : undefined }} />
              <span style={{ color: S.muted, fontSize: 12, width: 80, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
              <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                {s.online && <div style={{ width: `${pct}%`, height: '100%', background: col, borderRadius: 2, transition: 'width 0.4s ease' }} />}
              </div>
              <span style={{ color: s.online ? S.dim : S.dim, fontSize: 10, width: 38, textAlign: 'right', flexShrink: 0, fontFamily: 'monospace' }}>
                {s.online ? `${ms}ms` : 'down'}
              </span>
              <span style={{ color: S.dim, fontSize: 10, width: 28, textAlign: 'right', flexShrink: 0, fontFamily: 'monospace' }}>·{count}</span>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingTop: 4 }}>
        <svg width={56} height={56} viewBox="0 0 56 56">
          <circle cx={28} cy={28} r={R} fill="none" strokeWidth={5} style={{ stroke: 'var(--border)' }} />
          <circle cx={28} cy={28} r={R} fill="none" strokeWidth={5} strokeLinecap="round" strokeDasharray={dashArray} transform="rotate(-90 28 28)" style={{ stroke: ringColor, transition: 'stroke-dasharray 0.4s ease' }} />
          <text x={28} y={28} textAnchor="middle" dominantBaseline="central" fontSize={11} fontFamily="monospace" style={{ fill: 'var(--text)' }}>
            {online.length}/{servers.length}
          </text>
        </svg>
        <span style={{ color: S.dim, fontSize: 10 }}>online</span>
      </div>
    </div>
  )
}

// ─── Gateway info ─────────────────────────────────────────────────────────────

function GatewayInfo() {
  const [host, setHost]     = useState('<host>')
  const [apiKey, setApiKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') setHost(window.location.hostname)
    fetch('/api/gateway-key').then((r) => r.json()).then((d) => setApiKey(d.key ?? ''))
  }, [])

  const url         = `http://${host}:1234/mcp`
  const maskedKey   = apiKey ? `${apiKey.slice(0, 8)}${'•'.repeat(20)}` : '<loading...>'
  const cmd         = `claude mcp add mcpetty ${url} --transport http --header "Authorization: Bearer ${maskedKey}"`
  const cmdReal     = apiKey ? `claude mcp add mcpetty ${url} --transport http --header "Authorization: Bearer ${apiKey}"` : cmd

  function copyText(text: string, setCopiedFn: (v: boolean) => void) {
    const fallback = () => {
      const el = document.createElement('textarea')
      el.value = text
      Object.assign(el.style, { position: 'fixed', opacity: '0', top: '0', left: '0' })
      document.body.appendChild(el); el.focus(); el.select()
      try { document.execCommand('copy') } catch { /* noop */ }
      document.body.removeChild(el)
    }
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(fallback)
    else fallback()
    setCopiedFn(true)
    setTimeout(() => setCopiedFn(false), 2000)
  }

  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 14, marginBottom: 20 }}>
      <div style={{ color: S.green, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Gateway Endpoint</div>
      <div style={{ color: S.muted, fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
        Point Claude Code here — all installed MCPs as one server. The API key is derived from your master secret and never changes unless you wipe the data volume.
      </div>

      {/* API key */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>API Key</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: S.bg, border: `1px solid ${S.border}`, borderRadius: 4, padding: '6px 10px' }}>
          <code style={{ color: S.muted, fontSize: 11, flex: 1, fontFamily: 'monospace', letterSpacing: 1 }}>
            {apiKey ? `${apiKey.slice(0, 8)}${'•'.repeat(20)}` : 'loading...'}
          </code>
          <button onClick={() => copyText(apiKey, setKeyCopied)} style={{ background: 'none', border: `1px solid ${S.border}`, color: keyCopied ? S.green : S.dim, fontSize: 10, padding: '2px 8px', cursor: 'pointer', fontFamily: 'monospace', borderRadius: 3, flexShrink: 0 }}>
            {keyCopied ? '✓ copied' : 'copy key'}
          </button>
        </div>
      </div>

      {/* Full command */}
      <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Claude Code command</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: S.bg, border: `1px solid ${S.border}`, borderRadius: 4, padding: '7px 10px' }}>
        <code style={{ color: S.text, fontSize: 11, flex: 1, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.5 }}>{cmd}</code>
        <button onClick={() => copyText(cmdReal, setCopied)} style={{ background: 'none', border: `1px solid ${S.border}`, color: copied ? S.green : S.dim, fontSize: 10, padding: '2px 8px', cursor: 'pointer', fontFamily: 'monospace', borderRadius: 3, flexShrink: 0 }}>
          {copied ? '✓' : 'copy'}
        </button>
      </div>
    </div>
  )
}

// ─── Mini feed ────────────────────────────────────────────────────────────────

interface MiniCall { id: number; action: string; outcome: string; latency_ms: number; timestamp: number; error: string | null }

function relTs(ms: number): string {
  const d = Date.now() - ms
  if (d < 60000)    return `${Math.round(d / 1000)}s ago`
  if (d < 3600000)  return `${Math.round(d / 60000)}m ago`
  if (d < 86400000) return `${Math.round(d / 3600000)}h ago`
  return `${Math.round(d / 86400000)}d ago`
}

function MiniFeed({ serverId }: { serverId: string }) {
  const [open,   setOpen]   = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [calls,  setCalls]  = useState<MiniCall[]>([])

  useEffect(() => {
    if (!open || loaded) return
    fetch(`/api/insights?platform=${encodeURIComponent(serverId)}&days=7`)
      .then((r) => r.json())
      .then((d) => { setCalls((d.recentCalls ?? []).slice(0, 5)); setLoaded(true) })
  }, [open, loaded, serverId])

  return (
    <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 10 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ background: 'none', border: 'none', color: S.dim, fontSize: 12, cursor: 'pointer', fontFamily: 'monospace', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}
      >
        {open ? '▼' : '▶'} recent calls
        {loaded && calls.length > 0 && (
          <span style={{ color: calls.some((c) => c.outcome === 'error') ? '#884444' : '#3a6a3a', fontSize: 11 }}>
            {calls.length} loaded
          </span>
        )}
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          {!loaded ? (
            <div style={{ color: S.dim, fontSize: 11 }}>loading...</div>
          ) : calls.length === 0 ? (
            <div style={{ color: S.dim, fontSize: 11 }}>no calls in the last 7 days</div>
          ) : (
            calls.map((c) => (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '8px 1fr 44px 60px', gap: 6, alignItems: 'center', padding: '4px 0', borderTop: '1px solid #141414', fontSize: 11 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.outcome === 'error' ? S.red : S.green, display: 'inline-block' }} />
                <span style={{ color: c.outcome === 'error' ? '#aa4444' : S.muted, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.error ?? undefined}>{c.action}</span>
                <span style={{ color: S.dim, textAlign: 'right' }}>{c.latency_ms}ms</span>
                <span style={{ color: '#333', textAlign: 'right' }}>{relTs(c.timestamp)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Tool access panel ────────────────────────────────────────────────────────

function ToolAccessPanel({ server }: { server: ServerData }) {
  const [open, setOpen]         = useState(false)
  const tools                   = server.tools ?? []
  const [typeFilters, setTypeFilters] = useState<Record<string, boolean>>({})
  const [instFilters, setInstFilters] = useState<Record<string, boolean>>({})
  const [filters, setFilters]   = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const t of tools) init[t.name] = true
    return init
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  const [descOverrides, setDescOverrides] = useState<Record<string, string>>({})
  const [editingDesc,   setEditingDesc]   = useState<string | null>(null)
  const [editDescVal,   setEditDescVal]   = useState('')
  const [descSaving,    setDescSaving]    = useState(false)

  useEffect(() => {
    if (!tools.length) return
    Promise.all([
      fetch(`/api/tool-filters?id=${server.type}`).then((r) => r.json()),
      fetch(`/api/tool-filters?id=${server.id}`).then((r) => r.json()),
      fetch(`/api/description-overrides?id=${server.id}`).then((r) => r.json()),
    ]).then(([typeData, instData, descData]: [Record<string, boolean>, Record<string, boolean>, Record<string, string>]) => {
      setTypeFilters(typeData)
      setInstFilters(instData)
      setDescOverrides(descData)
      setFilters(() => {
        const next: Record<string, boolean> = {}
        for (const t of tools) {
          if (t.name in instData)  next[t.name] = instData[t.name]
          else if (t.name in typeData) next[t.name] = typeData[t.name]
          else next[t.name] = true
        }
        return next
      })
    })
  }, [server.id, server.type]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveDesc(toolName: string, val: string) {
    setDescSaving(true)
    await fetch('/api/description-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: server.id, toolName, description: val }),
    })
    setDescOverrides((prev) => {
      const next = { ...prev }
      if (val.trim()) next[toolName] = val.trim()
      else delete next[toolName]
      return next
    })
    setEditingDesc(null)
    setDescSaving(false)
  }

  async function save() {
    // Only persist tools that differ from the type default
    const overrides: Record<string, boolean> = {}
    for (const t of tools) {
      const typeDefault = t.name in typeFilters ? typeFilters[t.name] : true
      if (filters[t.name] !== typeDefault) overrides[t.name] = filters[t.name]
    }
    setSaving(true)
    await fetch('/api/tool-filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: server.id, filters: overrides, clearFirst: true }),
    })
    setInstFilters(overrides)
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function reset() {
    await fetch('/api/tool-filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: server.id, filters: {}, clearFirst: true }),
    })
    setInstFilters({})
    setFilters(() => {
      const next: Record<string, boolean> = {}
      for (const t of tools) next[t.name] = t.name in typeFilters ? typeFilters[t.name] : true
      return next
    })
  }

  function toggle(name: string) { setFilters((p) => ({ ...p, [name]: !p[name] })) }
  function setAll(v: boolean) {
    const next: Record<string, boolean> = {}
    for (const t of tools) next[t.name] = v
    setFilters(next)
  }

  if (!tools.length) return null

  const enabledCount  = Object.values(filters).filter(Boolean).length
  const hasOverrides  = Object.keys(instFilters).length > 0

  return (
    <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 10 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ background: 'none', border: 'none', color: S.dim, fontSize: 12, cursor: 'pointer', fontFamily: 'monospace', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}
      >
        {open ? '▼' : '▶'} tool access
        <span style={{ color: enabledCount === tools.length ? S.green : S.yellow, fontSize: 11 }}>
          {enabledCount}/{tools.length} exposed
        </span>
        {hasOverrides && <span style={{ color: '#888', fontSize: 10 }}>· instance overrides active</span>}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            {(['all', 'none'] as const).map((v) => (
              <button key={v} onClick={() => setAll(v === 'all')} style={{ background: 'none', border: '1px solid #222', borderRadius: 3, color: S.dim, fontSize: 11, padding: '2px 10px', cursor: 'pointer', fontFamily: 'monospace' }}>{v}</button>
            ))}
            {hasOverrides && (
              <button onClick={reset} style={{ background: 'none', border: '1px solid #1a1a2a', borderRadius: 3, color: '#6666aa', fontSize: 11, padding: '2px 10px', cursor: 'pointer', fontFamily: 'monospace', marginLeft: 4 }}>reset to type defaults</button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {tools.map((tool) => {
              const on         = filters[tool.name] !== false
              const isOverride = tool.name in instFilters
              const typeDefault = tool.name in typeFilters ? typeFilters[tool.name] : true
              const showBadge  = isOverride || filters[tool.name] !== typeDefault
              return (
                <div
                  key={tool.name}
                  onClick={() => toggle(tool.name)}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '6px 8px', borderRadius: 4, background: on ? '#0a120a' : '#111', border: `1px solid ${on ? '#1a2a1a' : '#1a1a1a'}` }}
                >
                  <div style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, border: `1px solid ${on ? S.green : '#333'}`, background: on ? S.green : 'transparent', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <span style={{ color: '#000', fontSize: 9, fontWeight: 'bold', lineHeight: 1 }}>✓</span>}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: on ? S.green : S.dim, fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' }}>{tool.name}</span>
                      {showBadge && <span style={{ color: '#6666aa', fontSize: 9, fontFamily: 'monospace' }}>override</span>}
                      {descOverrides[tool.name] && <span style={{ color: '#0088aa', fontSize: 9, fontFamily: 'monospace' }}>✎ desc</span>}
                    </div>
                    {editingDesc === tool.name ? (
                      <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 4 }}>
                        <input
                          type="text"
                          value={editDescVal}
                          onChange={(e) => setEditDescVal(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveDesc(tool.name, editDescVal); if (e.key === 'Escape') setEditingDesc(null) }}
                          autoFocus
                          style={{ width: '100%', background: S.bg, border: '1px solid #333', color: S.text, padding: '3px 6px', fontFamily: 'monospace', fontSize: 11, borderRadius: 3, outline: 'none' }}
                        />
                        <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                          <button onClick={() => saveDesc(tool.name, editDescVal)} disabled={descSaving} style={{ background: S.green, color: '#000', border: 'none', padding: '2px 8px', fontFamily: 'monospace', fontSize: 10, cursor: 'pointer', borderRadius: 3 }}>save</button>
                          <button onClick={() => setEditingDesc(null)} style={{ background: 'none', border: '1px solid #222', color: S.dim, padding: '2px 6px', fontFamily: 'monospace', fontSize: 10, cursor: 'pointer', borderRadius: 3 }}>✕</button>
                          {descOverrides[tool.name] && <button onClick={() => saveDesc(tool.name, '')} style={{ background: 'none', border: '1px solid #2a1a1a', color: '#884444', padding: '2px 6px', fontFamily: 'monospace', fontSize: 10, cursor: 'pointer', borderRadius: 3 }}>clear override</button>}
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginTop: 2 }}>
                        <div style={{ color: descOverrides[tool.name] ? '#00aacc' : (on ? S.muted : '#444'), fontSize: 11, lineHeight: 1.4, flex: 1 }}>
                          {descOverrides[tool.name] || tool.description || <span style={{ color: '#333' }}>no description</span>}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditDescVal(descOverrides[tool.name] ?? tool.description ?? ''); setEditingDesc(tool.name) }}
                          style={{ background: 'none', border: 'none', color: '#333', fontSize: 12, cursor: 'pointer', padding: '0 2px', flexShrink: 0, lineHeight: 1 }}
                          title="Edit description"
                        >✎</button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <button
            onClick={save}
            disabled={saving}
            style={{ background: saved ? '#0a1a0a' : S.green, color: saved ? S.green : '#000', border: saved ? `1px solid ${S.green}` : 'none', padding: '6px 20px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 12, cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 4 }}
          >
            {saved ? '✓ saved' : saving ? 'saving...' : 'save'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Invoke modal ─────────────────────────────────────────────────────────────

function InvokeModal({ modal, onClose }: { modal: InvokeModal; onClose: () => void }) {
  const [args, setArgs]       = useState('{}')
  const [result, setResult]   = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const props    = modal.tool.inputSchema?.properties ?? {}
  const required = modal.tool.inputSchema?.required   ?? []

  useEffect(() => {
    const d: Record<string, string> = {}
    for (const k of required) d[k] = ''
    setArgs(JSON.stringify(d, null, 2))
  }, [required])

  async function invoke() {
    setLoading(true); setResult(null); setError(null)
    try {
      const res  = await fetch('/api/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpId: modal.mcpId, toolName: modal.tool.name, args: JSON.parse(args) }),
      })
      const data = await res.json()
      if (data.error) setError(data.error)
      else setResult(JSON.stringify(data.result, null, 2))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something broke.')
    } finally { setLoading(false) }
  }

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: S.card, border: '1px solid #333', borderRadius: 8, padding: 24, width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', fontFamily: 'monospace' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ color: S.green, fontWeight: 'bold', fontSize: 14 }}>{modal.tool.name}</div>
            <div style={{ color: S.muted, fontSize: 12 }}>{modal.serverName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: S.muted, cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        {modal.tool.description && <div style={{ color: '#888', fontSize: 12, marginBottom: 16, lineHeight: 1.5 }}>{modal.tool.description}</div>}
        {Object.keys(props).length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: S.muted, fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Parameters</div>
            {Object.entries(props).map(([k, v]) => (
              <div key={k} style={{ marginBottom: 6, fontSize: 12 }}>
                <span style={{ color: S.green }}>{k}</span>
                {required.includes(k) && <span style={{ color: S.red, marginLeft: 4 }}>*</span>}
                <span style={{ color: S.muted, marginLeft: 8 }}>{v.type}</span>
                {v.description && <span style={{ color: '#444', marginLeft: 8 }}>— {v.description}</span>}
              </div>
            ))}
          </div>
        )}
        <textarea value={args} onChange={(e) => setArgs(e.target.value)} style={{ width: '100%', background: S.bg, border: '1px solid #333', color: S.text, padding: 10, fontFamily: 'monospace', fontSize: 12, borderRadius: 4, resize: 'vertical', minHeight: 100, outline: 'none', marginBottom: 12 }} />
        <button onClick={invoke} disabled={loading} style={{ background: loading ? '#1a2a1a' : S.green, color: '#000', border: 'none', padding: '8px 16px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', borderRadius: 4, width: '100%' }}>
          {loading ? 'Yeeting...' : '⚡ Yeet This Tool'}
        </button>
        {error  && <div style={{ marginTop: 16, background: '#1a0a0a', border: `1px solid ${S.red}`, borderRadius: 4, padding: 12, color: S.red, fontSize: 12 }}><b>it broke:</b> {error}</div>}
        {result && <div style={{ marginTop: 16, background: '#0a1a0a', border: `1px solid ${S.green}`, borderRadius: 4, padding: 12 }}><div style={{ color: S.green, fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Result</div><pre style={{ color: S.text, fontSize: 12, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{result}</pre></div>}
      </div>
    </div>
  )
}

// ─── Tag editor ───────────────────────────────────────────────────────────────

function TagEditor({ serverId, initial }: { serverId: string; initial: string[] | undefined }) {
  const [tags,     setTags]     = useState<string[]>(initial ?? [])
  const [editing,  setEditing]  = useState(false)
  const [draft,    setDraft]    = useState('')
  const [allTags,  setAllTags]  = useState<string[]>([])
  const [saving,   setSaving]   = useState(false)
  const [dropOpen, setDropOpen] = useState(false)

  useEffect(() => {
    fetch('/api/instance-tag').then((r) => r.json()).then(setAllTags)
  }, [])

  function open() {
    setDraft('')
    setEditing(true)
    setDropOpen(true)
  }

  async function persist(next: string[]) {
    setSaving(true)
    await fetch('/api/instance-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: serverId, tags: next }),
    })
    setTags(next)
    setSaving(false)
  }

  function addTag(t: string) {
    const clean = t.trim()
    if (!clean || tags.includes(clean) || tags.length >= 3) { setDraft(''); return }
    persist([...tags, clean])
    setDraft('')
    setDropOpen(false)
  }

  function removeTag(t: string) { persist(tags.filter((x) => x !== t)) }

  const suggestions = allTags.filter((t) => !tags.includes(t) && (draft === '' || t.toLowerCase().includes(draft.toLowerCase())))

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {tags.map((t) => (
        <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'var(--tint-green-bg)', border: `1px solid var(--tint-green-border)`, color: S.green, fontSize: 10, padding: '2px 6px', borderRadius: 3, fontFamily: 'monospace' }}>
          [{t}]
          <button onClick={() => removeTag(t)} style={{ background: 'none', border: 'none', color: S.green, cursor: 'pointer', padding: 0, fontSize: 11, lineHeight: 1, marginLeft: 1, opacity: 0.6 }}>✕</button>
        </span>
      ))}
      {editing ? (
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setDropOpen(true) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTag(draft)
              if (e.key === 'Escape') { setEditing(false); setDropOpen(false) }
            }}
            onFocus={() => setDropOpen(true)}
            onBlur={() => setTimeout(() => { setEditing(false); setDropOpen(false) }, 150)}
            autoFocus
            placeholder="new tag"
            style={{ background: S.bg, border: `1px solid #333`, color: S.text, fontFamily: 'monospace', fontSize: 11, padding: '2px 7px', borderRadius: 3, outline: 'none', width: 80 }}
          />
          {saving && <span style={{ color: S.dim, fontSize: 10, position: 'absolute', right: -18, top: 3 }}>…</span>}
          {dropOpen && suggestions.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 200, background: S.card, border: `1px solid ${S.border}`, borderRadius: 4, marginTop: 2, minWidth: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
              {suggestions.map((t) => (
                <button
                  key={t}
                  onMouseDown={(e) => { e.preventDefault(); addTag(t) }}
                  style={{ display: 'block', width: '100%', background: 'none', border: 'none', color: S.muted, fontSize: 11, padding: '5px 10px', cursor: 'pointer', fontFamily: 'monospace', textAlign: 'left' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#1e1e1e'; (e.currentTarget as HTMLButtonElement).style.color = S.text }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = S.muted }}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : tags.length < 3 ? (
        <button
          onClick={open}
          style={{ background: 'none', border: `1px solid #222`, color: S.dim, fontSize: 10, padding: '2px 7px', borderRadius: 3, cursor: 'pointer', fontFamily: 'monospace' }}
        >+ tag</button>
      ) : null}
    </div>
  )
}

// ─── Approval panel ──────────────────────────────────────────────────────────

function ApprovalPanel({ onClose, onDecided }: { onClose: () => void; onDecided: () => void }) {
  const [approvals,   setApprovals]   = useState<ApprovalRequest[]>([])
  const [tab,         setTab]         = useState<'pending' | 'history'>('pending')
  const [rejectId,    setRejectId]    = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const load = useCallback(async () => {
    const [pending, all] = await Promise.all([
      fetch('/api/approvals?status=pending').then((r) => r.json()),
      fetch('/api/approvals').then((r) => r.json()),
    ])
    setApprovals(tab === 'pending' ? pending : all)
  }, [tab])

  useEffect(() => {
    load()
    const interval = setInterval(load, 3000)
    return () => clearInterval(interval)
  }, [load])

  async function decide(id: string, decision: 'approved' | 'rejected', reason?: string) {
    await fetch(`/api/approvals/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, reason }),
    })
    setRejectId(null); setRejectReason('')
    load(); onDecided()
  }

  const pending  = approvals.filter((a) => a.status === 'pending')
  const history  = approvals.filter((a) => a.status !== 'pending')
  const displayed = tab === 'pending' ? pending : history

  function timeAgo(ms: number) {
    const s = Math.floor((Date.now() - ms) / 1000)
    if (s < 60)     return `${s}s ago`
    if (s < 3600)   return `${Math.floor(s / 60)}m ago`
    return `${Math.floor(s / 3600)}h ago`
  }

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', zIndex: 60 }}>
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: '8px 0 0 8px', width: '100%', maxWidth: 520, height: '100vh', overflowY: 'auto', fontFamily: 'monospace', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ color: S.text, fontWeight: 'bold', fontSize: 15 }}>Approval Queue</div>
            <div style={{ color: S.dim, fontSize: 11, marginTop: 2 }}>human-in-the-loop for your trigger-happy AI</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: S.muted, cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: `1px solid ${S.border}` }}>
          {(['pending', 'history'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ background: 'none', border: 'none', borderBottom: `2px solid ${tab === t ? S.green : 'transparent'}`, color: tab === t ? S.green : S.dim, fontSize: 12, padding: '5px 12px', cursor: 'pointer', fontFamily: 'monospace', marginBottom: -1 }}
            >
              {t === 'pending' ? `Pending (${pending.length})` : 'History'}
            </button>
          ))}
        </div>

        {displayed.length === 0 ? (
          <div style={{ color: S.dim, fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
            {tab === 'pending' ? 'Nothing waiting. Your AI is being uncharacteristically restrained.' : 'No decisions recorded yet.'}
          </div>
        ) : displayed.map((req) => (
          <div key={req.id} style={{ background: S.bg, border: `1px solid ${req.status === 'pending' ? S.yellow : req.status === 'approved' ? S.green : S.red}22`, borderLeft: `3px solid ${req.status === 'pending' ? S.yellow : req.status === 'approved' ? S.green : S.red}`, borderRadius: 6, padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: S.green, fontSize: 13, fontWeight: 'bold', fontFamily: 'monospace' }}>{req.instanceId}</span>
              <span style={{ color: S.dim, fontSize: 10 }}>{timeAgo(req.createdAt)}</span>
            </div>
            <div style={{ color: S.text, fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: S.yellow }}>action:</span> {req.action}
            </div>
            <pre style={{ background: '#0a0a0a', border: `1px solid #1a1a1a`, borderRadius: 4, padding: '6px 8px', fontSize: 10, color: S.muted, overflow: 'auto', maxHeight: 120, margin: '0 0 10px 0' }}>
              {JSON.stringify(JSON.parse(req.argsJson), null, 2)}
            </pre>

            {req.status === 'pending' && (
              rejectId === req.id ? (
                <div>
                  <input
                    autoFocus
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Reason (optional)"
                    onKeyDown={(e) => { if (e.key === 'Enter') decide(req.id, 'rejected', rejectReason); if (e.key === 'Escape') setRejectId(null) }}
                    style={{ width: '100%', boxSizing: 'border-box', background: S.card, border: `1px solid ${S.border}`, color: S.text, padding: '4px 8px', fontFamily: 'monospace', fontSize: 11, borderRadius: 3, outline: 'none', marginBottom: 6 }}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => decide(req.id, 'rejected', rejectReason)} style={{ background: 'none', border: `1px solid ${S.red}`, color: S.red, padding: '3px 12px', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', borderRadius: 3 }}>confirm reject</button>
                    <button onClick={() => setRejectId(null)} style={{ background: 'none', border: `1px solid ${S.border}`, color: S.dim, padding: '3px 10px', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', borderRadius: 3 }}>cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => decide(req.id, 'approved')} style={{ background: '#0a1a0a', border: `1px solid ${S.green}`, color: S.green, padding: '4px 16px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 12, cursor: 'pointer', borderRadius: 4, flex: 1 }}>✓ Approve</button>
                  <button onClick={() => { setRejectId(req.id); setRejectReason('') }} style={{ background: '#1a0a0a', border: `1px solid ${S.red}`, color: S.red, padding: '4px 16px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 12, cursor: 'pointer', borderRadius: 4, flex: 1 }}>✕ Reject</button>
                </div>
              )
            )}

            {req.status !== 'pending' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: req.status === 'approved' ? S.green : S.red, fontSize: 11, fontWeight: 'bold' }}>
                  {req.status === 'approved' ? '✓ approved' : '✕ rejected'}
                </span>
                <span style={{ color: S.dim, fontSize: 10 }}>by {req.decisionBy}</span>
                {req.rejectReason && <span style={{ color: S.dim, fontSize: 10 }}>— {req.rejectReason}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Health check panel (in gear modal) ──────────────────────────────────────

function HealthCheckPanel({ server }: { server: ServerData }) {
  const [open,      setOpen]      = useState(false)
  const [interval,  setInterval2] = useState(server.healthCheckIntervalSeconds ?? 0)
  const [threshold, setThreshold] = useState(server.healthCheckFailThreshold ?? 3)
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)

  async function save() {
    setSaving(true)
    await fetch('/api/health-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: server.id, intervalSeconds: interval, failThreshold: threshold }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function reenable() {
    await fetch('/api/health-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: server.id, intervalSeconds: interval, failThreshold: threshold }),
    })
    window.location.reload()
  }

  const INTERVALS = [
    { label: 'off',   secs: 0 },
    { label: '1 min', secs: 60 },
    { label: '5 min', secs: 300 },
    { label: '15 min', secs: 900 },
    { label: '30 min', secs: 1800 },
  ]

  return (
    <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 10 }}>
      <button onClick={() => setOpen(!open)} style={{ background: 'none', border: 'none', color: S.dim, fontSize: 12, cursor: 'pointer', fontFamily: 'monospace', padding: 0 }}>
        {open ? '▼' : '▶'} health check
        {server.healthLastCheckedAt && (
          <span style={{ color: '#444', fontSize: 10, marginLeft: 8 }}>
            last checked {Math.round((Date.now() - server.healthLastCheckedAt) / 60000)}m ago
          </span>
        )}
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {server.autoDisabled && (
            <div style={{ background: '#1a1000', border: `1px solid ${S.yellow}`, borderRadius: 4, padding: '8px 12px', marginBottom: 12, fontSize: 12 }}>
              <div style={{ color: S.yellow, fontWeight: 'bold', marginBottom: 4 }}>AUTO-DISABLED</div>
              <div style={{ color: S.muted, lineHeight: 1.5 }}>
                Disabled automatically after {server.healthConsecutiveFails} consecutive failure{server.healthConsecutiveFails !== 1 ? 's' : ''}.
                {server.healthLastError && <> Last error: {server.healthLastError}</>}
                <br/>Will re-enable automatically on recovery.
              </div>
              <button onClick={reenable} style={{ background: 'none', border: `1px solid ${S.yellow}`, color: S.yellow, padding: '3px 12px', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', borderRadius: 3, marginTop: 8 }}>Re-enable now</button>
            </div>
          )}

          <div style={{ marginBottom: 10 }}>
            <div style={{ color: S.dim, fontSize: 11, marginBottom: 6 }}>Check interval</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {INTERVALS.map((opt) => (
                <button
                  key={opt.secs}
                  onClick={() => setInterval2(opt.secs)}
                  style={{ background: interval === opt.secs ? S.green : 'none', color: interval === opt.secs ? '#000' : S.dim, border: `1px solid ${interval === opt.secs ? S.green : S.border}`, padding: '3px 10px', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', borderRadius: 3 }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {interval > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: S.dim, fontSize: 11, marginBottom: 6 }}>Disable after <span style={{ color: S.text }}>{threshold}</span> consecutive failures</div>
              <input
                type="range" min={1} max={10} value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                style={{ width: '100%', accentColor: S.green }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', color: S.dim, fontSize: 10 }}>
                <span>1</span><span>10</span>
              </div>
            </div>
          )}

          <button
            onClick={save}
            disabled={saving}
            style={{ background: saved ? '#0a1a0a' : S.green, color: saved ? S.green : '#000', border: saved ? `1px solid ${S.green}` : 'none', padding: '5px 18px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 12, cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 4 }}
          >
            {saved ? '✓ saved' : saving ? 'saving...' : 'save'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Approval rules panel (in gear modal) ────────────────────────────────────

function ApprovalRulesPanel({ serverId }: { serverId: string }) {
  const [open,    setOpen]    = useState(false)
  const [rules,   setRules]   = useState<Array<{ pattern: string; enabled: boolean }>>([])
  const [draft,   setDraft]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)

  useEffect(() => {
    if (!open) return
    fetch(`/api/approvals/rules/${encodeURIComponent(serverId)}`).then((r) => r.json()).then(setRules)
  }, [open, serverId])

  async function save(next: typeof rules) {
    setSaving(true)
    await fetch(`/api/approvals/rules/${encodeURIComponent(serverId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function addRule() {
    if (!draft.trim()) return
    const next = [...rules, { pattern: draft.trim(), enabled: true }]
    setRules(next); setDraft(''); save(next)
  }

  function toggle(i: number) {
    const next = rules.map((r, idx) => idx === i ? { ...r, enabled: !r.enabled } : r)
    setRules(next); save(next)
  }

  function remove(i: number) {
    const next = rules.filter((_, idx) => idx !== i)
    setRules(next); save(next)
  }

  return (
    <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 10 }}>
      <button onClick={() => setOpen(!open)} style={{ background: 'none', border: 'none', color: S.dim, fontSize: 12, cursor: 'pointer', fontFamily: 'monospace', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        {open ? '▼' : '▶'} approval rules
        {rules.length > 0 && <span style={{ color: S.yellow, fontSize: 10 }}>{rules.filter((r) => r.enabled).length} active</span>}
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ color: S.dim, fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
            Actions matching these patterns require human approval before running. Glob syntax: <code style={{ color: S.green }}>delete_*</code>
          </div>
          {rules.length === 0 ? (
            <div style={{ color: '#333', fontSize: 12, marginBottom: 10 }}>No rules. Everything runs without approval.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
              {rules.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    onClick={() => toggle(i)}
                    style={{ width: 14, height: 14, flexShrink: 0, border: `1px solid ${r.enabled ? S.yellow : S.border}`, background: r.enabled ? S.yellow : 'transparent', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {r.enabled && <span style={{ color: '#000', fontSize: 9, fontWeight: 'bold', lineHeight: 1 }}>✓</span>}
                  </div>
                  <code style={{ color: r.enabled ? S.text : S.dim, fontSize: 12, flex: 1 }}>{r.pattern}</code>
                  <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', color: '#444', fontSize: 12, cursor: 'pointer', padding: '0 4px' }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addRule()}
              placeholder="action_name or glob e.g. delete_*"
              style={{ flex: 1, background: S.bg, border: `1px solid ${S.border}`, color: S.text, padding: '4px 8px', fontFamily: 'monospace', fontSize: 11, borderRadius: 3, outline: 'none' }}
            />
            <button onClick={addRule} style={{ background: S.yellow + '22', border: `1px solid ${S.yellow}`, color: S.yellow, padding: '4px 12px', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', borderRadius: 3 }}>add</button>
          </div>
          {saved && <div style={{ color: S.green, fontSize: 10, marginTop: 4 }}>✓ saved</div>}
        </div>
      )}
    </div>
  )
}

// ─── Server card ──────────────────────────────────────────────────────────────

function ServerCard({ server, index, snarky, onInvoke, onRefresh, onUninstall }: { server: ServerData; index: number; snarky: string; onInvoke: (m: InvokeModal) => void; onRefresh: () => void; onUninstall: () => void }) {
  const [gearOpen, setGearOpen]         = useState(false)
  const [expanded, setExpanded]         = useState(false)
  const [credOpen, setCredOpen]         = useState(false)
  const [setting, setSetting]           = useState<string | null>(null)
  const [inputVal, setInputVal]         = useState('')
  const [credStatuses, setCredStatuses] = useState<Record<string, { isSet: boolean; updatedAt: number | null }>>({})

  const loadCreds = useCallback(async () => {
    if (!server.credentials?.length) return
    const res  = await fetch(`/api/credentials?id=${server.id}`)
    const data = await res.json()
    setCredStatuses(data)
  }, [server.id, server.credentials?.length])

  useEffect(() => { loadCreds() }, [loadCreds])

  async function saveCred() {
    if (!setting || !inputVal.trim()) return
    await fetch('/api/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: server.id, key: setting, value: inputVal.trim() }) })
    setSetting(null); setInputVal(''); loadCreds()
    onRefresh()
  }

  async function delCred(key: string) {
    await fetch(`/api/credentials?id=${server.id}&key=${key}`, { method: 'DELETE' })
    loadCreds()
  }

  const statusColor  = server.autoDisabled ? S.yellow : server.online ? S.green : S.red
  const statusBorder = server.autoDisabled ? '#2a2000' : server.online ? '#1a3a1a' : '#2a1a1a'
  const statusDot    = server.autoDisabled ? S.yellow : server.online ? S.green : S.red

  return (
    <div style={{ position: 'relative', background: S.card, border: `1px solid ${statusBorder}`, borderRadius: 8, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ position: 'absolute', top: 6, left: 10, color: '#1e1e1e', fontSize: 9, fontFamily: 'monospace', userSelect: 'none', pointerEvents: 'none', letterSpacing: 1 }}>
        {String(index + 1).padStart(2, '0')}
      </span>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusDot, display: 'inline-block', boxShadow: `0 0 6px ${statusDot}`, flexShrink: 0 }} />
          <span style={{ fontWeight: 'bold', fontSize: 16, color: S.text }}>{server.name}</span>
          {server.autoDisabled && <span style={{ color: S.yellow, fontSize: 10, background: '#1a1000', border: `1px solid ${S.yellow}`, borderRadius: 3, padding: '1px 6px' }}>AUTO-DISABLED</span>}
          <TagEditor serverId={server.id} initial={server.tags} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: server.online ? '#3a8a3a' : '#8a3a3a' }}>{snarky}</span>
          <button
            onClick={() => setGearOpen(true)}
            style={{ background: 'none', border: '1px solid #222', borderRadius: 3, color: S.dim, fontSize: 16, padding: '1px 7px', cursor: 'pointer', fontFamily: 'monospace', lineHeight: 1 }}
            title="Settings"
          >⚙</button>
        </div>
      </div>

      <div style={{ color: S.muted, fontSize: 13 }}>{server.description}</div>

      {server.error && <div style={{ color: S.red, fontSize: 12, background: 'var(--flag-danger-bg)', padding: '6px 10px', borderRadius: 4 }}>{server.error}</div>}

      {/* Security flags */}
      {server.flags?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {server.flags.map((f) => {
            const c = {
              danger:  { bg: 'var(--flag-danger-bg)',  border: S.red,                       text: S.red,                       dot: '⚠' },
              warning: { bg: 'var(--flag-warning-bg)', border: S.yellow,                    text: S.yellow,                    dot: '⚡' },
              info:    { bg: 'var(--flag-info-bg)',     border: 'var(--flag-info-border)',   text: 'var(--flag-info-text)',     dot: '·' },
            }[f.level]
            return (
              <details key={f.code} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 4, padding: '5px 10px', fontSize: 12 }}>
                <summary style={{ color: c.text, cursor: 'pointer', listStyle: 'none', display: 'flex', gap: 6 }}><span>{c.dot}</span><b>[{f.code}]</b><span>{f.message}</span></summary>
                <div style={{ color: S.dim, marginTop: 6, paddingTop: 6, borderTop: `1px solid ${c.border}`, opacity: 0.8, lineHeight: 1.5 }}>{f.detail}</div>
              </details>
            )
          })}
        </div>
      )}

      {/* Gear modal */}
      {gearOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setGearOpen(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '40px 20px', overflowY: 'auto' }}
        >
          <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 24, width: '100%', maxWidth: 640, fontFamily: 'monospace' }}>

            {/* Modal header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ color: S.text, fontWeight: 'bold', fontSize: 15 }}>{server.name}</div>
                <div style={{ color: S.dim, fontSize: 11, marginTop: 2 }}>instance settings</div>
              </div>
              <button onClick={() => setGearOpen(false)} style={{ background: 'none', border: 'none', color: S.muted, cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            {/* Credentials */}
            {server.credentials?.length > 0 && (
              <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 10, marginBottom: 4 }}>
                <button onClick={() => setCredOpen(!credOpen)} style={{ background: 'none', border: 'none', color: S.dim, fontSize: 12, cursor: 'pointer', fontFamily: 'monospace', padding: 0 }}>
                  {credOpen ? '▼' : '▶'} credentials
                </button>
                {credOpen && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {server.credentials.map((cred) => {
                      const st = credStatuses[cred.key]
                      return (
                        <div key={cred.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: st?.isSet ? S.green : S.red, flexShrink: 0 }} />
                          <span style={{ color: S.muted, flexGrow: 1, fontFamily: 'monospace' }}>{cred.key}</span>
                          {st?.isSet && <span style={{ color: S.dim, fontSize: 11 }}>set {new Date(st.updatedAt!).toLocaleDateString()}</span>}
                          <button onClick={() => { setSetting(cred.key); setInputVal('') }} style={{ background: 'none', border: '1px solid #222', borderRadius: 3, color: S.muted, fontSize: 11, padding: '2px 8px', cursor: 'pointer', fontFamily: 'monospace' }}>{st?.isSet ? 'rotate' : 'set'}</button>
                          {st?.isSet && <button onClick={() => delCred(cred.key)} style={{ background: 'none', border: '1px solid #2a1a1a', borderRadius: 3, color: '#884444', fontSize: 11, padding: '2px 6px', cursor: 'pointer', fontFamily: 'monospace' }}>✕</button>}
                        </div>
                      )
                    })}
                    {setting && (
                      <div style={{ marginTop: 6, background: S.bg, border: '1px solid #222', borderRadius: 4, padding: 10 }}>
                        <div style={{ color: S.dim, fontSize: 11, marginBottom: 6 }}>Setting <span style={{ color: S.green }}>{setting}</span></div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input type="password" autoComplete="new-password" value={inputVal} onChange={(e) => setInputVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveCred()} placeholder="paste value" style={{ flex: 1, background: '#111', border: '1px solid #333', color: S.text, padding: '5px 8px', fontFamily: 'monospace', fontSize: 13, borderRadius: 4, outline: 'none' }} />
                          <button onClick={saveCred} style={{ background: S.green, color: '#000', border: 'none', padding: '5px 12px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}>save</button>
                          <button onClick={() => setSetting(null)} style={{ background: 'none', border: '1px solid #222', color: S.dim, padding: '5px 8px', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}>✕</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Tools */}
            {server.online && server.tools?.length > 0 && (
              <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 10, marginBottom: 4 }}>
                <button onClick={() => setExpanded(!expanded)} style={{ background: 'none', border: 'none', color: S.dim, fontSize: 12, padding: 0, cursor: 'pointer', fontFamily: 'monospace' }}>
                  {expanded ? '▼' : '▶'} {server.tools.length} tool{server.tools.length !== 1 ? 's' : ''}
                  {server.serverInfo && <span style={{ marginLeft: 8 }}>· {server.serverInfo.name} {server.serverInfo.version}</span>}
                </button>
                {expanded && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {server.tools.map((tool) => (
                      <div key={tool.name} style={{ background: S.bg, border: '1px solid #1a1a1a', borderRadius: 4, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ color: S.green, fontSize: 13, fontWeight: 'bold' }}>{tool.name}</div>
                          {tool.description && <div style={{ color: S.dim, fontSize: 12, marginTop: 2 }}>{tool.description}</div>}
                        </div>
                        <button onClick={() => { setGearOpen(false); onInvoke({ mcpId: server.id, serverName: server.name, tool }) }} style={{ background: '#0a1a0a', border: '1px solid #1a3a1a', color: S.green, fontSize: 12, padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', borderRadius: 4, flexShrink: 0, marginLeft: 12 }}>run →</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Recent calls mini feed */}
            <MiniFeed serverId={server.id} />

            {/* Tool access control */}
            {server.online && <ToolAccessPanel server={server} />}

            {/* Approval rules */}
            <ApprovalRulesPanel serverId={server.id} />

            {/* Health check */}
            {server.native && <HealthCheckPanel server={server} />}

            {/* Danger zone */}
            <div style={{ borderTop: `1px solid #2a1a1a`, paddingTop: 16, marginTop: 16 }}>
              <div style={{ color: '#444', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>danger zone</div>
              <button
                onClick={() => { setGearOpen(false); onUninstall() }}
                style={{ background: 'none', border: '1px solid #2a1a1a', borderRadius: 3, color: '#884444', fontSize: 11, padding: '4px 14px', cursor: 'pointer', fontFamily: 'monospace' }}
              >uninstall</button>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}

// ─── Library ──────────────────────────────────────────────────────────────────

function Library({ onInstalled }: { onInstalled: () => void }) {
  const [catalog, setCatalog]     = useState<CatalogEntry[]>([])
  const [installing, setInstalling] = useState<string | null>(null)
  const [formData, setFormData]   = useState<Record<string, string>>({})
  const [error, setError]         = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/library')
    setCatalog(await res.json())
  }, [])

  useEffect(() => { load() }, [load])

  const available = catalog.filter((e) => !e.installed)

  async function install(entry: CatalogEntry) {
    setError(null)
    const res = await fetch('/api/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.id, credentials: formData }),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); return }
    setInstalling(null); setFormData({})
    load(); onInstalled()
  }

  async function uninstall(id: string, name: string) {
    const answer = window.prompt(`Type "yes" to uninstall "${name}". All credentials will be deleted.`)
    if (answer?.toLowerCase() !== 'yes') return
    await fetch(`/api/library?instanceId=${encodeURIComponent(id)}`, { method: 'DELETE' })
    load(); onInstalled()
  }

  if (catalog.length === 0) return null

  return (
    <div style={{ marginTop: 48 }}>
      <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 24, marginBottom: 20 }}>
        <div style={{ color: S.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 }}>Library</div>
        <div style={{ color: S.dim, fontSize: 12 }}>Available MCPs. Pick one. We&apos;ll handle the rest.</div>
      </div>

      {catalog.filter((e) => e.installed).map((e) => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }}>
          <span style={{ color: S.green }}>✓</span>
          <span style={{ color: S.muted }}>{e.name}</span>
          <span style={{ color: S.dim, fontSize: 11 }}>installed — manage from the card above</span>
        </div>
      ))}

      {available.length === 0 ? (
        <div style={{ color: S.dim, fontSize: 13 }}>Everything in the catalog is installed. Nothing left to do. Impressive.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {available.map((entry) => (
            <div key={entry.id} style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ color: S.text, fontWeight: 'bold', fontSize: 15 }}>{entry.name}</div>
                  <div style={{ color: S.muted, fontSize: 13, marginTop: 2 }}>{entry.description}</div>
                </div>
                <button
                  onClick={() => { setInstalling(entry.id); setFormData({}); setError(null) }}
                  style={{ background: '#0a1a0a', border: '1px solid #1a3a1a', color: S.green, fontSize: 13, padding: '6px 14px', cursor: 'pointer', fontFamily: 'monospace', borderRadius: 4, flexShrink: 0, marginLeft: 16 }}
                >
                  + install
                </button>
              </div>

              {installing === entry.id && (
                <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 12, marginTop: 4 }}>
                  {error && <div style={{ color: S.red, fontSize: 12, marginBottom: 10 }}>{error}</div>}
                  {entry.credentials.map((cred) => (
                    <div key={cred.key} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: S.muted }}>{cred.label}</span>
                        {cred.required && <span style={{ color: S.red, marginLeft: 4 }}>*</span>}
                        <span style={{ color: S.dim, marginLeft: 8 }}>{cred.description}</span>
                      </div>
                      <input
                        type={cred.type === 'secret' ? 'password' : 'text'}
                        autoComplete="new-password"
                        placeholder={cred.key}
                        value={formData[cred.key] ?? ''}
                        onChange={(e) => setFormData((p) => ({ ...p, [cred.key]: e.target.value }))}
                        style={{ width: '100%', background: S.bg, border: '1px solid #333', color: S.text, padding: '6px 10px', fontFamily: 'monospace', fontSize: 13, borderRadius: 4, outline: 'none' }}
                      />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => install(entry)} style={{ background: S.green, color: '#000', border: 'none', padding: '6px 16px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 13, cursor: 'pointer', borderRadius: 4 }}>Install</button>
                    <button onClick={() => { setInstalling(null); setError(null) }} style={{ background: 'none', border: '1px solid #222', color: S.dim, padding: '6px 12px', fontFamily: 'monospace', fontSize: 13, cursor: 'pointer', borderRadius: 4 }}>cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [servers, setServers]       = useState<ServerData[]>([])
  const [loading, setLoading]       = useState(true)
  const [loadMsg]                   = useState(rand(SNARKY_LOADING))
  const [modal, setModal]           = useState<InvokeModal | null>(null)
  const [lastRefresh, setLast]      = useState<Date | null>(null)
  const [pendingCount, setPending]  = useState(0)
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [tagFilter, setTagFilter]   = useState<Set<string>>(new Set())
  const [snarkies]                  = useState(() => ({ online: shuffle(SNARKY_ONLINE), offline: shuffle(SNARKY_OFFLINE) }))

  const fetchServers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/servers')
      setServers(await res.json())
      setLast(new Date())
    } catch { /* silent */ } finally { setLoading(false) }
  }, [])

  const pollApprovals = useCallback(async () => {
    try {
      const data = await fetch('/api/approvals?status=pending').then((r) => r.json()) as ApprovalRequest[]
      setPending(Array.isArray(data) ? data.length : 0)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    fetchServers()
    pollApprovals()
    const t = setInterval(pollApprovals, 10000)
    return () => clearInterval(t)
  }, [fetchServers, pollApprovals])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  const onlineCount = servers.filter((s) => s.online).length
  const totalTools  = servers.reduce((a, s) => a + (s.tools?.length ?? 0), 0)

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    for (const s of servers) for (const t of (s.tags ?? [])) tags.add(t)
    return [...tags].sort()
  }, [servers])

  const filteredServers = tagFilter.size === 0
    ? servers
    : servers.filter((s) => (s.tags ?? []).some((t) => tagFilter.has(t)))

  let onlineIdx = 0, offlineIdx = 0
  const serversWithMeta = filteredServers.map((s, i) => ({
    s,
    i,
    snarky: s.online
      ? snarkies.online[(onlineIdx++) % snarkies.online.length]
      : snarkies.offline[(offlineIdx++) % snarkies.offline.length],
  }))

  return (
    <div style={{ minHeight: '100vh', padding: '32px 24px', maxWidth: 900, margin: '0 auto', fontFamily: 'monospace' }}>

      <Nav active="Dashboard" approvalCount={pendingCount} onApprovalsClick={() => setApprovalOpen(true)} />

      {/* Stats bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: `1px solid #1a1a1a`, paddingBottom: 16 }}>
        <div style={{ display: 'flex', gap: 24, fontSize: 13 }}>
          <span><span style={{ color: S.green }}>{onlineCount}</span><span style={{ color: S.muted }}>/{servers.length} online</span></span>
          <span style={{ color: S.muted }}>{totalTools} tools</span>
          {lastRefresh && <span style={{ color: S.dim }}>checked {lastRefresh.toLocaleTimeString()}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchServers} disabled={loading} style={{ background: 'none', border: '1px solid #222', borderRadius: 4, color: S.dim, fontSize: 12, padding: '4px 12px', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'monospace' }}>
            {loading ? '...' : '↺ refresh'}
          </button>
          <button onClick={logout} style={{ background: 'none', border: '1px solid #2a1a1a', borderRadius: 4, color: '#884444', fontSize: 12, padding: '4px 12px', cursor: 'pointer', fontFamily: 'monospace' }}>
            logout
          </button>
        </div>
      </div>

      {/* Charts */}
      {!loading && servers.length > 0 && <Charts servers={servers} />}

      {/* Gateway info */}
      <GatewayInfo />

      {/* Running MCPs */}
      {loading ? (
        <div style={{ color: S.dim, fontSize: 14, textAlign: 'center', paddingTop: 60 }}>{loadMsg}</div>
      ) : servers.length === 0 ? (
        <div style={{ textAlign: 'center', paddingTop: 40 }}>
          <div style={{ color: S.dim, fontSize: 14, marginBottom: 8 }}>No MCPs installed.</div>
          <div style={{ color: '#444', fontSize: 12 }}>Scroll down to the Library and pick one.</div>
        </div>
      ) : (
        <>
          {allTags.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setTagFilter((prev) => {
                    const next = new Set(prev)
                    next.has(tag) ? next.delete(tag) : next.add(tag)
                    return next
                  })}
                  style={{ background: tagFilter.has(tag) ? 'var(--tint-green-bg)' : 'none', border: `1px solid ${tagFilter.has(tag) ? S.green : '#222'}`, color: tagFilter.has(tag) ? S.green : S.dim, fontSize: 10, padding: '2px 8px', cursor: 'pointer', fontFamily: 'monospace', borderRadius: 3 }}
                >
                  [{tag}]
                </button>
              ))}
              {tagFilter.size > 0 && (
                <button onClick={() => setTagFilter(new Set())} style={{ background: 'none', border: '1px solid #2a1a1a', color: '#884444', fontSize: 10, padding: '2px 6px', cursor: 'pointer', fontFamily: 'monospace', borderRadius: 3 }}>✕ clear</button>
              )}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {serversWithMeta.map(({ s, i, snarky }) => (
              <ServerCard
                key={s.id}
                server={s}
                index={i}
                snarky={snarky}
                onInvoke={setModal}
                onRefresh={fetchServers}
                onUninstall={async () => {
                  const answer = window.prompt(`Type "yes" to uninstall "${s.name}". All credentials will be deleted.`)
                  if (answer?.toLowerCase() !== 'yes') return
                  await fetch(`/api/library?instanceId=${encodeURIComponent(s.id)}`, { method: 'DELETE' })
                  fetchServers()
                }}
              />
            ))}
          </div>
        </>
      )}

      {/* Library is its own tab → /library */}

      {/* Footer */}
      <Footer motto="your config, your problem" />

      {modal && <InvokeModal modal={modal} onClose={() => setModal(null)} />}
      {approvalOpen && <ApprovalPanel onClose={() => setApprovalOpen(false)} onDecided={pollApprovals} />}
    </div>
  )
}
