import { spawn, ChildProcess } from 'child_process'
import { findCatalogEntry } from './mcp-catalog'
import { getCredential, getInstalledMCPs } from './db'
import { StdioBridge } from './stdio-bridge'

interface ManagedProcess {
  proc:   ChildProcess
  bridge: StdioBridge | null
  mcpType: string
}

const running  = new Map<string, ManagedProcess>()  // keyed by instanceId
const stopping = new Set<string>()                  // SIGTERM sent, not yet exited

function resolveArgs(instanceId: string, args: string[]): string[] {
  return args.map((arg) =>
    arg.startsWith('{{') && arg.endsWith('}}')
      ? (getCredential(instanceId, arg.slice(2, -2)) ?? '')
      : arg
  )
}

export function startMCP(instanceId: string, type: string, port: number): void {
  const entry = findCatalogEntry(type)
  if (!entry || entry.transport === 'native' || entry.transport === 'http-proxy') return
  if (running.has(instanceId) || stopping.has(instanceId)) return

  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const cred of entry.credentials) {
    const value = getCredential(instanceId, cred.key)
    if (value) env[cred.key] = value
  }
  for (const [k, v] of Object.entries(entry.transportEnv ?? {})) env[k] = v

  const isStdio = entry.transport === 'stdio'
  if (!isStdio) env['TRANSPORT_OPTIONS_PORT'] = String(port)

  const args = resolveArgs(instanceId, entry.args ?? [])
  const proc = spawn(entry.command!, args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  if (!isStdio) {
    proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[${instanceId}] ${d}`))
    proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[${instanceId}] ${d}`))
  }

  proc.on('exit', (code) => {
    console.log(`[MCPetty] ${instanceId} exited (code ${code})`)
    running.delete(instanceId)
    stopping.delete(instanceId)
  })
  proc.on('error', (err) => {
    console.error(`[MCPetty] ${instanceId} error:`, err.message)
    running.delete(instanceId)
    stopping.delete(instanceId)
  })

  running.set(instanceId, { proc, bridge: isStdio ? new StdioBridge(proc) : null, mcpType: type })
  console.log(`[MCPetty] Started ${instanceId} (${type}, ${entry.transport})`)
}

export function stopMCP(instanceId: string): void {
  const m = running.get(instanceId)
  if (!m || stopping.has(instanceId)) return
  stopping.add(instanceId)
  m.proc.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (running.has(instanceId)) {
      console.log(`[MCPetty] ${instanceId} SIGTERM timeout, sending SIGKILL`)
      m.proc.kill('SIGKILL')
    }
  }, 5000)
  if (typeof timer === 'object' && timer.unref) timer.unref()
  m.proc.once('exit', () => clearTimeout(timer))
}

export function isRunning(instanceId: string): boolean {
  const installed = getInstalledMCPs().find((m) => m.instanceId === instanceId)
  if (!installed) return false
  const entry = findCatalogEntry(installed.type)
  if (entry?.transport === 'native') return true
  return running.has(instanceId)
}

export function getStdioBridge(instanceId: string): StdioBridge | null {
  return running.get(instanceId)?.bridge ?? null
}

export async function bootAll(): Promise<void> {
  const mcps = getInstalledMCPs()
  const CONCURRENCY = 6
  const JITTER_MS   = 400

  for (let i = 0; i < mcps.length; i += CONCURRENCY) {
    const batch = mcps.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(({ instanceId, type, port }) =>
        new Promise<void>(resolve => {
          setTimeout(() => { startMCP(instanceId, type, port); resolve() }, Math.random() * JITTER_MS)
        })
      )
    )
    if (i + CONCURRENCY < mcps.length) {
      await new Promise(r => setTimeout(r, JITTER_MS))
    }
  }
}
