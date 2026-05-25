interface SSEClient {
  controller: ReadableStreamDefaultController<Uint8Array>
  interval:   ReturnType<typeof setInterval>
  gatewayId:  string | null
}

const clients = new Map<string, SSEClient>()
const enc     = new TextEncoder()

export function registerSSEClient(sessionId: string, client: SSEClient): void {
  unregisterSSEClient(sessionId)  // evict stale entry so its interval doesn't leak
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
    try {
      client.controller.enqueue(data)
    } catch {
      dead.push(id)
    }
  }
  for (const id of dead) unregisterSSEClient(id)
}
