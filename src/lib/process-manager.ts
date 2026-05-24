import { spawn, ChildProcess } from 'child_process'
import { findCatalogEntry } from './mcp-catalog'
import { getCredential, getInstalledMCPs } from './db'
import { StdioBridge } from './stdio-bridge'

interface ManagedProcess {
  proc:   ChildProcess
  bridge: StdioBridge | null
  mcpType: string
}

const running = new Map<string, ManagedProcess>()  // keyed by instanceId

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
  if (running.has(instanceId)) return

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
    stdio: isStdio ? ['pipe', 'pipe', 'inherit'] : 'inherit',
  })

  proc.on('exit', (code) => { console.log(`[MCPetty] ${instanceId} exited (code ${code})`); running.delete(instanceId) })
  proc.on('error', (err) => { console.error(`[MCPetty] ${instanceId} error:`, err.message); running.delete(instanceId) })

  running.set(instanceId, { proc, bridge: isStdio ? new StdioBridge(proc) : null, mcpType: type })
  console.log(`[MCPetty] Started ${instanceId} (${type}, ${entry.transport})`)
}

export function stopMCP(instanceId: string): void {
  const m = running.get(instanceId)
  if (!m) return
  m.proc.kill('SIGTERM')
  running.delete(instanceId)
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

export function bootAll(): void {
  for (const { instanceId, type, port } of getInstalledMCPs()) {
    startMCP(instanceId, type, port)
  }
}
