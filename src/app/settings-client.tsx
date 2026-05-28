'use client'

import { useEffect, useState, useCallback } from 'react'
import { Nav, Footer } from './nav'
import { S } from './styles'

interface SettingsData {
  settings: Record<string, string>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bool(v: string | undefined) { return v === 'true' }
function arr(v: string | undefined): string[] {
  try { return JSON.parse(v ?? '[]') } catch { return [] }
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!on)}
      style={{ width: 36, height: 20, borderRadius: 10, background: on ? S.green : 'var(--toggle-off-bg)', border: `1px solid ${on ? S.green : 'var(--border)'}`, cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.15s' }}
    >
      <div style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 14, height: 14, borderRadius: '50%', background: on ? '#000' : 'var(--toggle-off-dot)', transition: 'left 0.15s' }} />
    </div>
  )
}

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 20, marginBottom: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: S.text, fontSize: 14, fontWeight: 'bold' }}>{title}</div>
        <div style={{ color: S.dim, fontSize: 12, marginTop: 3 }}>{sub}</div>
      </div>
      {children}
    </div>
  )
}

function SaveBtn({ saving, saved, onClick }: { saving: boolean; saved: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="btn-primary"
      style={{ background: saved ? 'var(--tint-green-bg)' : S.green, color: saved ? S.green : '#000', border: saved ? `1px solid ${S.green}` : undefined, padding: '6px 20px', fontSize: 12 }}
    >
      {saved ? '✓ saved' : saving ? 'saving...' : 'save'}
    </button>
  )
}

function useSave() {
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  async function save(body: object) {
    setSaving(true)
    try {
      await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }
  return { saving, saved, save }
}

// ─── Master gateway section ───────────────────────────────────────────────────

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

function MasterGatewaySection({ raw }: { raw: Record<string, string> }) {
  const [on,          setOn]          = useState(raw.master_gateway_enabled === 'true')
  const [confirming,  setConfirming]  = useState(false)
  const [apiKey,      setApiKey]      = useState('')
  const [host,        setHost]        = useState('<host>')
  const [keyCopied,   setKeyCopied]   = useState(false)
  const [cmdCopied,   setCmdCopied]   = useState(false)
  const [rotating,    setRotating]    = useState(false)
  const { saving, saved, save }       = useSave()

  useEffect(() => {
    if (typeof window !== 'undefined') setHost(window.location.hostname)
    if (raw.master_gateway_enabled === 'true') {
      fetch('/api/gateway-key').then((r) => r.json()).then((d: { key: string }) => setApiKey(d.key ?? ''))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function enable() {
    await save({ settings: { master_gateway_enabled: 'true' } })
    setOn(true); setConfirming(false)
    const d = await fetch('/api/gateway-key').then((r) => r.json()) as { key: string }
    setApiKey(d.key ?? '')
  }

  async function disable() {
    await save({ settings: { master_gateway_enabled: 'false' } })
    setOn(false)
  }

  async function rotate() {
    if (!confirm('Rotate master gateway key? Any existing Claude Code configs using this key will break.')) return
    setRotating(true)
    const d = await fetch('/api/gateway-key', { method: 'POST' }).then((r) => r.json()) as { key: string }
    setApiKey(d.key ?? '')
    setRotating(false)
  }

  function copy(text: string, setFn: (v: boolean) => void) {
    copyText(text); setFn(true); setTimeout(() => setFn(false), 2000)
  }

  const url     = `http://${host}:1234/mcp`
  const masked  = apiKey ? `${apiKey.slice(0, 8)}${'•'.repeat(20)}` : '...'
  const cmd     = apiKey ? `claude mcp add mcpetty ${url} --transport http --header "Authorization: Bearer ${apiKey}"` : ''
  const cmdShow = apiKey ? `claude mcp add mcpetty ${url} --transport http --header "Authorization: Bearer ${masked}"` : '...'

  return (
    <Section title="Master Gateway" sub="The /mcp catch-all endpoint. Disabled by default — use namespaces instead.">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: on || confirming ? 16 : 0 }}>
        <Toggle on={on} onChange={(v) => { if (v) setConfirming(true); else disable() }} />
        <span style={{ color: on ? S.yellow : S.dim, fontSize: 12 }}>{on ? 'enabled' : 'disabled'}</span>
        {saving && <span style={{ color: S.dim, fontSize: 11 }}>saving...</span>}
        {saved  && <span style={{ color: S.green, fontSize: 11 }}>✓ saved</span>}
      </div>

      {confirming && !on && (
        <div style={{ background: 'var(--tint-yellow-bg)', border: `1px solid ${S.yellow}`, borderRadius: 6, padding: '14px 16px', marginBottom: 0 }}>
          <div style={{ color: S.yellow, fontWeight: 'bold', fontSize: 13, marginBottom: 10 }}>⚠ Before you enable this</div>
          <div style={{ color: S.muted, fontSize: 12, lineHeight: 1.7, marginBottom: 12 }}>
            The master gateway at <code style={{ color: S.green }}>/mcp</code> exposes <strong>all installed MCPs</strong> with a single non-rotatable key tied to your data volume.
            <br /><br />
            <span style={{ color: '#cc9900' }}>Security concerns:</span>
            <ul style={{ margin: '6px 0 0 16px', padding: 0, lineHeight: 1.8 }}>
              <li>The key cannot be invalidated without wiping the entire data volume.</li>
              <li>One key, every MCP, zero restrictions — the blast radius of a leak is your entire homelab.</li>
              <li>Any leak means full access to every installed MCP — no scope, no rate limit.</li>
              <li>No per-key audit trail: you cannot tell which connection made which call.</li>
            </ul>
            <br />
            <span style={{ color: S.muted }}>Recommended: create a namespace in the <strong>Namespaces</strong> tab. Namespaces have scoped access, their own revocable keys, rate limiting, and per-namespace audit logs.</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={enable}
              style={{ background: 'none', border: `1px solid ${S.yellow}`, color: S.yellow, padding: '5px 14px', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}
            >
              I understand — enable anyway
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="btn"
              style={{ padding: '5px 12px', fontSize: 12 }}
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {on && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: 'var(--flag-warning-bg)', border: `1px solid var(--tint-yellow-border)`, borderRadius: 5, padding: '8px 12px', fontSize: 11, color: S.yellow, lineHeight: 1.5 }}>
            Master key active. Anyone with this key has unrestricted access to all MCPs. Consider namespaces for scoped access.
          </div>

          <div>
            <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>API Key</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: S.bg, border: `1px solid ${S.border}`, borderRadius: 4, padding: '6px 10px' }}>
              <code style={{ color: S.muted, fontSize: 11, flex: 1, fontFamily: 'monospace', letterSpacing: 1 }}>{masked}</code>
              <button onClick={() => copy(apiKey, setKeyCopied)} className="btn" style={{ color: keyCopied ? S.green : undefined, fontSize: 10, padding: '2px 8px' }}>
                {keyCopied ? '✓ copied' : 'copy key'}
              </button>
              <button onClick={rotate} disabled={rotating} className="btn-danger" style={{ fontSize: 10, padding: '2px 8px' }}>
                {rotating ? '...' : 'rotate'}
              </button>
            </div>
          </div>

          <div>
            <div style={{ color: S.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Claude Code command</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: S.bg, border: `1px solid ${S.border}`, borderRadius: 4, padding: '7px 10px' }}>
              <code style={{ color: S.text, fontSize: 11, flex: 1, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.5 }}>{cmdShow}</code>
              <button onClick={() => copy(cmd, setCmdCopied)} className="btn" style={{ color: cmdCopied ? S.green : undefined, fontSize: 10, padding: '2px 8px' }}>
                {cmdCopied ? '✓' : 'copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}

// ─── Injection detection section ──────────────────────────────────────────────

function InjectionSection({ raw }: { raw: Record<string, string> }) {
  const [on,       setOn]       = useState(bool(raw.injection_enabled))
  const [patterns, setPatterns] = useState(arr(raw.injection_patterns).join('\n'))
  const { saving, saved, save } = useSave()

  const DEFAULT_PATTERNS = [
    'ignore previous instructions', 'ignore all previous', 'disregard your',
    'forget your instructions', 'new instructions:', 'you are now', 'jailbreak',
    'override your', 'act as if', 'pretend you are', 'system prompt',
  ]

  return (
    <Section title="Prompt Injection Detection" sub="Scans tool outputs for patterns that could manipulate your AI agent before it reads them.">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Toggle on={on} onChange={setOn} />
        <span style={{ color: on ? S.green : S.dim, fontSize: 12 }}>{on ? 'enabled' : 'disabled'}</span>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          Extra patterns <span style={{ color: S.dim2, textTransform: 'none' as const, letterSpacing: 0 }}>— one per line, in addition to the built-in {DEFAULT_PATTERNS.length}</span>
        </div>
        <textarea
          value={patterns}
          onChange={(e) => setPatterns(e.target.value)}
          placeholder={'custom pattern one\ncustom pattern two'}
          rows={4}
          className="input"
          style={{ width: '100%', padding: '8px 10px', fontSize: 12, resize: 'vertical' as const, color: S.muted }}
        />
        <div style={{ color: S.dim2, fontSize: 11, marginTop: 4 }}>
          Built-in: {DEFAULT_PATTERNS.join(' · ')}
        </div>
      </div>
      <SaveBtn saving={saving} saved={saved} onClick={() => save({ settings: {
        injection_enabled:  String(on),
        injection_patterns: JSON.stringify(patterns.split('\n').map((s) => s.trim()).filter(Boolean)),
      }})} />
    </Section>
  )
}

// ─── n8n webhook section ──────────────────────────────────────────────────────

function WebhookSection({ raw }: { raw: Record<string, string> }) {
  const [on,       setOn]       = useState(bool(raw.webhook_enabled))
  const [url,      setUrl]      = useState(raw.webhook_url ?? '')
  const [triggers, setTriggers] = useState(arr(raw.webhook_triggers).join('\n'))
  const { saving, saved, save } = useSave()
  const [testing, setTesting]   = useState(false)
  const [testMsg, setTestMsg]   = useState('')

  async function test() {
    if (!url.trim()) { setTestMsg('No URL set.'); return }
    setTesting(true); setTestMsg('')
    try {
      const res  = await fetch('/api/settings/test-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json() as { ok: boolean; status?: number; error?: string }
      setTestMsg(data.ok ? `Fired — n8n responded ${data.status}.` : `Failed: ${data.error}`)
    } catch (e) {
      setTestMsg(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <Section title="n8n Webhook" sub="Fires a POST to your n8n endpoint when specific tools are called. n8n handles the rest — alerts, approvals, logging.">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Toggle on={on} onChange={setOn} />
        <span style={{ color: on ? S.green : S.dim, fontSize: 12 }}>{on ? 'enabled' : 'disabled'}</span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Webhook URL</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-n8n.example.com/webhook/..."
            className="input"
            style={{ flex: 1, padding: '7px 10px', fontSize: 12 }}
          />
          <button onClick={test} disabled={testing} className="btn" style={{ fontSize: 11, padding: '4px 12px', flexShrink: 0 }}>
            {testing ? '...' : 'test'}
          </button>
        </div>
        {testMsg && <div style={{ color: S.muted, fontSize: 11, marginTop: 4 }}>{testMsg}</div>}
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          Triggers <span style={{ color: S.dim2, textTransform: 'none' as const, letterSpacing: 0 }}>— one per line: platform:action or platform:* — leave empty to fire on every call</span>
        </div>
        <textarea
          value={triggers}
          onChange={(e) => setTriggers(e.target.value)}
          placeholder={'karakeep:create_bookmark\nwikijs:delete_page\nportainer:*'}
          rows={4}
          className="input"
          style={{ width: '100%', padding: '8px 10px', fontSize: 12, resize: 'vertical' as const, color: S.muted }}
        />
      </div>

      <SaveBtn saving={saving} saved={saved} onClick={() => save({ settings: {
        webhook_enabled:  String(on),
        webhook_url:      url.trim(),
        webhook_triggers: JSON.stringify(triggers.split('\n').map((s) => s.trim()).filter(Boolean)),
      }})} />
    </Section>
  )
}

// ─── Cache section ────────────────────────────────────────────────────────────

function CacheSection({ raw }: { raw: Record<string, string> }) {
  const [on,  setOn]  = useState(bool(raw.cache_enabled))
  const [ttl, setTtl] = useState(Math.min(Math.max(Number(raw.cache_ttl_secs) || 60, 1), 120))
  const { saving, saved, save } = useSave()

  return (
    <Section title="Tool Output Cache" sub="Returns identical calls from memory to avoid redundant API hits. Claude is told the answer is cached and how to bypass it.">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Toggle on={on} onChange={setOn} />
        <span style={{ color: on ? S.green : S.dim, fontSize: 12 }}>{on ? 'enabled' : 'disabled'}</span>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          TTL — {ttl}s
        </div>
        <input
          type="range" min={1} max={120} value={ttl}
          onChange={(e) => setTtl(Number(e.target.value))}
          style={{ width: '100%', accentColor: S.green }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', color: S.dim2, fontSize: 10, marginTop: 4 }}>
          <span>1s</span><span>30s</span><span>60s</span><span>90s</span><span>120s</span>
        </div>
      </div>

      <div style={{ background: 'var(--info-box-bg)', border: `1px solid var(--info-box-border)`, borderRadius: 6, padding: '8px 12px', marginBottom: 16, fontSize: 12, color: S.dim, lineHeight: 1.6 }}>
        Cache key: <span style={{ color: S.muted, fontFamily: 'monospace' }}>platform + action + args</span>.
        Claude can bypass by appending <span style={{ color: S.green, fontFamily: 'monospace' }}>nocache: true</span> to the call args.
        Cached responses include a note with remaining TTL.
      </div>

      <SaveBtn saving={saving} saved={saved} onClick={() => save({ settings: {
        cache_enabled:  String(on),
        cache_ttl_secs: String(ttl),
      }})} />
    </Section>
  )
}

// ─── Redaction section ────────────────────────────────────────────────────────

function RedactionSection({ raw }: { raw: Record<string, string> }) {
  const [on,   setOn]   = useState(bool(raw.redaction_enabled))
  const [keys, setKeys] = useState(
    raw.redaction_keys !== undefined
      ? arr(raw.redaction_keys).join('\n')
      : 'password\ntoken\nsecret\napi_key\nkey\naccess_token'
  )
  const { saving, saved, save } = useSave()

  return (
    <Section title="Argument Redaction" sub="Replaces specific argument values with [REDACTED] before writing to the insights log. Execution always gets the real values.">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Toggle on={on} onChange={setOn} />
        <span style={{ color: on ? S.green : S.dim, fontSize: 12 }}>{on ? 'enabled' : 'disabled'}</span>
      </div>

      <div style={{ background: 'var(--flag-info-bg)', border: `1px solid var(--flag-info-border)`, borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: S.dim, lineHeight: 1.6 }}>
        MCPetty can&apos;t auto-detect passwords. You tell it which <em>argument key names</em> to redact.
        Any call where Claude passes an arg named <span style={{ color: '#00bfff', fontFamily: 'monospace' }}>token</span> will
        store <span style={{ color: '#00bfff', fontFamily: 'monospace' }}>[REDACTED]</span> in the log instead of the value.
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          Key names to redact <span style={{ color: S.dim2, textTransform: 'none' as const, letterSpacing: 0 }}>— one per line</span>
        </div>
        <textarea
          value={keys}
          onChange={(e) => setKeys(e.target.value)}
          rows={5}
          className="input"
          style={{ width: '100%', padding: '8px 10px', fontSize: 12, resize: 'vertical' as const, color: S.muted }}
        />
      </div>

      <SaveBtn saving={saving} saved={saved} onClick={() => save({ settings: {
        redaction_enabled: String(on),
        redaction_keys:    JSON.stringify(keys.split('\n').map((s) => s.trim()).filter(Boolean)),
      }})} />
    </Section>
  )
}

// ─── Meta MCP section ─────────────────────────────────────────────────────────

function MetaMCPSection() {
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [saving,    setSaving]    = useState(false)

  useEffect(() => {
    fetch('/api/meta-mcp').then((r) => r.json()).then((d: { installed: boolean }) => setInstalled(d.installed))
  }, [])

  async function toggle(val: boolean) {
    setSaving(true)
    try {
      await fetch('/api/meta-mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: val }) })
      setInstalled(val)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="MCPetty Meta MCP" sub="Exposes a read-only MCP tool so your AI agent can query MCPetty itself — status, call history, error patterns, sessions.">
      {installed === null ? (
        <div style={{ color: S.dim, fontSize: 12 }}>loading...</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <Toggle on={installed} onChange={saving ? () => {} : toggle} />
            <span style={{ color: installed ? S.green : S.dim, fontSize: 12 }}>{installed ? 'installed' : 'not installed'}</span>
            {saving && <span style={{ color: S.dim, fontSize: 11 }}>...</span>}
          </div>
          <div style={{ background: 'var(--info-box-bg)', border: `1px solid var(--info-box-border)`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: S.dim, lineHeight: 1.6 }}>
            When enabled, MCPetty registers itself as an installed MCP with{' '}
            <span style={{ color: S.green, fontFamily: 'monospace' }}>mcpetty</span> as the tool name.
            Claude can call actions like{' '}
            <span style={{ color: S.muted, fontFamily: 'monospace' }}>get_status</span>,{' '}
            <span style={{ color: S.muted, fontFamily: 'monospace' }}>get_insights_summary</span>,{' '}
            <span style={{ color: S.muted, fontFamily: 'monospace' }}>get_error_patterns</span>, and{' '}
            <span style={{ color: S.muted, fontFamily: 'monospace' }}>get_sessions</span>.
            Read-only — Claude cannot install, uninstall, or modify anything.
          </div>
        </>
      )}
    </Section>
  )
}

// ─── Changelog section ────────────────────────────────────────────────────────

interface ChangelogEntry { id: number; timestamp: number; type: string; subject: string; detail: string }

const CHANGE_LABELS: Record<string, { label: string; color: string }> = {
  mcp_install:   { label: 'install',     color: 'var(--green)' },
  mcp_uninstall: { label: 'uninstall',   color: '#ff4444' },
  tool_filter:   { label: 'filter',      color: '#ffd700' },
  desc_override: { label: 'description', color: '#00bfff' },
  gateway_create:{ label: 'gateway+',    color: 'var(--green)' },
  gateway_delete:{ label: 'gateway−',    color: '#ff4444' },
  gateway_rename:{ label: 'gateway',     color: '#ffd700' },
  setting:       { label: 'setting',     color: '#9a9a9a' },
}

function fmtTs(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function PrivacySection() {
  const [on, setOn] = useState(false)
  useEffect(() => { setOn(localStorage.getItem('mcpetty_anon') === '1') }, [])

  function toggle() {
    const next = !on
    setOn(next)
    localStorage.setItem('mcpetty_anon', next ? '1' : '0')
    window.dispatchEvent(new Event('mcpetty-anon-change'))
  }

  return (
    <Section title="Privacy Mode" sub="Anonymize the UI for safe screenshots and demos.">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Toggle on={on} onChange={toggle} />
        <span style={{ color: on ? S.yellow : S.dim, fontSize: 12 }}>
          {on ? 'active — names and args masked across all pages' : 'off'}
        </span>
      </div>
      <div style={{ color: S.dim2, fontSize: 11, lineHeight: 1.6 }}>
        {on
          ? 'Instance names show as "Instance N" / "mcp-N", call args are redacted in Insights. Reload any tab to apply. Toggle off to restore.'
          : 'Replaces instance names with "Instance N" and "mcp-N", redacts call args in Insights. Handy for screenshots — no data is deleted.'}
      </div>
    </Section>
  )
}

function ChangelogSection() {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null)
  const [days,    setDays]    = useState(30)

  useEffect(() => {
    fetch(`/api/changelog?days=${days}`).then((r) => r.json()).then(setEntries)
  }, [days])

  return (
    <Section title="Changelog" sub="Config changes — installs, uninstalls, gateway edits, setting tweaks. Read-only audit trail.">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {[7, 30, 90].map((d) => (
          <button key={d} onClick={() => setDays(d)} style={{ background: days === d ? 'var(--tint-green-bg)' : 'none', border: `1px solid ${days === d ? S.green : S.border}`, borderRadius: 4, color: days === d ? S.green : S.dim, fontSize: 11, padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace' }}>
            {d}d
          </button>
        ))}
      </div>

      {entries === null ? (
        <div style={{ color: S.dim, fontSize: 12 }}>loading...</div>
      ) : entries.length === 0 ? (
        <div style={{ color: S.dim, fontSize: 12 }}>No changes in the last {days} days.</div>
      ) : (
        <div style={{ maxHeight: 400, overflowY: 'auto', paddingRight: 4 }}>
          {entries.map((e) => {
            const tag = CHANGE_LABELS[e.type] ?? { label: e.type, color: S.dim }
            return (
              <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '110px 80px 1fr', gap: 8, alignItems: 'start', padding: '7px 0', borderTop: `1px solid ${S.border}`, fontSize: 12 }}>
                <span style={{ color: S.dim, fontSize: 11 }}>{fmtTs(e.timestamp)}</span>
                <span style={{ color: tag.color, fontFamily: 'monospace', fontSize: 11 }}>{tag.label}</span>
                <span>
                  <span style={{ color: S.text, fontFamily: 'monospace' }}>{e.subject}</span>
                  {e.detail && <span style={{ color: S.dim }}> — {e.detail}</span>}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ─── Change password section ──────────────────────────────────────────────────

function ChangePasswordSection() {
  const [current,    setCurrent]    = useState('')
  const [next,       setNext]       = useState('')
  const [confirm,    setConfirm]    = useState('')
  const [saving,     setSaving]     = useState(false)
  const [msg,        setMsg]        = useState<{ ok: boolean; text: string } | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (next !== confirm) { setMsg({ ok: false, text: 'Passwords do not match.' }); return }
    if (next.length < 8)  { setMsg({ ok: false, text: 'Minimum 8 characters.' }); return }
    setSaving(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      if (res.ok) {
        setMsg({ ok: true, text: 'Password changed. You will be logged out.' })
        setCurrent(''); setNext(''); setConfirm('')
        setTimeout(() => { window.location.href = '/login' }, 1500)
      } else {
        const data = await res.json()
        setMsg({ ok: false, text: data.error || 'Failed.' })
      }
    } finally { setSaving(false) }
  }

  return (
    <Section title="Change Password" sub="Changing password logs out all active sessions.">
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}>
        <div>
          <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>Current Password</div>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="input" style={{ width: '100%', padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' as const }} />
        </div>
        <div>
          <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>New Password</div>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="input" style={{ width: '100%', padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' as const }} placeholder="min 8 characters" />
        </div>
        <div>
          <div style={{ color: S.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>Confirm New Password</div>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input" style={{ width: '100%', padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' as const }} />
        </div>
        {msg && (
          <div style={{ background: msg.ok ? 'var(--tint-green-bg)' : 'var(--flag-danger-bg)', border: `1px solid ${msg.ok ? S.green : S.red}`, borderRadius: 4, padding: '7px 10px', color: msg.ok ? S.green : S.red, fontSize: 12 }}>
            {msg.text}
          </div>
        )}
        <div>
          <button type="submit" disabled={saving || !current || !next || !confirm}
            className="btn-primary"
            style={{ padding: '6px 20px', fontSize: 12, opacity: !current || !next || !confirm ? 0.5 : 1 }}>
            {saving ? 'saving...' : 'change password'}
          </button>
        </div>
      </form>
    </Section>
  )
}

// ─── Allowed origins section ──────────────────────────────────────────────────

function AllowedOriginsSection({ raw }: { raw: Record<string, string> }) {
  const [origins, setOrigins] = useState(raw.allowed_origins ?? '')
  const { saving, saved, save } = useSave()

  return (
    <Section title="Allowed Origins" sub="Hostnames allowed in the Origin header when accessing the /mcp gateway from a browser. One per line. Default (empty): 127.0.0.1 and localhost only.">
      <textarea
        value={origins}
        onChange={(e) => setOrigins(e.target.value)}
        placeholder={'127.0.0.1\nlocalhost\n192.168.1.10'}
        rows={4}
        className="input"
        style={{ width: '100%', padding: '8px 10px', fontSize: 12, resize: 'vertical' as const, color: S.muted, marginBottom: 12 }}
      />
      <SaveBtn saving={saving} saved={saved} onClick={() => save({ settings: {
        allowed_origins: origins.split('\n').map((s) => s.trim()).filter(Boolean).join(','),
      }})} />
    </Section>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SettingsClient() {
  const [data,    setData]    = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setData(await fetch('/api/settings').then((r) => r.json()))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div style={{ minHeight: '100vh', padding: '32px 24px', maxWidth: 900, margin: '0 auto', fontFamily: 'monospace' }}>
      <Nav active="Settings" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <div style={{ color: S.text, fontSize: 18, fontWeight: 'bold' }}>Settings</div>
          <div style={{ color: S.dim, fontSize: 12, marginTop: 2 }}>Security, performance, and observability. Touch carefully.</div>
        </div>
      </div>

      {loading || !data ? (
        <div style={{ color: S.dim, textAlign: 'center', paddingTop: 80 }}>Loading...</div>
      ) : (
        <>
          <MasterGatewaySection raw={data.settings} />
          <MetaMCPSection />
          <ChangePasswordSection />
          <AllowedOriginsSection raw={data.settings} />
          <InjectionSection  raw={data.settings} />
          <WebhookSection    raw={data.settings} />
          <CacheSection      raw={data.settings} />
          <RedactionSection  raw={data.settings} />
          <PrivacySection />
          <ChangelogSection />
        </>
      )}

      <Footer motto="you broke it, you own it" />
    </div>
  )
}
