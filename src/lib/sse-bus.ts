interface SSEClient {
  controller: ReadableStreamDefaultController<Uint8Array>
  interval:   ReturnType<typeof setInterval>
  gatewayId:  string | null
}

const MAX_CLIENTS = 100

const clients = new Map<string, SSEClient>()
const enc     = new TextEncoder()

export function registerSSEClient(sessionId: string, client: SSEClient): void {
  unregisterSSEClient(sessionId)  // evict stale entry so its interval doesn't leak
  if (clients.size >= MAX_CLIENTS) {
    const oldest = clients.keys().next().value
    if (oldest) {
      console.warn(`[MCPetty] SSE client cap (${MAX_CLIENTS}) reached, evicting ${oldest}`)
      unregisterSSEClient(oldest)
    }
  }
  clients.set(sessionId, client)
}

export function unregisterSSEClient(sessionId: string): void {
  const c = clients.get(sessionId)
  if (!c) return
  clearInterval(c.interval)
  try { c.controller.close() } catch { /* already closed */ }
  clients.delete(sessionId)
}

export function broadcastNotification(notification: object, gatewayId?: string | null): void {
  const data = enc.encode(`data: ${JSON.stringify(notification)}\n\n`)
  const dead: string[] = []
  for (const [id, client] of clients) {
    if (gatewayId !== undefined && client.gatewayId !== gatewayId) continue
    // desiredSize <= 0 means the consumer isn't draining — disconnect rather than pile up
    if (client.controller.desiredSize !== null && client.controller.desiredSize <= 0) {
      dead.push(id)
      continue
    }
    try {
      client.controller.enqueue(data)
    } catch {
      dead.push(id)
    }
  }
  for (const id of dead) unregisterSSEClient(id)
}
