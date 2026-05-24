// Shared HTTP helpers for all native MCP handlers.
// Every handler MUST use these instead of raw fetch().

// ─── TLS handling ─────────────────────────────────────────────────────────────

function isPrivateHost(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return (
      hostname === 'localhost' ||
      /^127\./.test(hostname)  ||
      /^10\./.test(hostname)   ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname.endsWith('.local')
    )
  } catch { return false }
}

function isCertError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : '') +
    (e instanceof TypeError && (e as { cause?: Error }).cause ? (e as { cause?: Error }).cause!.message : '')
  return /self.signed|certificate|CERT_|ERR_TLS|unable to verify/i.test(msg)
}

// TLS is disabled globally at startup (instrumentation.ts) for homelab self-signed certs.
// This function exists as a fallback retry path — by the time it's called the env var
// is already set, so no toggling is needed or safe here.
async function fetchInsecure(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init)
}

// ─── Error helpers ────────────────────────────────────────────────────────────

function networkError(baseUrl: string, e: unknown): Error {
  const cause =
    e instanceof TypeError && (e as { cause?: Error }).cause
      ? (e as { cause?: Error }).cause!.message
      : e instanceof Error ? e.message : 'unknown network error'

  const hint = /localhost|127\.0\.0\.1/.test(baseUrl)
    ? ' — "localhost" inside Docker = the MCPetty container. Use your LAN IP instead (e.g. http://10.10.10.x:port)'
    : ''

  return new Error(`Cannot reach ${baseUrl}${hint} — ${cause}`)
}

// ─── Core fetch with auto-retry for self-signed certs on private hosts ────────

async function smartFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (e) {
    if (isCertError(e) && isPrivateHost(url)) {
      return fetchInsecure(url, init)
    }
    throw e
  }
}

// ─── REST API fetch ───────────────────────────────────────────────────────────

export async function restFetch<T>(
  baseUrl:    string,
  path:       string,
  token:      string,
  authHeader: string = 'Authorization',
  authScheme: string = 'Bearer',
  init?:      RequestInit
): Promise<T> {
  const url     = `${baseUrl}${path}`
  const headers = {
    'Content-Type': 'application/json',
    [authHeader]:   authScheme ? `${authScheme} ${token}` : token,
    ...(init?.headers ?? {}),
  }

  let res: Response
  try {
    res = await smartFetch(url, { ...init, headers })
  } catch (e) {
    throw networkError(baseUrl, e)
  }

  if (res.status === 204) return {} as T
  const text = await res.text()
  if (res.status === 401) throw new Error(`401 Unauthorized at ${path} — check your API credentials`)
  if (res.status === 403) throw new Error(`403 Forbidden at ${path} — insufficient permissions`)
  if (res.status === 404) throw new Error(`404 Not Found at ${path} — check the URL or resource ID`)
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${path}: ${text.slice(0, 300)}`)
  return text ? (JSON.parse(text) as T) : ({} as T)
}

// ─── GraphQL fetch ────────────────────────────────────────────────────────────

export async function gqlFetch<T>(
  baseUrl:   string,
  token:     string,
  query:     string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const url     = `${baseUrl}/graphql`
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  const body    = JSON.stringify({ query, variables })

  let res: Response
  try {
    res = await smartFetch(url, { method: 'POST', headers, body })
  } catch (e) {
    throw networkError(baseUrl, e)
  }

  if (res.status === 401) throw new Error(`401 Unauthorized — check your API key`)
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`)
  const data = await res.json() as { data?: T; errors?: Array<{ message: string }> }
  if (data.errors?.length) throw new Error(`GraphQL error: ${data.errors[0].message}`)
  return data.data as T
}
