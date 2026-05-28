import { AsyncLocalStorage } from 'async_hooks'

export type ActorType = 'user' | 'gateway' | 'namespace' | 'system'

export interface AuditActor {
  actorType: ActorType
  actorId:   string
}

const _store = new AsyncLocalStorage<AuditActor>()

export function withActor<T>(actor: AuditActor, fn: () => T): T {
  return _store.run(actor, fn)
}

export function currentActor(): AuditActor {
  return _store.getStore() ?? { actorType: 'system', actorId: 'system' }
}
