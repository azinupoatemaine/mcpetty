// Shared HTTP helpers for all native MCP handlers.
// Every handler MUST use these instead of raw fetch().

// Node's default fetch (undici) connect timeout is 10s. Ping/status checks run inside
// Promise.all in /api/servers, so one unreachable host stalls the whole dashboard refresh
// for as long as this takes — keep it well under that.
const FETCH_TIMEOUT_MS = 5000

// Body-authenticated backends (Sophos XML API) are slower than a REST call and never run
// on the dashboard probe path, so they get a longer budget than FETCH_TIMEOUT_MS.
const FORM_TIMEOUT_MS = 15000

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

// TLS is disabled globally at startup (instrumentation.ts) for self-signed certs.
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

function withTimeout(init: RequestInit, ms: number = FETCH_TIMEOUT_MS): RequestInit {
  const timeoutSignal = AbortSignal.timeout(ms)
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
  return { ...init, signal }
}

async function smartFetch(url: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
  try {
    return await fetch(url, withTimeout(init, timeoutMs))
  } catch (e) {
    if (isCertError(e) && isPrivateHost(url)) {
      // A fresh signal — the first attempt's timeout budget is already spent, and reusing
      // an expired AbortSignal would abort the retry before it left the process.
      return fetchInsecure(url, withTimeout(init, timeoutMs))
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

// ─── Form-urlencoded fetch ────────────────────────────────────────────────────

// For backends that authenticate inside the request body rather than a header
// (Sophos Firewall's XML API posts a `reqxml` field with credentials embedded in
// the XML). Callers own their own auth — no Authorization header is sent here.
// Returns the raw response body; the caller parses it.
export async function formFetch(
  baseUrl:   string,
  path:      string,
  form:      Record<string, string>,
  timeoutMs: number = FORM_TIMEOUT_MS
): Promise<string> {
  const url     = `${baseUrl}${path}`
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  const body    = new URLSearchParams(form).toString()

  let res: Response
  try {
    res = await smartFetch(url, { method: 'POST', headers, body }, timeoutMs)
  } catch (e) {
    throw networkError(baseUrl, e)
  }

  const text = await res.text()
  if (res.status === 401) throw new Error(`401 Unauthorized at ${path} — check your API credentials`)
  if (res.status === 403) throw new Error(`403 Forbidden at ${path} — insufficient permissions`)
  if (res.status === 404) throw new Error(`404 Not Found at ${path} — check the URL or resource ID`)
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${path}: ${text.slice(0, 300)}`)
  return text
}
