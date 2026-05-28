import { getInstancesForHealthCheck, recordHealthOk, recordHealthFail, getSettingsMap } from './db'
import { NATIVE } from './native'
import { findCatalogEntry } from './mcp-catalog'
import { initSession } from './mcp-client'
import { getStdioBridge } from './process-manager'

const CHECK_INTERVAL_MS = 30_000

let _timer: ReturnType<typeof setInterval> | null = null

async function runChecks() {
  const instances = getInstancesForHealthCheck()
  if (!instances.length) return

  const settings = getSettingsMap()
  const webhookOn  = settings.webhook_enabled === 'true'
  const webhookUrl = settings.webhook_url ?? ''

  const now = Date.now()
  await Promise.allSettled(
    instances.map(async (inst) => {
      const { instanceId, type, healthCheckIntervalSeconds, healthLastCheckedAt, healthCheckFailThreshold, autoDisabled } = inst

      if (healthCheckIntervalSeconds > 0) {
        const lastChecked = healthLastCheckedAt ?? 0
        if (now - lastChecked < healthCheckIntervalSeconds * 1000) return
      } else if (!autoDisabled) {
        return
      }

      const entry = findCatalogEntry(type)
      if (!entry) return

      let ok: boolean
      let pingError: string | undefined

      try {
        if (entry.transport === 'native') {
          const handler = NATIVE[type]
          if (!handler) return
          const result = await handler.ping(instanceId)
          ok = result.ok
          pingError = result.error
        } else if (entry.transport === 'http') {
          await initSession(`http://localhost:${inst.port}`)
          ok = true
        } else if (entry.transport === 'stdio') {
          const bridge = getStdioBridge(instanceId)
          ok = bridge ? await bridge.ping() : false
          if (!ok) pingError = bridge ? 'ping failed' : 'process not running'
        } else {
          return
        }
      } catch (e) {
        ok = false
        pingError = e instanceof Error ? e.message : 'unknown error'
      }

      if (ok) {
        const wasDown = autoDisabled
        recordHealthOk(instanceId)
        if (wasDown && webhookOn && webhookUrl) {
          fireWebhook(webhookUrl, {
            event: 'health_change', instance_id: instanceId,
            status: 'recovered', consecutive_fails: 0, timestamp: Math.floor(Date.now() / 1000),
          })
        }
      } else {
        const { autoDisabledNow, consecutiveFails } = recordHealthFail(instanceId, pingError ?? 'ping failed')
        if (autoDisabledNow && webhookOn && webhookUrl) {
          fireWebhook(webhookUrl, {
            event: 'health_change', instance_id: instanceId,
            status: 'down', error: pingError ?? 'ping failed',
            consecutive_fails: consecutiveFails,
            threshold: healthCheckFailThreshold,
            timestamp: Math.floor(Date.now() / 1000),
          })
        }
      }
    })
  )
}

function fireWebhook(url: string, payload: object) {
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .catch(() => {})
}

export function startHealthScheduler() {
  if (_timer) return
  _timer = setInterval(() => { runChecks().catch(() => {}) }, CHECK_INTERVAL_MS)
}
