import { ChildProcess } from 'child_process'
import type { MCPTool } from './mcp-client'

interface Pending {
  resolve: (v: unknown) => void
  reject:  (e: Error)   => void
}

// Handles the MCP JSON-RPC protocol over a subprocess stdin/stdout pipe.
// One bridge per process — lives as long as the process.
const MAX_BUFFER = 1_048_576  // 1 MB — guard against newline-free runaway output

export class StdioBridge {
  private pending:     Map<number, Pending> = new Map()
  private nextId       = 100
  private buffer       = ''
  private initialized  = false

  constructor(private proc: ChildProcess) {
    proc.stdout?.setEncoding('utf-8')
    proc.stdout?.on('data', (chunk: string) => {
      this.buffer += chunk
      if (this.buffer.length > MAX_BUFFER) {
        console.error(`[MCPetty] stdio-bridge buffer overflow (pid ${proc.pid}), dropping buffer`)
        this.buffer = ''
        return
      }
      const lines  = this.buffer.split('\n')
      this.buffer  = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const msg = JSON.parse(trimmed) as { id?: number; result?: unknown; error?: unknown }
          if (msg.id != null) {
            const req = this.pending.get(msg.id)
            if (!req) continue
            this.pending.delete(msg.id)
            if (msg.error) req.reject(new Error(typeof msg.error === 'string' ? msg.error : JSON.stringify(msg.error)))
            else           req.resolve(msg.result)
          }
        } catch { /* non-JSON line, skip */ }
      }
    })
  }

  private rpc(method: string, params: unknown = {}): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`Stdio MCP timeout on ${method}`))
        }
      }, 15_000)
    })
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities:    {},
      clientInfo:      { name: 'mcpetty', version: '1.0.0' },
    })
    this.proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    this.initialized = true
  }

  async listTools(): Promise<MCPTool[]> {
    await this.initialize()
    const tools: MCPTool[] = []
    let cursor: string | undefined

    do {
      const res = await this.rpc('tools/list', cursor ? { cursor } : {}) as { tools?: MCPTool[]; nextCursor?: string }
      tools.push(...(res?.tools ?? []))
      cursor = res?.nextCursor
    } while (cursor)

    return tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.initialize()
    return this.rpc('tools/call', { name, arguments: args })
  }

  async ping(): Promise<boolean> {
    try { await this.listTools(); return true }
    catch { return false }
  }
}
