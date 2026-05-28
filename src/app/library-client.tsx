'use client'

import { useEffect, useState, useCallback } from 'react'
import { Nav, Footer } from './nav'
import { S } from './styles'
import { useAnon } from './anon'

interface CatalogCredential {
  key: string; label: string; description: string; type: 'url' | 'secret' | 'text'; required: boolean
}

interface InstanceRecord {
  instanceId: string; name: string; installedAt: number
  credentials: Array<CatalogCredential & { isSet: boolean; updatedAt: number | null }>
}

interface ToolMeta { name: string; description?: string }

interface CatalogEntry {
  id: string; name: string; description: string; transport: string
  credentials: CatalogCredential[]
  instances: InstanceRecord[]
  tools: ToolMeta[]
}

function InstanceRow({ inst, index, onUninstall }: { inst: InstanceRecord; index: number; onUninstall: () => void }) {
  const anon = useAnon()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${S.border}` }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: S.green, display: 'inline-block', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <span style={{ color: S.text, fontSize: 13, fontFamily: 'monospace' }}>{anon ? `Instance ${index + 1}` : inst.name}</span>
        <span style={{ color: S.dim, fontSize: 11, marginLeft: 10, fontFamily: 'monospace' }}>{anon ? `mcp-${index + 1}` : inst.instanceId}</span>
      </div>
      <span style={{ color: S.dim, fontSize: 11 }}>since {new Date(inst.installedAt).toLocaleDateString()}</span>
      <button
        onClick={onUninstall}
        className="btn-danger"
        style={{ fontSize: 11, padding: '2px 8px' }}
      >uninstall</button>
    </div>
  )
}

function TypeToolDefaults({ typeId, tools }: { typeId: string; tools: ToolMeta[] }) {
  const [open, setOpen]     = useState(false)
  const [filters, setFilters] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const t of tools) init[t.name] = true
    return init
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  useEffect(() => {
    if (!tools.length) return
    fetch(`/api/tool-filters?id=${typeId}`)
      .then((r) => r.json())
      .then((data: Record<string, boolean>) => {
        setFilters((prev) => {
          const next = { ...prev }
          for (const t of tools) { if (t.name in data) next[t.name] = data[t.name] }
          return next
        })
      })
  }, [typeId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true)
    await fetch('/api/tool-filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: typeId, filters, clearFirst: true }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function toggle(name: string) { setFilters((p) => ({ ...p, [name]: !p[name] })) }
  function setAll(v: boolean) {
    const next: Record<string, boolean> = {}
    for (const t of tools) next[t.name] = v
    setFilters(next)
  }

  if (!tools.length) return null
  const enabledCount = Object.values(filters).filter(Boolean).length

  return (
    <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 10, marginTop: 14 }}>
      <button onClick={() => setOpen(!open)} style={{ background: 'none', border: 'none', color: S.dim, fontSize: 12, cursor: 'pointer', fontFamily: 'monospace', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        {open ? '▼' : '▶'} default tool access
        <span style={{ color: enabledCount === tools.length ? S.green : S.yellow, fontSize: 11 }}>
          {enabledCount}/{tools.length} enabled for all instances
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ color: S.dim, fontSize: 11, marginBottom: 10, lineHeight: 1.5 }}>
            Global defaults — applies to every instance of this type unless overridden in the Dashboard card.
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {(['all', 'none'] as const).map((v) => (
              <button key={v} onClick={() => setAll(v === 'all')} style={{ background: 'none', border: `1px solid ${S.border}`, borderRadius: 3, color: S.dim, fontSize: 11, padding: '2px 10px', cursor: 'pointer', fontFamily: 'monospace' }}>{v}</button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14, maxHeight: 360, overflowY: 'auto' }}>
            {tools.map((tool) => {
              const on = filters[tool.name] !== false
              return (
                <div key={tool.name} onClick={() => toggle(tool.name)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '6px 8px', borderRadius: 4, background: on ? 'var(--tint-green-bg)' : S.card, border: `1px solid ${on ? 'var(--tint-green-border)' : S.border}` }}>
                  <div style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, border: `1px solid ${on ? S.green : S.border}`, background: on ? S.green : 'transparent', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <span style={{ color: '#000', fontSize: 9, fontWeight: 'bold', lineHeight: 1 }}>✓</span>}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ color: on ? S.green : S.dim, fontSize: 12, fontFamily: 'monospace', fontWeight: 'bold' }}>{tool.name}</span>
                    {tool.description && <div style={{ color: on ? S.muted : S.dim, fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>{tool.description}</div>}
                  </div>
                </div>
              )
            })}
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="btn-primary"
            style={{ background: saved ? 'var(--tint-green-bg)' : S.green, color: saved ? S.green : '#000', border: saved ? `1px solid ${S.green}` : undefined, padding: '6px 20px', fontSize: 12 }}
          >
            {saved ? '✓ saved' : saving ? 'saving...' : 'save defaults'}
          </button>
        </div>
      )}
    </div>
  )
}

function CatalogCard({ entry, onChanged }: { entry: CatalogEntry; onChanged: () => void }) {
  const [open, setOpen]       = useState(false)
  const [form, setForm]       = useState<Record<string, string>>({})
  const [name, setName]       = useState('')
  const [slug, setSlug]       = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  function onNameChange(v: string) {
    setName(v)
    if (!slugEdited) setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
  }

  function onSlugChange(v: string) {
    setSlug(v.toLowerCase().replace(/[^a-z0-9-]+/g, ''))
    setSlugEdited(true)
  }

  async function install() {
    if (!name.trim()) { setError('Name is required'); return }
    if (!slug.trim()) { setError('Instance ID is required'); return }
    setSaving(true); setError(null)
    const res = await fetch('/api/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: entry.id, instanceName: name.trim(), instanceId: slug.trim(), credentials: form }),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setSaving(false); return }
    setOpen(false); setForm({}); setName(''); setSlug(''); setSlugEdited(false); setSaving(false)
    onChanged()
  }

  async function uninstall(instanceId: string, displayName: string) {
    const answer = window.prompt(`Type "yes" to uninstall "${displayName}". All credentials will be deleted and this cannot be undone.`)
    if (answer?.toLowerCase() !== 'yes') return
    const res = await fetch(`/api/library?instanceId=${encodeURIComponent(instanceId)}`, { method: 'DELETE' })
    if (!res.ok) { alert('Uninstall failed — check the console.'); return }
    onChanged()
  }

  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: entry.instances.length > 0 ? 14 : 0 }}>
        <div>
          <div style={{ color: S.text, fontWeight: 'bold', fontSize: 15 }}>{entry.name}</div>
          <div style={{ color: S.muted, fontSize: 12, marginTop: 3 }}>{entry.description}</div>
        </div>
        <button
          onClick={() => { setOpen(!open); setError(null) }}
          style={{ background: 'var(--tint-green-bg)', border: '1px solid var(--tint-green-border)', color: S.green, fontSize: 12, padding: '6px 14px', cursor: 'pointer', fontFamily: 'monospace', borderRadius: 4, flexShrink: 0, marginLeft: 16 }}
        >
          + add instance
        </button>
      </div>

      {/* Installed instances */}
      {entry.instances.map((inst, idx) => (
        <InstanceRow key={inst.instanceId} inst={inst} index={idx} onUninstall={() => uninstall(inst.instanceId, inst.name)} />
      ))}

      {/* Global tool defaults */}
      {entry.transport === 'http-proxy' ? (
        entry.instances.length > 0 && (
          <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 10, marginTop: 14, color: S.dim, fontSize: 11, lineHeight: 1.5 }}>
            Tools are fetched live from the external server — use the Dashboard or Gateways to configure per-instance access.
          </div>
        )
      ) : (
        <TypeToolDefaults typeId={entry.id} tools={entry.tools} />
      )}

      {/* Add form */}
      {open && (
        <div style={{ marginTop: 16, background: S.bg, border: `1px solid ${S.border}`, borderRadius: 6, padding: 14 }}>
          {error && <div style={{ color: S.red, fontSize: 12, marginBottom: 10 }}>{error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ color: S.muted, fontSize: 11, marginBottom: 5 }}>Display name <span style={{ color: S.red }}>*</span></div>
              <input type="text" placeholder="e.g. Production" value={name} onChange={(e) => onNameChange(e.target.value)} className="input" style={{ width: '100%', padding: '6px 10px', fontSize: 13, boxSizing: 'border-box' as const }} />
            </div>
            <div>
              <div style={{ color: S.muted, fontSize: 11, marginBottom: 5 }}>
                Instance ID <span style={{ color: S.red }}>*</span>
                <span style={{ color: S.dim, marginLeft: 6 }}>— used as tool name in Claude</span>
              </div>
              <input
                type="text"
                placeholder="e.g. prod"
                value={slug}
                onChange={(e) => onSlugChange(e.target.value)}
                className="input"
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, color: S.green, boxSizing: 'border-box' as const }}
              />
            </div>
          </div>

          {entry.credentials.map((cred) => (
            <div key={cred.key} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, marginBottom: 5 }}>
                <span style={{ color: S.muted }}>{cred.label}</span>
                {cred.required && <span style={{ color: S.red, marginLeft: 4 }}>*</span>}
                <span style={{ color: S.dim, marginLeft: 8 }}>{cred.description}</span>
              </div>
              <input
                type={cred.type === 'secret' ? 'password' : 'text'}
                autoComplete="new-password"
                placeholder={cred.key}
                value={form[cred.key] ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, [cred.key]: e.target.value }))}
                className="input"
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, boxSizing: 'border-box' as const }}
              />
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={install} disabled={saving} className="btn-primary" style={{ padding: '7px 18px', fontSize: 13 }}>
              {saving ? 'Installing...' : 'Install'}
            </button>
            <button onClick={() => { setOpen(false); setError(null) }} className="btn" style={{ padding: '7px 12px', fontSize: 13 }}>cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function LibraryClient() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/library')
    setCatalog(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const totalInstalled = catalog.reduce((s, e) => s + e.instances.length, 0)

  return (
    <div style={{ minHeight: '100vh', padding: '32px 24px', maxWidth: 900, margin: '0 auto', fontFamily: 'monospace' }}>
      <Nav active="Library" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <div style={{ color: S.text, fontSize: 18, fontWeight: 'bold' }}>Library</div>
          <div style={{ color: S.dim, fontSize: 12, marginTop: 2 }}>
            {totalInstalled} instance{totalInstalled !== 1 ? 's' : ''} installed across {catalog.length} MCP type{catalog.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ color: S.dim, textAlign: 'center', paddingTop: 60 }}>Loading...</div>
      ) : (
        catalog.map((entry) => <CatalogCard key={entry.id} entry={entry} onChanged={load} />)
      )}

      <Footer motto="your config, your problem" />
    </div>
  )
}
