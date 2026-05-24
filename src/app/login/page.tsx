'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const LOGO = `███╗   ███╗ ██████╗██████╗ ███████╗████████╗████████╗██╗   ██╗
████╗ ████║██╔════╝██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝╚██╗ ██╔╝
██╔████╔██║██║     ██████╔╝█████╗     ██║      ██║    ╚████╔╝
██║╚██╔╝██║██║     ██╔═══╝ ██╔══╝     ██║      ██║     ╚██╔╝
██║ ╚═╝ ██║╚██████╗██║     ███████╗   ██║      ██║      ██║
╚═╝     ╚═╝ ╚═════╝╚═╝     ╚══════╝   ╚═╝      ╚═╝      ╚═╝`

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })

      if (res.ok) {
        router.push('/')
        router.refresh()
      } else {
        const data = await res.json()
        setError(data.error || 'Authentication failed.')
      }
    } catch {
      setError('Could not reach server.')
    } finally {
      setLoading(false)
    }
  }

  const input: React.CSSProperties = {
    width: '100%',
    background: '#111',
    border: '1px solid #2a2a2a',
    color: '#ffffff',
    padding: '8px 12px',
    fontFamily: 'monospace',
    fontSize: 14,
    borderRadius: 4,
    outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#0a0a0a', fontFamily: 'monospace' }}>
      <pre style={{ color: '#39ff14', fontSize: 'clamp(5px, 1.1vw, 11px)', lineHeight: 1.2, marginBottom: 24, textShadow: '0 0 10px #39ff14', textAlign: 'center' }}>{LOGO}</pre>

      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ color: '#555', fontSize: 12, marginBottom: 24, textAlign: 'center' }}>
          who are you and what do you want
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ color: '#777', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Username</div>
            <input
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={input}
              placeholder="admin"
            />
          </div>

          <div>
            <div style={{ color: '#777', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Password</div>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={input}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div style={{ background: '#1a0a0a', border: '1px solid #ff4444', borderRadius: 4, padding: '8px 12px', color: '#ff4444', fontSize: 12 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            style={{
              background: loading ? '#1a2a1a' : '#39ff14',
              color: '#000',
              border: 'none',
              padding: '10px',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              fontSize: 14,
              cursor: loading || !username || !password ? 'not-allowed' : 'pointer',
              borderRadius: 4,
              marginTop: 4,
              opacity: !username || !password ? 0.5 : 1,
            }}
          >
            {loading ? 'Verifying...' : 'Authenticate →'}
          </button>
        </form>

        <div style={{ marginTop: 32, color: '#222', fontSize: 10, textAlign: 'center' }}>
          default: admin / mcpetty — change it after login
        </div>
      </div>
    </div>
  )
}
