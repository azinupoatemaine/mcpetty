'use client'

import { useEffect, useState, useCallback } from 'react'
import { Nav, Footer } from './nav'

const S = {
  bg: 'var(--bg)', card: 'var(--card)', border: 'var(--border)', text: 'var(--text)',
  muted: 'var(--muted)', dim: 'var(--dim)', green: 'var(--green)', red: 'var(--red)', yellow: 'var(--yellow)',
}

interface GatewayRecord {
  id:          string
  name:        string
  createdAt:   number
  instanceIds: string[]
}

interface InstalledInstance {
  id:       string
  name:     string
  type:     string
  typeName: string
  tools:    string[]
}

interface OneTimeKey { key: string; gatewayName: string }
interface DupTarget  { id: string; name: string }

// ─── One-time key modal ───────────────────────────────────────────────────────

function OneTimeKeyModal({ otk, onClose }: { otk: OneTimeKey; onClose: () => void }) {
  const [host, setHost]       = useState('<host>')
  const [keyCopied, setKeyCopied] = useState(false)
  const [cmdCopied, setCmdCopied] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') setHost(window.location.hostname)
  }, [])

  const url  = `http://${host}:1234/mcp`
  const cmd  = `claude mcp add ${otk.gatewayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')} ${url} --transport http --header "Authorization: Bearer ${otk.key}"`

  function copy(text: string, setFn: (v: boolean) => void) {
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
    setFn(true)
    setTimeout(() => setFn(false), 2000)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 10, padding: 28, maxWidth: 560, width: '90%' }}>
        <div style={{ color: S.green, fontSize: 14, fontWeight: 'bold', marginBottom: 4 }}>API key created — copy it now</div>
        <div style={{ color: S.muted, fontSize: 12, marginBottom: 20, lineHeight: 1.6 }}>
          This is the only time you&apos;ll see this key. If you lose it, rotate the gateway to get a new one.
        </div>

        <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>Gateway: <span style={{ color: S.muted }}>{otk.gatewayName}</span></div>

        <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5, marginTop: 14 }}>API Key</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: S.bg, border: `1px solid ${S.border}`, borderRadius: 4, padding: '8px 12px', marginBottom: 14 }}>
          <code style={{ flex: 1, color: S.green, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>{otk.key}</code>
          <button onClick={() => copy(otk.key, setKeyCopied)} style={{ background: 'none', border: `1px solid ${S.border}`, color: keyCopied ? S.green : S.dim, fontSize: 10, padding: '3px 10px', cursor: 'pointer', fontFamily: 'monospace', borderRadius: 3, flexShrink: 0 }}>
            {keyCopied ? '✓ copied' : 'copy'}
          </button>
        </div>

        <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>Claude Code command</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: S.bg, border: `1px solid ${S.border}`, borderRadius: 4, padding: '8px 12px', marginBottom: 22 }}>
          <code style={{ flex: 1, color: S.text, fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.6 }}>{cmd}</code>
          <button onClick={() => copy(cmd, setCmdCopied)} style={{ background: 'none', border: `1px solid ${S.border}`, color: cmdCopied ? S.green : S.dim, fontSize: 10, padding: '3px 10px', cursor: 'pointer', fontFamily: 'monospace', borderRadius: 3, flexShrink: 0 }}>
            {cmdCopied ? '✓' : 'copy'}
          </button>
        </div>

        <button onClick={onClose} style={{ background: S.green, color: '#000', border: 'none', padding: '8px 22px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 13, cursor: 'pointer', borderRadius: 4 }}>
          Got it — I&apos;ve saved the key
        </button>
      </div>
    </div>
  )
}

// ─── Per-instance tool panel (within a gateway) ───────────────────────────────

function GatewayToolPanel({ gatewayId, instanceId, tools }: { gatewayId: string; instanceId: string; tools: string[] }) {
  const [open, setOpen]     = useState(false)
  const [filters, setFilters] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const t of tools) init[t] = true
    return init
  })
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const mcpId = `${gatewayId}:${instanceId}`

  useEffect(() => {
    if (!tools.length || !open) return
    fetch(`/api/tool-filters?id=${encodeURIComponent(mcpId)}`)
      .then((r) => r.json())
      .then((data: Record<string, boolean>) => {
        setFilters((prev) => {
          const next = { ...prev }
          for (const t of tools) { if (t in data) next[t] = data[t] }
          return next
        })
      })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true)
    await fetch('/api/tool-filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: mcpId, filters, clearFirst: true }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function toggle(name: string) { setFilters((p) => ({ ...p, [name]: !p[name] })) }
  function setAll(v: boolean) {
    const next: Record<string, boolean> = {}
    for (const t of tools) next[t] = v
    setFilters(next)
  }

  if (!tools.length) return null
  const enabledCount = Object.values(filters).filter(Boolean).length

  return (
    <div style={{ marginTop: 8, borderTop: `1px solid ${S.border}`, paddingTop: 8 }}>
      <button onClick={() => setOpen(!open)} style={{ background: 'none', border: 'none', color: S.dim, fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        {open ? '▼' : '▶'} tool access
        <span style={{ color: enabledCount === tools.length ? S.green : S.yellow, fontSize: 10 }}>
          {enabledCount}/{tools.length} enabled
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['all', 'none'] as const).map((v) => (
              <button key={v} onClick={() => setAll(v === 'all')} style={{ background: 'none', border: `1px solid ${S.border}`, borderRadius: 3, color: S.dim, fontSize: 10, padding: '1px 8px', cursor: 'pointer', fontFamily: 'monospace' }}>{v}</button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10, maxHeight: 200, overflowY: 'auto' }}>
            {tools.map((name) => {
              const on = filters[name] !== false
              return (
                <div key={name} onClick={() => toggle(name)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '3px 6px', borderRadius: 3, background: on ? 'var(--tint-green-bg)' : S.card, border: `1px solid ${on ? 'var(--tint-green-border)' : S.border}` }}>
                  <div style={{ width: 12, height: 12, flexShrink: 0, border: `1px solid ${on ? S.green : S.border}`, background: on ? S.green : 'transparent', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <span style={{ color: '#000', fontSize: 8, fontWeight: 'bold', lineHeight: 1 }}>✓</span>}
                  </div>
                  <span style={{ color: on ? S.green : S.dim, fontSize: 11, fontFamily: 'monospace' }}>{name}</span>
                </div>
              )
            })}
          </div>
          <button onClick={save} disabled={saving} style={{ background: saved ? 'var(--tint-green-bg)' : S.green, color: saved ? S.green : '#000', border: saved ? `1px solid ${S.green}` : 'none', padding: '4px 14px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 11, cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 3 }}>
            {saved ? '✓ saved' : saving ? 'saving...' : 'save'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Gateway card ─────────────────────────────────────────────────────────────

function GatewayCard({
  gw, allInstances, onChanged, onKeyRevealed,
}: {
  gw: GatewayRecord
  allInstances: InstalledInstance[]
  onChanged: () => void
  onKeyRevealed: (otk: OneTimeKey) => void
}) {
  const [expanded, setExpanded]   = useState(false)
  const [renaming, setRenaming]   = useState(false)
  const [newName, setNewName]     = useState(gw.name)
  const [assigned, setAssigned]   = useState<string[]>(gw.instanceIds)
  const [savingInst, setSavingInst] = useState(false)
  const [savedInst,  setSavedInst]  = useState(false)
  const [dupName,    setDupName]    = useState(`${gw.name} copy`)
  const [dupOpen,    setDupOpen]    = useState(false)

  async function rename() {
    if (!newName.trim() || newName.trim() === gw.name) { setRenaming(false); return }
    await fetch('/api/gateways', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: gw.id, name: newName.trim() }),
    })
    setRenaming(false)
    onChanged()
  }

  async function rotate() {
    const res  = await fetch('/api/gateways/rotate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: gw.id }) })
    const data = await res.json()
    onKeyRevealed({ key: data.key, gatewayName: gw.name })
  }

  async function del() {
    if (!confirm(`Delete gateway "${gw.name}"? Any clients using this key will lose access.`)) return
    await fetch(`/api/gateways?id=${gw.id}`, { method: 'DELETE' })
    onChanged()
  }

  async function duplicate() {
    if (!dupName.trim()) return
    setDupOpen(false)
    const res  = await fetch('/api/gateways/duplicate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: gw.id, name: dupName.trim() }) })
    const data = await res.json()
    onKeyRevealed({ key: data.key, gatewayName: dupName.trim() })
    onChanged()
  }

  async function saveInstances() {
    setSavingInst(true)
    await fetch('/api/gateways/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: gw.id, instanceIds: assigned }),
    })
    setSavingInst(false); setSavedInst(true)
    setTimeout(() => setSavedInst(false), 2000)
    onChanged()
  }

  function toggleInstance(instId: string) {
    setAssigned((prev) => prev.includes(instId) ? prev.filter((x) => x !== instId) : [...prev, instId])
  }

  const btnStyle = (color: string): React.CSSProperties => ({
    background: 'none', border: `1px solid ${S.border}`, color, fontSize: 10, padding: '2px 10px', cursor: 'pointer', fontFamily: 'monospace', borderRadius: 3,
  })

  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 18, marginBottom: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: expanded ? 14 : 0 }}>
        <div style={{ flex: 1 }}>
          {renaming ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setRenaming(false) }}
                style={{ background: S.bg, border: `1px solid ${S.border}`, color: S.text, padding: '3px 8px', fontFamily: 'monospace', fontSize: 13, borderRadius: 3, outline: 'none' }}
              />
              <button onClick={rename} style={{ ...btnStyle(S.green), borderColor: 'var(--tint-green-border)' }}>save</button>
              <button onClick={() => { setRenaming(false); setNewName(gw.name) }} style={btnStyle(S.dim)}>cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: S.text, fontWeight: 'bold', fontSize: 14 }}>{gw.name}</span>
              <button onClick={() => setRenaming(true)} style={{ background: 'none', border: 'none', color: S.dim, fontSize: 10, cursor: 'pointer', fontFamily: 'monospace', padding: '0 2px' }}>rename</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 14, marginTop: 3 }}>
            <span style={{ color: S.dim, fontSize: 10, fontFamily: 'monospace' }}>id: {gw.id}</span>
            <span style={{ color: S.dim, fontSize: 10 }}>created {new Date(gw.createdAt).toLocaleDateString()}</span>
            <span style={{ color: gw.instanceIds.length > 0 ? S.muted : S.dim, fontSize: 10 }}>
              {gw.instanceIds.length} instance{gw.instanceIds.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <button onClick={() => setExpanded(!expanded)} style={{ ...btnStyle(S.dim), borderColor: S.border }}>
            {expanded ? 'collapse' : 'configure'}
          </button>

          {/* Duplicate */}
          {dupOpen ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                autoFocus
                value={dupName}
                onChange={(e) => setDupName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') duplicate(); if (e.key === 'Escape') setDupOpen(false) }}
                placeholder="name for copy"
                style={{ background: S.bg, border: `1px solid ${S.border}`, color: S.text, padding: '2px 7px', fontFamily: 'monospace', fontSize: 11, borderRadius: 3, outline: 'none', width: 130 }}
              />
              <button onClick={duplicate} style={{ ...btnStyle(S.green), borderColor: 'var(--tint-green-border)' }}>go</button>
              <button onClick={() => setDupOpen(false)} style={btnStyle(S.dim)}>✕</button>
            </div>
          ) : (
            <button onClick={() => setDupOpen(true)} style={btnStyle(S.muted)}>duplicate</button>
          )}

          <button onClick={rotate} style={btnStyle(S.yellow)}>rotate key</button>
          <button onClick={del} style={btnStyle(S.red)}>delete</button>
        </div>
      </div>

      {/* Expanded: instance picker + per-instance tool filters */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 14 }}>
          <div style={{ color: S.muted, fontSize: 11, marginBottom: 10 }}>Select which MCP instances this gateway can access:</div>

          {allInstances.length === 0 ? (
            <div style={{ color: S.dim, fontSize: 12 }}>No instances installed. Go to Library to add some.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {allInstances.map((inst) => {
                const on = assigned.includes(inst.id)
                return (
                  <div key={inst.id} style={{ border: `1px solid ${on ? 'var(--tint-green-border)' : S.border}`, borderRadius: 5, padding: '8px 12px', background: on ? 'var(--tint-green-bg)' : S.card }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => toggleInstance(inst.id)}>
                      <div style={{ width: 14, height: 14, flexShrink: 0, border: `1px solid ${on ? S.green : S.border}`, background: on ? S.green : 'transparent', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {on && <span style={{ color: '#000', fontSize: 9, fontWeight: 'bold', lineHeight: 1 }}>✓</span>}
                      </div>
                      <span style={{ color: on ? S.text : S.muted, fontSize: 13, fontFamily: 'monospace', fontWeight: on ? 'bold' : 'normal' }}>{inst.name}</span>
                      <span style={{ color: S.dim, fontSize: 10 }}>{inst.typeName} · {inst.tools.length} tools</span>
                    </div>
                    {on && (
                      <GatewayToolPanel gatewayId={gw.id} instanceId={inst.id} tools={inst.tools} />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button
              onClick={saveInstances}
              disabled={savingInst}
              style={{ background: savedInst ? 'var(--tint-green-bg)' : S.green, color: savedInst ? S.green : '#000', border: savedInst ? `1px solid ${S.green}` : 'none', padding: '6px 18px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 12, cursor: savingInst ? 'not-allowed' : 'pointer', borderRadius: 4 }}
            >
              {savedInst ? '✓ saved' : savingInst ? 'saving...' : 'save instance access'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Create form ──────────────────────────────────────────────────────────────

function CreateForm({ allInstances, onCreated, onCancel }: { allInstances: InstalledInstance[]; onCreated: (otk: OneTimeKey) => void; onCancel: () => void }) {
  const [name, setName]       = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  function toggle(id: string) {
    setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])
  }

  async function create() {
    if (!name.trim()) { setError('Name required'); return }
    setSaving(true); setError(null)
    const res  = await fetch('/api/gateways', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), instanceIds: selected }),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setSaving(false); return }
    onCreated({ key: data.key, gatewayName: data.name })
  }

  const inputStyle: React.CSSProperties = {
    background: S.bg, border: `1px solid ${S.border}`, color: S.text,
    padding: '6px 10px', fontFamily: 'monospace', fontSize: 13, borderRadius: 4, outline: 'none',
  }

  return (
    <div style={{ background: 'var(--info-box-bg)', border: `1px solid var(--info-box-border)`, borderRadius: 8, padding: 18, marginBottom: 20 }}>
      <div style={{ color: S.green, fontSize: 13, fontWeight: 'bold', marginBottom: 14 }}>New gateway</div>
      {error && <div style={{ color: S.red, fontSize: 12, marginBottom: 10 }}>{error}</div>}

      <div style={{ marginBottom: 14 }}>
        <div style={{ color: S.muted, fontSize: 11, marginBottom: 5 }}>Name <span style={{ color: S.red }}>*</span></div>
        <input
          autoFocus
          type="text"
          placeholder="e.g. Claude Production, Mobile App, Partner API"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create() }}
          style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
        />
      </div>

      {allInstances.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: S.muted, fontSize: 11, marginBottom: 8 }}>Instance access (can change later):</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {allInstances.map((inst) => {
              const on = selected.includes(inst.id)
              return (
                <div key={inst.id} onClick={() => toggle(inst.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '5px 8px', borderRadius: 4, background: on ? 'var(--tint-green-bg)' : S.card, border: `1px solid ${on ? 'var(--tint-green-border)' : S.border}` }}>
                  <div style={{ width: 13, height: 13, flexShrink: 0, border: `1px solid ${on ? S.green : S.border}`, background: on ? S.green : 'transparent', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <span style={{ color: '#000', fontSize: 8, fontWeight: 'bold', lineHeight: 1 }}>✓</span>}
                  </div>
                  <span style={{ color: on ? S.text : S.muted, fontSize: 12, fontFamily: 'monospace' }}>{inst.name}</span>
                  <span style={{ color: S.dim, fontSize: 10 }}>{inst.typeName}</span>
                </div>
              )
            })}
          </div>
          <div style={{ color: S.dim, fontSize: 10, marginTop: 6 }}>Leave empty to grant access to all instances (same as master key scope).</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={create} disabled={saving} style={{ background: S.green, color: '#000', border: 'none', padding: '7px 18px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 4 }}>
          {saving ? 'Creating...' : 'Create gateway'}
        </button>
        <button onClick={onCancel} style={{ background: 'none', border: `1px solid ${S.border}`, color: S.dim, padding: '7px 12px', fontFamily: 'monospace', fontSize: 13, cursor: 'pointer', borderRadius: 4 }}>cancel</button>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function GatewaysClient() {
  const [gateways, setGateways]     = useState<GatewayRecord[]>([])
  const [allInstances, setAllInst]  = useState<InstalledInstance[]>([])
  const [loading, setLoading]       = useState(true)
  const [creating, setCreating]     = useState(false)
  const [oneTimeKey, setOneTimeKey] = useState<OneTimeKey | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [gwRes, libRes] = await Promise.all([
      fetch('/api/gateways'),
      fetch('/api/library'),
    ])
    const gws     = await gwRes.json()
    const catalog = await libRes.json()

    setGateways(gws)
    setAllInst(
      catalog.flatMap((entry: { id: string; name: string; tools: Array<{ name: string }>; instances: Array<{ instanceId: string; name: string }> }) =>
        entry.instances.map((inst) => ({
          id: inst.instanceId, name: inst.name,
          type: entry.id, typeName: entry.name,
          tools: entry.tools.map((t) => t.name),
        }))
      )
    )
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function handleCreated(otk: OneTimeKey) {
    setCreating(false)
    setOneTimeKey(otk)
    load()
  }

  return (
    <div style={{ minHeight: '100vh', padding: '32px 24px', maxWidth: 900, margin: '0 auto', fontFamily: 'monospace' }}>
      <Nav active="Gateways" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <div style={{ color: S.text, fontSize: 18, fontWeight: 'bold' }}>Gateways</div>
          <div style={{ color: S.dim, fontSize: 12, marginTop: 2 }}>
            {gateways.length} gateway{gateways.length !== 1 ? 's' : ''} — each with its own API key and scoped instance access
          </div>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            style={{ background: 'var(--tint-green-bg)', border: '1px solid var(--tint-green-border)', color: S.green, fontSize: 12, padding: '7px 16px', cursor: 'pointer', fontFamily: 'monospace', borderRadius: 4 }}
          >
            + new gateway
          </button>
        )}
      </div>

      {creating && (
        <CreateForm allInstances={allInstances} onCreated={handleCreated} onCancel={() => setCreating(false)} />
      )}

      {loading ? (
        <div style={{ color: S.dim, textAlign: 'center', paddingTop: 60 }}>Loading...</div>
      ) : gateways.length === 0 && !creating ? (
        <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 32, textAlign: 'center' }}>
          <div style={{ color: S.muted, fontSize: 14, marginBottom: 8 }}>No additional gateways configured.</div>
          <div style={{ color: S.dim, fontSize: 12, lineHeight: 1.8 }}>
            The master gateway key on the Dashboard gives full access to all MCPs — it&apos;s always available.<br />
            Create a scoped gateway here when you need to share limited access with an app or another Claude instance.
          </div>
        </div>
      ) : (
        gateways.map((gw) => (
          <GatewayCard
            key={gw.id}
            gw={gw}
            allInstances={allInstances}
            onChanged={load}
            onKeyRevealed={setOneTimeKey}
          />
        ))
      )}

      <Footer motto="least privilege, finally" />

      {oneTimeKey && <OneTimeKeyModal otk={oneTimeKey} onClose={() => setOneTimeKey(null)} />}
    </div>
  )
}
