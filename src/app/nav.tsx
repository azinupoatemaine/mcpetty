'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

const LOGO = `███╗   ███╗ ██████╗██████╗ ███████╗████████╗████████╗██╗   ██╗
████╗ ████║██╔════╝██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝╚██╗ ██╔╝
██╔████╔██║██║     ██████╔╝█████╗     ██║      ██║    ╚████╔╝
██║╚██╔╝██║██║     ██╔═══╝ ██╔══╝     ██║      ██║     ╚██╔╝
██║ ╚═╝ ██║╚██████╗██║     ███████╗   ██║      ██║      ██║
╚═╝     ╚═╝ ╚═════╝╚═╝     ╚══════╝   ╚═╝      ╚═╝      ╚═╝`

const TABS = [
  ['Dashboard',  '/'],
  ['Library',    '/library'],
  ['Insights',   '/insights'],
  ['Namespaces', '/gateways'],
  ['Settings',   '/settings'],
  ['Audit',      '/audit'],
] as const

type ActiveTab = 'Dashboard' | 'Library' | 'Insights' | 'Namespaces' | 'Settings' | 'Audit'

export { type ActiveTab }

const VERSION = 'v1.05'

export function Footer({ motto }: { motto: string }) {
  return (
    <div style={{ marginTop: 64, borderTop: '1px solid var(--border)', paddingTop: 16, color: 'var(--dim)', fontSize: 11, display: 'flex', justifyContent: 'space-between' }}>
      <span>MCPetty {VERSION} — built by someone who had better things to do</span>
      <span>{motto}</span>
    </div>
  )
}

export function Nav({ active, approvalCount, onApprovalsClick }: { active?: ActiveTab; approvalCount?: number; onApprovalsClick?: () => void }) {
  const [light, setLight] = useState(false)
  const [anon,  setAnon]  = useState(false)

  useEffect(() => {
    setLight(document.documentElement.classList.contains('light'))
    setAnon(localStorage.getItem('mcpetty_anon') === '1')
    const h = () => setAnon(localStorage.getItem('mcpetty_anon') === '1')
    window.addEventListener('mcpetty-anon-change', h)
    return () => window.removeEventListener('mcpetty-anon-change', h)
  }, [])

  function toggleTheme() {
    const next = !light
    setLight(next)
    document.documentElement.classList.toggle('light', next)
    localStorage.setItem('theme', next ? 'light' : 'dark')
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <pre style={{ color: 'var(--green)', fontSize: 'clamp(5px, 1.1vw, 11px)', lineHeight: 1.2, marginBottom: 8, overflow: 'hidden', textShadow: '0 0 10px var(--green)', margin: 0 }}>
          {LOGO}
        </pre>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {anon && (
            <span style={{ fontSize: 10, color: 'var(--yellow)', border: '1px solid var(--yellow)', borderRadius: 3, padding: '2px 6px', fontFamily: 'monospace', letterSpacing: 1 }}>
              ANON
            </span>
          )}
          <button
            onClick={toggleTheme}
            title={light ? 'Switch to dark mode' : 'Switch to light mode'}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--muted)', fontSize: 16, padding: '4px 8px', cursor: 'pointer', fontFamily: 'monospace', flexShrink: 0, lineHeight: 1 }}
          >
            {light ? '☾' : '☀'}
          </button>
        </div>
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 4, marginTop: 8 }}>The Ultimate BottleNeck.</div>
      <div style={{ color: 'var(--dim)', fontSize: 11, marginBottom: 16, lineHeight: 1.6 }}>
        Proudly serving as the front door to a server stack held together by a single unshielded ethernet cable and your tears.
      </div>
      <div style={{ borderBottom: '1px solid var(--border)', marginBottom: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          {TABS.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: `2px solid ${label === active ? 'var(--green)' : 'transparent'}`,
                color: label === active ? 'var(--green)' : 'var(--dim)',
                fontSize: 12,
                padding: '8px 16px',
                cursor: label === active ? 'default' : 'pointer',
                fontFamily: 'monospace',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              {label}
            </Link>
          ))}
        </div>
        {(approvalCount ?? 0) > 0 && onApprovalsClick && (
          <button
            onClick={onApprovalsClick}
            style={{ background: 'none', border: '1px solid var(--red)', borderRadius: 4, color: 'var(--red)', fontSize: 11, padding: '3px 10px', cursor: 'pointer', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--red)', animation: 'pulse 1.4s ease-in-out infinite', display: 'inline-block' }} />
            {approvalCount} pending approval{approvalCount !== 1 ? 's' : ''}
          </button>
        )}
      </div>
    </>
  )
}
