'use client'

import { useEffect, useState, useCallback } from 'react'
import { Nav, Footer } from './nav'

interface AuditEntry {
  id:        number
  timestamp: number
  actorType: string
  actorId:   string
  eventType: string
  subject:   string
  detail:    Record<string, unknown>
  chainHash: string
}

interface ChainStatus {
  ok:             boolean
  firstBrokenId?: number
  total:          number
}

const EVENT_COLORS: Record<string, string> = {
  login_success:      '#39ff14',
  login_failure:      '#ff4444',
  logout:             '#9a9a9a',
  password_changed:   '#ffaa00',
  mcp_install:        '#39ff14',
  mcp_uninstall:      '#ff4444',
  credential_set:     '#ffaa00',
  credential_delete:  '#ff4444',
  gateway_create:     '#39ff14',
  gateway_delete:     '#ff4444',
  gateway_rename:     '#ffaa00',
  gateway_rotate_key: '#ffaa00',
  namespace_create:   '#39ff14',
  namespace_delete:   '#ff4444',
  namespace_rename:   '#ffaa00',
  namespace_key_add:  '#39ff14',
  namespace_key_delete: '#ff4444',
  settings_change:    '#ffaa00',
  approval_decided:   '#66aaff',
}

function fmt(ts: number): string {
  return new Date(ts).toLocaleString('sv-SE').replace('T', ' ')
}

function EventBadge({ type }: { type: string }) {
  const color = EVENT_COLORS[type] ?? '#9a9a9a'
  return (
    <span style={{ color, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{type}</span>
  )
}

function ActorBadge({ actorType, actorId }: { actorType: string; actorId: string }) {
  const color = actorType === 'system' ? 'var(--dim)' : actorType === 'user' ? '#66aaff' : '#ffaa00'
  return (
    <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
      <span style={{ color, opacity: 0.7 }}>{actorType}/</span>
      <span style={{ color }}>{actorId}</span>
    </span>
  )
}

function DetailCell({ detail }: { detail: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  const keys = Object.keys(detail)
  if (!keys.length) return <span style={{ color: 'var(--dim)', fontSize: 11 }}>—</span>
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ background: 'none', border: 'none', color: '#9a9a9a', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', padding: 0, textDecoration: 'underline dotted' }}
      >
        {keys.join(', ')}
      </button>
    )
  }
  return (
    <pre
      onClick={() => setOpen(false)}
      style={{ margin: 0, fontSize: 10, color: 'var(--text)', background: 'var(--card)', border: '1px solid var(--border)', padding: '4px 6px', borderRadius: 3, cursor: 'pointer', maxWidth: 320, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
    >
      {JSON.stringify(detail, null, 2)}
    </pre>
  )
}

const PAGE = 100

export default function AuditClient() {
  const [entries,  setEntries]  = useState<AuditEntry[]>([])
  const [chain,    setChain]    = useState<ChainStatus | null>(null)
  const [offset,   setOffset]   = useState(0)
  const [hasMore,  setHasMore]  = useState(false)
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState('')

  const load = useCallback(async (off: number, append: boolean) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/audit-log?limit=${PAGE + 1}&offset=${off}`)
      if (!res.ok) return
      const data: AuditEntry[] = await res.json()
      const page = data.slice(0, PAGE)
      setHasMore(data.length > PAGE)
      setEntries((prev) => append ? [...prev, ...page] : page)
      setOffset(off + page.length)
    } finally {
      setLoading(false)
    }
  }, [])

  const verify = useCallback(async () => {
    setChain(null)
    const res = await fetch('/api/audit-log/verify')
    if (res.ok) setChain(await res.json())
  }, [])

  useEffect(() => { load(0, false); verify() }, [load, verify])

  const filtered = filter
    ? entries.filter((e) => e.eventType.includes(filter) || e.actorId.includes(filter) || e.subject.includes(filter))
    : entries

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px', fontFamily: 'monospace' }}>
      <Nav active="Audit" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--text)', fontSize: 16, fontWeight: 600 }}>Audit Log</h2>
          <div style={{ color: '#9a9a9a', fontSize: 11, marginTop: 4 }}>
            immutable · per-actor · HMAC-SHA256 hash chain
          </div>
        </div>
        {chain && (
          <div style={{
            padding: '6px 14px', borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
            background: chain.ok ? 'rgba(57,255,20,0.08)' : 'rgba(255,68,68,0.1)',
            border: `1px solid ${chain.ok ? '#39ff14' : '#ff4444'}`,
            color: chain.ok ? '#39ff14' : '#ff4444',
          }}>
            {chain.ok
              ? `✓ chain intact · ${chain.total} entries`
              : `✗ chain broken at entry #${chain.firstBrokenId} · ${chain.total} total`}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="filter by event, actor, or subject…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontFamily: 'monospace', fontSize: 12, padding: '6px 10px', width: 300, outline: 'none' }}
        />
        {filter && (
          <button onClick={() => setFilter('')} style={{ background: 'none', border: 'none', color: '#9a9a9a', cursor: 'pointer', fontSize: 12, padding: '4px 8px' }}>
            clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--dim)', fontSize: 11 }}>
          {filtered.length} / {entries.length} entries
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--dim)', textAlign: 'left' }}>
              <th style={{ padding: '4px 8px', width: 24, color: 'var(--dim)', fontWeight: 400 }}>#</th>
              <th style={{ padding: '4px 8px', whiteSpace: 'nowrap', fontWeight: 400 }}>time</th>
              <th style={{ padding: '4px 8px', fontWeight: 400 }}>actor</th>
              <th style={{ padding: '4px 8px', fontWeight: 400 }}>event</th>
              <th style={{ padding: '4px 8px', fontWeight: 400 }}>subject</th>
              <th style={{ padding: '4px 8px', fontWeight: 400 }}>detail</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => (
              <tr
                key={e.id}
                style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(128,128,128,0.04)' }}
              >
                <td style={{ padding: '5px 8px', color: 'var(--dim)', fontSize: 10 }}>{e.id}</td>
                <td style={{ padding: '5px 8px', color: 'var(--muted)', whiteSpace: 'nowrap', fontSize: 11 }}>{fmt(e.timestamp)}</td>
                <td style={{ padding: '5px 8px' }}><ActorBadge actorType={e.actorType} actorId={e.actorId} /></td>
                <td style={{ padding: '5px 8px' }}><EventBadge type={e.eventType} /></td>
                <td style={{ padding: '5px 8px', color: 'var(--text)', fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.subject || '—'}</td>
                <td style={{ padding: '5px 8px' }}><DetailCell detail={e.detail} /></td>
              </tr>
            ))}
            {!loading && !filtered.length && (
              <tr>
                <td colSpan={6} style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--dim)', fontSize: 12 }}>
                  {entries.length ? 'no matches' : 'no audit events yet'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && !filter && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            onClick={() => load(offset, true)}
            disabled={loading}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--muted)', cursor: 'pointer', fontSize: 12, fontFamily: 'monospace', padding: '6px 16px' }}
          >
            {loading ? 'loading…' : 'load more'}
          </button>
        </div>
      )}

      <Footer motto="your sins, recorded." />
    </div>
  )
}
