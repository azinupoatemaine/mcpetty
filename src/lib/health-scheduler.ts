import { getInstancesForHealthCheck, recordHealthOk, recordHealthFail, getSettingsMap } from './db'
import { NATIVE } from './native'
import { findCatalogEntry } from './mcp-catalog'

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
      const { instanceId, type, healthCheckIntervalSeconds, healthLastCheckedAt, healthCheckFailThreshold, healthConsecutiveFails, autoDisabled } = inst

      if (healthCheckIntervalSeconds > 0) {
        const lastChecked = healthLastCheckedAt ?? 0
        if (now - lastChecked < healthCheckIntervalSeconds * 1000) return
      } else if (!autoDisabled) {
        return
      }

      const entry = findCatalogEntry(type)
      if (!entry || entry.transport !== 'native') return
      const handler = NATIVE[type]
      if (!handler) return

      try {
        const { ok, error } = await handler.ping(instanceId)
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
          const { autoDisabledNow } = recordHealthFail(instanceId, error ?? 'ping failed')
          if (autoDisabledNow && webhookOn && webhookUrl) {
            fireWebhook(webhookUrl, {
              event: 'health_change', instance_id: instanceId,
              status: 'down', error: error ?? 'ping failed',
              consecutive_fails: healthConsecutiveFails + 1,
              threshold: healthCheckFailThreshold,
              timestamp: Math.floor(Date.now() / 1000),
            })
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown error'
        const { autoDisabledNow } = recordHealthFail(instanceId, msg)
        if (autoDisabledNow && webhookOn && webhookUrl) {
          fireWebhook(webhookUrl, {
            event: 'health_change', instance_id: instanceId,
            status: 'down', error: msg,
            consecutive_fails: healthConsecutiveFails + 1,
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
