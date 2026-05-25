import { describe, it, expect, vi, afterEach } from 'vitest'
import { registerSSEClient, unregisterSSEClient, broadcastNotification } from '../../src/lib/sse-bus'

function makeClient(gatewayId: string | null = null) {
  const chunks: string[] = []
  let closed = false
  const interval = setInterval(() => {}, 9_999_999)
  clearInterval(interval)  // stop immediately; we only need the handle for type correctness

  const controller = {
    enqueue(chunk: Uint8Array) { chunks.push(new TextDecoder().decode(chunk)) },
    close() { closed = true },
    error() {},
    desiredSize: 1,
  } as unknown as ReadableStreamDefaultController<Uint8Array>

  return { controller, interval, gatewayId, chunks, get closed() { return closed } }
}

// Track session IDs created in each test so we can clean up
const registered: string[] = []
function register(sessionId: string, gatewayId: string | null = null) {
  const c = makeClient(gatewayId)
  registerSSEClient(sessionId, { controller: c.controller, interval: c.interval, gatewayId })
  registered.push(sessionId)
  return c
}

afterEach(() => {
  while (registered.length) unregisterSSEClient(registered.pop()!)
})

describe('registerSSEClient / broadcastNotification', () => {
  it('registered client receives broadcasts', () => {
    const c = register('s1')
    broadcastNotification({ method: 'ping' })
    expect(c.chunks).toHaveLength(1)
    expect(c.chunks[0]).toContain('"method":"ping"')
  })

  it('unregistered client does not receive broadcasts', () => {
    const c = register('s2')
    unregisterSSEClient('s2')
    registered.pop()  // already removed
    broadcastNotification({ method: 'ping' })
    expect(c.chunks).toHaveLength(0)
  })

  it('broadcast is valid SSE format (data: ...\\n\\n)', () => {
    const c = register('s3')
    broadcastNotification({ method: 'test', value: 1 })
    expect(c.chunks[0]).toMatch(/^data: \{.*\}\n\n$/)
  })

  it('multiple clients all receive the broadcast', () => {
    const c1 = register('m1')
    const c2 = register('m2')
    broadcastNotification({ method: 'multi' })
    expect(c1.chunks).toHaveLength(1)
    expect(c2.chunks).toHaveLength(1)
  })
})

describe('unregisterSSEClient', () => {
  it('closes the controller', () => {
    const c = register('u1')
    unregisterSSEClient('u1')
    registered.pop()
    expect(c.closed).toBe(true)
  })

  it('is idempotent — calling twice does not throw', () => {
    register('u2')
    unregisterSSEClient('u2')
    registered.pop()
    expect(() => unregisterSSEClient('u2')).not.toThrow()
  })

  it('clears the interval', () => {
    const spy = vi.spyOn(globalThis, 'clearInterval')
    const { interval } = makeClient()
    registerSSEClient('u3', { controller: makeClient().controller, interval, gatewayId: null })
    registered.push('u3')
    unregisterSSEClient('u3')
    registered.pop()
    expect(spy).toHaveBeenCalledWith(interval)
    spy.mockRestore()
  })
})

describe('reconnect — re-register with same session ID', () => {
  it('evicts the old client before registering the new one', () => {
    const old = makeClient()
    const interval1 = setInterval(() => {}, 9_999_999)
    clearInterval(interval1)
    registerSSEClient('r1', { controller: old.controller, interval: interval1, gatewayId: null })
    registered.push('r1')

    // Reconnect with same session ID
    const fresh = makeClient()
    const interval2 = setInterval(() => {}, 9_999_999)
    clearInterval(interval2)
    registerSSEClient('r1', { controller: fresh.controller, interval: interval2, gatewayId: null })

    // Old controller should be closed
    expect(old.closed).toBe(true)

    // Only new client receives the broadcast
    broadcastNotification({ method: 'after-reconnect' })
    expect(old.chunks).toHaveLength(0)
    expect(fresh.chunks).toHaveLength(1)
  })
})

describe('dead client cleanup during broadcast', () => {
  it('does not throw and evicts the dead client', () => {
    let callCount = 0
    const dead = {
      enqueue() { callCount++; throw new Error('stream closed') },
      close() {},
      error() {},
      desiredSize: 1,
    } as unknown as ReadableStreamDefaultController<Uint8Array>
    const interval = setInterval(() => {}, 9_999_999)
    clearInterval(interval)
    registerSSEClient('d1', { controller: dead, interval, gatewayId: null })
    registered.push('d1')

    expect(() => broadcastNotification({ method: 'test' })).not.toThrow()

    // Client was evicted — second broadcast should not attempt to reach it
    broadcastNotification({ method: 'test2' })
    expect(callCount).toBe(1)

    registered.pop()  // already evicted, no need to unregister
  })

  it('healthy clients still receive the broadcast when one is dead', () => {
    const dead = {
      enqueue() { throw new Error('stream closed') },
      close() {},
      error() {},
      desiredSize: 1,
    } as unknown as ReadableStreamDefaultController<Uint8Array>
    const interval = setInterval(() => {}, 9_999_999)
    clearInterval(interval)
    registerSSEClient('d2', { controller: dead, interval, gatewayId: null })
    registered.push('d2')

    const healthy = register('d3')

    broadcastNotification({ method: 'mixed' })
    expect(healthy.chunks).toHaveLength(1)
    registered.pop()  // d2 evicted by broadcast
  })
})
