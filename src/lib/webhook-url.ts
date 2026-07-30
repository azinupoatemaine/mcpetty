// Shared validation for operator-supplied webhook URLs.
//
// RFC1918 is deliberately allowed — self-hosted deployments legitimately target
// private-network services, and that is a documented product constraint. What is blocked
// is loopback (the MCPetty container itself, including its own API) and link-local
// (169.254.x, which is cloud instance metadata).
export function webhookUrlError(rawUrl: string): string | null {
  let url: URL
  try { url = new URL(rawUrl) } catch { return 'Not a valid URL' }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Webhook URL must be http or https'

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return 'Webhook URL points to a blocked host (loopback)'
  if (host === '::1' || host === '0:0:0:0:0:0:0:1')        return 'Webhook URL points to a blocked host (loopback)'
  if (/^127\./.test(host))                                  return 'Webhook URL points to a blocked host (loopback)'
  if (host === '0.0.0.0')                                   return 'Webhook URL points to a blocked host (unspecified address)'
  if (/^169\.254\./.test(host))                             return 'Webhook URL points to a blocked host (link-local / cloud metadata)'
  if (/^fe80:/i.test(host))                                 return 'Webhook URL points to a blocked host (link-local)'

  return null
}
