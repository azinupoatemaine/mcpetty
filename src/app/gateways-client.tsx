'use client'

import { useEffect, useState, useCallback } from 'react'
import { Nav, Footer } from './nav'
import { S } from './styles'

interface NamespaceKey   { id: string; label: string; createdAt: number }
interface NamespaceRecord {
  id:          string
  name:        string
  createdAt:   number
  instanceIds: string[]
  keys:        NamespaceKey[]
  middleware:  Record<string, unknown>
}

interface InstalledInstance {
  id:       string
  name:     string
  type:     string
  typeName: string
  tools:    string[]
}

interface OneTimeKey { key: string; namespaceName: string; slug: string }

// ─── Copy helper ──────────────────────────────────────────────────────────────

function copyText(text: string) {
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
}

// ─── One-time key modal ───────────────────────────────────────────────────────

function OneTimeKeyModal({ otk, onClose }: { otk: OneTimeKey; onClose: () => void }) {
  const [host, setHost]       = useState('<host>')
  const [keyCopied, setKeyCopied] = useState(false)
  const [cmdCopied, setCmdCopied] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') setHost(window.location.hostname)
  }, [])

  const url = `http://${host}:1234/mcp/${otk.slug}`
  const cmd = `claude mcp add ${otk.slug} ${url} --transport http --header "Authorization: Bearer ${otk.key}"`

  function copy(text: string, setFn: (v: boolean) => void) {
    copyText(text); setFn(true); setTimeout(() => setFn(false), 2000)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 10, padding: 28, maxWidth: 580, width: '90%' }}>
        <div style={{ color: S.green, fontSize: 14, fontWeight: 'bold', marginBottom: 4 }}>API key created — copy it now</div>
        <div style={{ color: S.muted, fontSize: 12, marginBottom: 20, lineHeight: 1.6 }}>
          This is the only time you&apos;ll see this key. Lose it and you&apos;ll have to add a new one.
        </div>

        <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>
          Namespace: <span style={{ color: S.muted }}>{otk.namespaceName}</span> · endpoint: <span style={{ color: S.muted }}>
            /mcp/{otk.slug}
          </span>
        </div>

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

// ─── Tool panel (per-instance within a namespace) ─────────────────────────────

function NamespaceToolPanel({ namespaceId, instanceId, tools }: { namespaceId: string; instanceId: string; tools: string[] }) {
  const [open, setOpen]       = useState(false)
  const [filters, setFilters] = useState<Record<string, boolean>>(() => Object.fromEntries(tools.map((t) => [t, true])))
  const [saving, setSaving]   = useState(false)
  const [saved,  setSaved]    = useState(false)

  useEffect(() => {
    if (!tools.length || !open) return
    fetch(`/api/namespaces/${encodeURIComponent(namespaceId)}/${encodeURIComponent(instanceId)}/tool-filters`)
      .then((r) => r.ok ? r.json() : {})
      .then((data: Record<string, boolean>) => {
        setFilters((prev) => {
          const next = { ...prev }
          for (const t of tools) if (t in data) next[t] = data[t]
          return next
        })
      })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true)
    await fetch(`/api/namespaces/${encodeURIComponent(namespaceId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_tool_filters', instanceId, filters }),
    })
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  function toggle(name: string) { setFilters((p) => ({ ...p, [name]: !p[name] })) }
  function setAll(v: boolean)   { setFilters(Object.fromEntries(tools.map((t) => [t, v]))) }

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

// ─── Namespace card ───────────────────────────────────────────────────────────

function NamespaceCard({
  ns, allInstances, onChanged, onKeyRevealed,
}: {
  ns:            NamespaceRecord
  allInstances:  InstalledInstance[]
  onChanged:     () => void
  onKeyRevealed: (otk: OneTimeKey) => void
}) {
  const [expanded, setExpanded]   = useState(false)
  const [renaming, setRenaming]   = useState(false)
  const [newName, setNewName]     = useState(ns.name)
  const [assigned, setAssigned]   = useState<string[]>(ns.instanceIds)
  const [savingInst, setSavingInst] = useState(false)
  const [savedInst,  setSavedInst]  = useState(false)
  const [ctxText, setCtxText]     = useState((ns.middleware.context_prefix as { text?: string } | undefined)?.text ?? '')
  const [ctxSaving, setCtxSaving] = useState(false)
  const [ctxSaved,  setCtxSaved]  = useState(false)
  const [rlMax, setRlMax]         = useState(String((ns.middleware.rate_limit as { max_calls?: number } | undefined)?.max_calls ?? ''))
  const [rlWin, setRlWin]         = useState(String((ns.middleware.rate_limit as { window_secs?: number } | undefined)?.window_secs ?? '60'))
  const [rlSaving, setRlSaving]   = useState(false)
  const [rlSaved,  setRlSaved]    = useState(false)
  const [addingKey, setAddingKey] = useState(false)
  const [keyLabel, setKeyLabel]   = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [host, setHost]           = useState('<host>')
  const [cmdCopied, setCmdCopied] = useState(false)

  useEffect(() => { if (typeof window !== 'undefined') setHost(window.location.hostname) }, [])

  const endpoint = `http://${host}:1234/mcp/${ns.id}`

  async function rename() {
    if (!newName.trim() || newName.trim() === ns.name) { setRenaming(false); return }
    await fetch(`/api/namespaces/${ns.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
    setRenaming(false); onChanged()
  }

  async function del() {
    if (!confirm(`Delete namespace "${ns.name}"? All keys will stop working immediately.`)) return
    await fetch(`/api/namespaces/${ns.id}`, { method: 'DELETE' })
    onChanged()
  }

  async function addKey() {
    setKeySaving(true)
    const res  = await fetch(`/api/namespaces/${ns.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_key', label: keyLabel.trim() }),
    })
    const data = await res.json()
    setKeySaving(false); setAddingKey(false); setKeyLabel('')
    onKeyRevealed({ key: data.key, namespaceName: ns.name, slug: ns.id })
    onChanged()
  }

  async function deleteKey(keyId: string, label: string) {
    if (!confirm(`Revoke key "${label || keyId}"? Clients using it will lose access.`)) return
    await fetch(`/api/namespaces/${ns.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_key', keyId }),
    })
    onChanged()
  }

  async function saveInstances() {
    setSavingInst(true)
    await fetch(`/api/namespaces/${ns.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_servers', instanceIds: assigned }),
    })
    setSavingInst(false); setSavedInst(true); setTimeout(() => setSavedInst(false), 2000); onChanged()
  }

  async function saveCtxPrefix() {
    setCtxSaving(true)
    await fetch(`/api/namespaces/${ns.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_middleware', type: 'context_prefix', config: { text: ctxText } }),
    })
    setCtxSaving(false); setCtxSaved(true); setTimeout(() => setCtxSaved(false), 2000)
  }

  async function saveRateLimit() {
    setRlSaving(true)
    const max = parseInt(rlMax, 10)
    const win = parseInt(rlWin, 10)
    await fetch(`/api/namespaces/${ns.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_middleware', type: 'rate_limit', config: rlMax ? { max_calls: max, window_secs: win || 60 } : {} }),
    })
    setRlSaving(false); setRlSaved(true); setTimeout(() => setRlSaved(false), 2000)
  }

  function toggleInstance(instId: string) {
    setAssigned((prev) => prev.includes(instId) ? prev.filter((x) => x !== instId) : [...prev, instId])
  }

  const btn = (color: string): React.CSSProperties => ({
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
                autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') { setRenaming(false); setNewName(ns.name) } }}
                style={{ background: S.bg, border: `1px solid ${S.border}`, color: S.text, padding: '3px 8px', fontFamily: 'monospace', fontSize: 13, borderRadius: 3, outline: 'none' }}
              />
              <button onClick={rename} style={{ ...btn(S.green), borderColor: 'var(--tint-green-border)' }}>save</button>
              <button onClick={() => { setRenaming(false); setNewName(ns.name) }} style={btn(S.dim)}>cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: S.text, fontWeight: 'bold', fontSize: 14 }}>{ns.name}</span>
              <button onClick={() => setRenaming(true)} style={{ background: 'none', border: 'none', color: S.dim, fontSize: 10, cursor: 'pointer', fontFamily: 'monospace', padding: '0 2px' }}>rename</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 14, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: S.dim, fontSize: 10, fontFamily: 'monospace' }}>/mcp/{ns.id}</span>
            <span style={{ color: ns.keys.length > 0 ? S.muted : S.yellow, fontSize: 10 }}>
              {ns.keys.length} key{ns.keys.length !== 1 ? 's' : ''}
            </span>
            <span style={{ color: ns.instanceIds.length > 0 ? S.muted : S.dim, fontSize: 10 }}>
              {ns.instanceIds.length} server{ns.instanceIds.length !== 1 ? 's' : ''}
            </span>
            <span style={{ color: S.dim, fontSize: 10 }}>created {new Date(ns.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <button onClick={() => setExpanded(!expanded)} style={btn(S.dim)}>{expanded ? 'collapse' : 'configure'}</button>
          <button onClick={del} style={btn(S.red)}>delete</button>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 16 }}>

          {/* Endpoint */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ color: S.muted, fontSize: 11, marginBottom: 6, fontWeight: 'bold' }}>Endpoint</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: S.bg, border: `1px solid ${S.border}`, borderRadius: 4, padding: '6px 10px', marginBottom: 10 }}>
              <code style={{ flex: 1, color: S.green, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>{endpoint}</code>
              <button onClick={() => copyText(endpoint)} style={{ ...btn(S.dim), flexShrink: 0 }}>copy</button>
            </div>
            <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Claude Code command</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: S.bg, border: `1px solid ${S.border}`, borderRadius: 4, padding: '7px 10px' }}>
              <code style={{ flex: 1, color: S.text, fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.5 }}>
                {`claude mcp add ${ns.id} ${endpoint} --transport http --header "Authorization: Bearer <key>"`}
              </code>
              <button
                onClick={() => { copyText(`claude mcp add ${ns.id} ${endpoint} --transport http --header "Authorization: Bearer <key>"`); setCmdCopied(true); setTimeout(() => setCmdCopied(false), 2000) }}
                style={{ ...btn(cmdCopied ? S.green : S.dim), flexShrink: 0 }}
              >{cmdCopied ? '✓' : 'copy'}</button>
            </div>
          </div>

          {/* Keys */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ color: S.muted, fontSize: 11, marginBottom: 8, fontWeight: 'bold' }}>API Keys</div>
            {ns.keys.length === 0 && !addingKey && (
              <div style={{ color: S.dim, fontSize: 12, marginBottom: 8 }}>No keys yet — this namespace is unreachable until you add one.</div>
            )}
            {ns.keys.map((k) => (
              <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: `1px solid ${S.border}` }}>
                <span style={{ flex: 1, color: S.muted, fontSize: 12, fontFamily: 'monospace' }}>{k.label || k.id}</span>
                <span style={{ color: S.dim, fontSize: 10 }}>{new Date(k.createdAt).toLocaleDateString()}</span>
                <button onClick={() => deleteKey(k.id, k.label)} style={{ ...btn(S.red), fontSize: 10 }}>revoke</button>
              </div>
            ))}
            {addingKey ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
                <input
                  autoFocus value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} placeholder="label (optional)"
                  onKeyDown={(e) => { if (e.key === 'Enter') addKey(); if (e.key === 'Escape') setAddingKey(false) }}
                  style={{ background: S.bg, border: `1px solid ${S.border}`, color: S.text, padding: '3px 8px', fontFamily: 'monospace', fontSize: 12, borderRadius: 3, outline: 'none', flex: 1 }}
                />
                <button onClick={addKey} disabled={keySaving} style={{ ...btn(S.green), borderColor: 'var(--tint-green-border)' }}>
                  {keySaving ? '...' : 'create'}
                </button>
                <button onClick={() => { setAddingKey(false); setKeyLabel('') }} style={btn(S.dim)}>cancel</button>
              </div>
            ) : (
              <button onClick={() => setAddingKey(true)} style={{ ...btn(S.muted), marginTop: 8 }}>+ add key</button>
            )}
          </div>

          {/* Servers */}
          <div style={{ marginBottom: 18, borderTop: `1px solid ${S.border}`, paddingTop: 14 }}>
            <div style={{ color: S.muted, fontSize: 11, marginBottom: 8, fontWeight: 'bold' }}>Servers</div>
            <div style={{ color: S.dim, fontSize: 11, marginBottom: 10 }}>Which MCP instances this namespace exposes to callers:</div>
            {allInstances.length === 0 ? (
              <div style={{ color: S.dim, fontSize: 12 }}>No instances installed. Go to Library first.</div>
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
                      {on && <NamespaceToolPanel namespaceId={ns.id} instanceId={inst.id} tools={inst.tools} />}
                    </div>
                  )
                })}
              </div>
            )}
            <button
              onClick={saveInstances} disabled={savingInst}
              style={{ marginTop: 10, background: savedInst ? 'var(--tint-green-bg)' : S.green, color: savedInst ? S.green : '#000', border: savedInst ? `1px solid ${S.green}` : 'none', padding: '6px 16px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 12, cursor: savingInst ? 'not-allowed' : 'pointer', borderRadius: 4 }}
            >
              {savedInst ? '✓ saved' : savingInst ? 'saving...' : 'save servers'}
            </button>
          </div>

          {/* Context prefix */}
          <div style={{ marginBottom: 18, borderTop: `1px solid ${S.border}`, paddingTop: 14 }}>
            <div style={{ color: S.muted, fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>Agent context</div>
            <div style={{ color: S.dim, fontSize: 11, marginBottom: 10, lineHeight: 1.5 }}>
              Prepended to every tool response through this namespace. Steers agent behaviour without touching system prompts.
            </div>
            <textarea
              value={ctxText} onChange={(e) => setCtxText(e.target.value)} rows={4}
              placeholder="e.g. This is the PRODUCTION environment. Treat all destructive operations as irreversible."
              style={{ width: '100%', boxSizing: 'border-box', background: S.bg, border: `1px solid ${S.border}`, color: S.text, padding: '8px 10px', fontFamily: 'monospace', fontSize: 12, borderRadius: 4, outline: 'none', resize: 'vertical', lineHeight: 1.5 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <span style={{ color: ctxText.length > 500 ? S.yellow : S.dim, fontSize: 10 }}>
                {ctxText.length} chars · ~{Math.ceil(ctxText.length / 4)} tokens per response
              </span>
              <button onClick={saveCtxPrefix} disabled={ctxSaving} style={{ background: ctxSaved ? 'var(--tint-green-bg)' : S.green, color: ctxSaved ? S.green : '#000', border: ctxSaved ? `1px solid ${S.green}` : 'none', padding: '4px 14px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 11, cursor: ctxSaving ? 'not-allowed' : 'pointer', borderRadius: 3 }}>
                {ctxSaved ? '✓ saved' : ctxSaving ? 'saving...' : 'save'}
              </button>
            </div>
          </div>

          {/* Rate limit */}
          <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 14 }}>
            <div style={{ color: S.muted, fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>Rate limit</div>
            <div style={{ color: S.dim, fontSize: 11, marginBottom: 10 }}>Max tool calls per time window for this namespace. Leave blank to disable.</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number" min="1" value={rlMax} onChange={(e) => setRlMax(e.target.value)} placeholder="max calls"
                style={{ background: S.bg, border: `1px solid ${S.border}`, color: S.text, padding: '4px 8px', fontFamily: 'monospace', fontSize: 12, borderRadius: 3, outline: 'none', width: 90 }}
              />
              <span style={{ color: S.dim, fontSize: 11 }}>per</span>
              <input
                type="number" min="1" value={rlWin} onChange={(e) => setRlWin(e.target.value)} placeholder="seconds"
                style={{ background: S.bg, border: `1px solid ${S.border}`, color: S.text, padding: '4px 8px', fontFamily: 'monospace', fontSize: 12, borderRadius: 3, outline: 'none', width: 80 }}
              />
              <span style={{ color: S.dim, fontSize: 11 }}>seconds</span>
              <button onClick={saveRateLimit} disabled={rlSaving} style={{ background: rlSaved ? 'var(--tint-green-bg)' : S.green, color: rlSaved ? S.green : '#000', border: rlSaved ? `1px solid ${S.green}` : 'none', padding: '4px 12px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 11, cursor: rlSaving ? 'not-allowed' : 'pointer', borderRadius: 3 }}>
                {rlSaved ? '✓' : rlSaving ? '...' : 'save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Create form ──────────────────────────────────────────────────────────────

function CreateForm({ allInstances, onCreated, onCancel }: { allInstances: InstalledInstance[]; onCreated: (ns: NamespaceRecord) => void; onCancel: () => void }) {
  const [name,     setName]     = useState('')
  const [slug,     setSlug]     = useState('')
  const [slugAuto, setSlugAuto] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  function derivedSlug(n: string) { return n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') }

  function onNameChange(v: string) {
    setName(v)
    if (slugAuto) setSlug(derivedSlug(v))
  }

  function onSlugChange(v: string) {
    setSlugAuto(false)
    setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))
  }

  function toggle(id: string) { setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]) }

  async function create() {
    if (!name.trim()) { setError('Name required'); return }
    if (!slug.trim()) { setError('Slug required'); return }
    setSaving(true); setError(null)
    const res  = await fetch('/api/namespaces', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: slug, name: name.trim() }),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setSaving(false); return }
    if (selected.length > 0) {
      await fetch(`/api/namespaces/${data.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_servers', instanceIds: selected }),
      })
    }
    onCreated(data)
  }

  const inputStyle: React.CSSProperties = {
    background: S.bg, border: `1px solid ${S.border}`, color: S.text,
    padding: '6px 10px', fontFamily: 'monospace', fontSize: 13, borderRadius: 4, outline: 'none',
  }

  return (
    <div style={{ background: 'var(--info-box-bg)', border: `1px solid var(--info-box-border)`, borderRadius: 8, padding: 18, marginBottom: 20 }}>
      <div style={{ color: S.green, fontSize: 13, fontWeight: 'bold', marginBottom: 14 }}>New namespace</div>
      {error && <div style={{ color: S.red, fontSize: 12, marginBottom: 10 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 2 }}>
          <div style={{ color: S.muted, fontSize: 11, marginBottom: 5 }}>Name <span style={{ color: S.red }}>*</span></div>
          <input
            autoFocus type="text" placeholder="e.g. Homelab, Production, Dev"
            value={name} onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create() }}
            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: S.muted, fontSize: 11, marginBottom: 5 }}>Slug <span style={{ color: S.red }}>*</span></div>
          <input
            type="text" placeholder="e.g. homelab"
            value={slug} onChange={(e) => onSlugChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create() }}
            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
          />
          {slug && <div style={{ color: S.dim, fontSize: 10, marginTop: 3 }}>endpoint: /mcp/{slug}</div>}
        </div>
      </div>

      {allInstances.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: S.muted, fontSize: 11, marginBottom: 8 }}>Servers (can change later):</div>
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
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={create} disabled={saving} style={{ background: S.green, color: '#000', border: 'none', padding: '7px 18px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 4 }}>
          {saving ? 'Creating...' : 'Create namespace'}
        </button>
        <button onClick={onCancel} style={{ background: 'none', border: `1px solid ${S.border}`, color: S.dim, padding: '7px 12px', fontFamily: 'monospace', fontSize: 13, cursor: 'pointer', borderRadius: 4 }}>cancel</button>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function GatewaysClient() {
  const [namespaces, setNamespaces] = useState<NamespaceRecord[]>([])
  const [allInstances, setAllInst]  = useState<InstalledInstance[]>([])
  const [loading, setLoading]       = useState(true)
  const [creating, setCreating]     = useState(false)
  const [oneTimeKey, setOneTimeKey] = useState<OneTimeKey | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [nsRes, libRes] = await Promise.all([
      fetch('/api/namespaces'),
      fetch('/api/library'),
    ])
    setNamespaces(await nsRes.json())
    const catalog = await libRes.json()
    setAllInst(
      catalog.flatMap((entry: { id: string; name: string; tools: Array<{ name: string }>; instances: Array<{ instanceId: string; name: string }> }) =>
        entry.instances.map((inst) => ({
          id: inst.instanceId, name: inst.name,
          type: entry.id, typeName: entry.name,
          tools: entry.tools.map((t: { name: string }) => t.name),
        }))
      )
    )
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function handleCreated(ns: NamespaceRecord) {
    setCreating(false)
    load()
    // open key flow immediately so they don't have to click again
    setOneTimeKey(null)
  }

  return (
    <div style={{ minHeight: '100vh', padding: '32px 24px', maxWidth: 900, margin: '0 auto', fontFamily: 'monospace' }}>
      <Nav active="Namespaces" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <div style={{ color: S.text, fontSize: 18, fontWeight: 'bold' }}>Namespaces</div>
          <div style={{ color: S.dim, fontSize: 12, marginTop: 2 }}>
            {namespaces.length} namespace{namespaces.length !== 1 ? 's' : ''} — each with its own endpoint, keys, and server scope
          </div>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            style={{ background: 'var(--tint-green-bg)', border: '1px solid var(--tint-green-border)', color: S.green, fontSize: 12, padding: '7px 16px', cursor: 'pointer', fontFamily: 'monospace', borderRadius: 4 }}
          >
            + new namespace
          </button>
        )}
      </div>

      {creating && (
        <CreateForm allInstances={allInstances} onCreated={handleCreated} onCancel={() => setCreating(false)} />
      )}

      {loading ? (
        <div style={{ color: S.dim, textAlign: 'center', paddingTop: 60 }}>Loading...</div>
      ) : namespaces.length === 0 && !creating ? (
        <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 32, textAlign: 'center' }}>
          <div style={{ color: S.muted, fontSize: 14, marginBottom: 8 }}>No namespaces yet.</div>
          <div style={{ color: S.dim, fontSize: 12, lineHeight: 1.8 }}>
            The master key on the Dashboard gives full access to all servers at <code>/mcp</code>.<br />
            Create a namespace when you need a separate endpoint with scoped access and its own set of keys.
          </div>
        </div>
      ) : (
        namespaces.map((ns) => (
          <NamespaceCard
            key={ns.id}
            ns={ns}
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
