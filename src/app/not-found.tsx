import Link from 'next/link'
import { Nav, Footer } from './nav'

const FOURZEROFOUR = `
██╗  ██╗ ██████╗ ██╗  ██╗
██║  ██║██╔═══██╗██║  ██║
███████║██║   ██║███████║
╚════██║██║   ██║╚════██║
     ██║╚██████╔╝     ██║
     ╚═╝ ╚═════╝      ╚═╝`

const S = {
  bg: 'var(--bg)', green: 'var(--green)', red: 'var(--red)', dim: 'var(--dim)', muted: 'var(--muted)', text: 'var(--text)',
}

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', padding: '32px 24px', maxWidth: 900, margin: '0 auto', fontFamily: 'monospace', background: S.bg }}>
      <Nav />

      <div style={{ paddingTop: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <pre style={{ color: S.red, fontSize: 'clamp(8px, 1.6vw, 16px)', lineHeight: 1.2, marginBottom: 24, textShadow: `0 0 12px ${S.red}` }}>
          {FOURZEROFOUR}
        </pre>

        <div style={{ color: S.text, fontSize: 18, fontWeight: 'bold', marginBottom: 8 }}>
          Page not found.
        </div>
        <div style={{ color: S.muted, fontSize: 13, marginBottom: 4 }}>
          Whatever you were looking for, it&apos;s not here.
        </div>
        <div style={{ color: S.dim, fontSize: 12, marginBottom: 40, lineHeight: 1.6, maxWidth: 420 }}>
          It never was. Or it was and someone deleted it. Either way, this is on you.
        </div>

        <Link
          href="/"
          style={{ background: S.green, color: '#000', border: 'none', padding: '8px 24px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 13, cursor: 'pointer', borderRadius: 4, textDecoration: 'none', display: 'inline-block' }}
        >
          ← back to dashboard
        </Link>
      </div>

      <Footer motto="wrong turn, still your problem" />
    </div>
  )
}
