import { createHash } from 'node:crypto'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FilterClause { field: string; criteria: string; value: string }

export interface SophosStatus { tag: string; code: number; message: string }

export interface SophosResponse {
  apiVersion: string
  loginOk:    boolean
  loginStatus: string
  // Keyed by XML tag. Each value is the list of records for that tag.
  body:       Record<string, Array<Record<string, unknown>>>
  statuses:   SophosStatus[]
}

export type SophosErrorKind = 'auth' | 'not_found' | 'permission' | 'invalid' | 'server'

export class SophosStatusError extends Error {
  code: number
  kind: SophosErrorKind
  constructor(code: number, message: string, kind: SophosErrorKind) {
    super(`sophos status ${code}: ${message}`)
    this.name = 'SophosStatusError'
    this.code = code
    this.kind = kind
  }
}

// ─── Tag / string safety ───────────────────────────────────────────────────────

const TAG_RE = /^[A-Za-z][A-Za-z0-9_]*$/

// Tag-name validation. Throws on anything not /^[A-Za-z][A-Za-z0-9_]*$/.
export function safeXmlTag(tag: unknown, label = 'tag'): string {
  // Reject non-strings up front: String(undefined) is "undefined", which passes TAG_RE
  // and would silently send <undefined> to the device.
  if (typeof tag !== 'string') throw new Error(`Invalid ${label}: expected a tag name, got ${tag === null ? 'null' : typeof tag}`)
  if (!TAG_RE.test(tag)) throw new Error(`Invalid ${label}: "${tag}" — must match ${TAG_RE}`)
  return tag
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ─── Hand-written XML parser ────────────────────────────────────────────────────
// No xml library available. Tokenizer → tree. Handles attributes, self-closing
// tags, CDATA, entity decoding, the XML declaration, and comments. No namespaces,
// no DTDs.

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match: string, ent: string) => {
    if (ent[0] === '#') {
      const isHex = ent[1] === 'x' || ent[1] === 'X'
      const code  = isHex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
      return Number.isNaN(code) ? match : String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[ent] ?? match
  })
}

type Token =
  | { type: 'start'; tag: string; attrs: Record<string, string | undefined>; selfClosing: boolean }
  | { type: 'end'; tag: string }
  | { type: 'text'; value: string }

function findTagEnd(s: string, start: number): number {
  let i = start + 1
  let quote: string | null = null
  while (i < s.length) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '>') {
      return i
    }
    i++
  }
  return -1
}

function parseStartTag(raw: string): { tag: string; attrs: Record<string, string | undefined>; selfClosing: boolean } {
  let body = raw.trim()
  let selfClosing = false
  if (body.endsWith('/')) {
    selfClosing = true
    body = body.slice(0, -1).trim()
  }
  if (!body) throw new Error('sophos: malformed XML: empty tag')

  const spaceIdx  = body.search(/\s/)
  const tag       = spaceIdx === -1 ? body : body.slice(0, spaceIdx)
  const attrsStr  = spaceIdx === -1 ? '' : body.slice(spaceIdx)
  if (!tag) throw new Error('sophos: malformed XML: empty tag')

  const attrs: Record<string, string | undefined> = {}
  const attrRe = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(attrsStr))) {
    const value = m[3] !== undefined ? m[3] : m[4]
    attrs[m[1]] = decodeEntities(value ?? '')
  }
  return { tag, attrs, selfClosing }
}

function tokenize(xml: string): Token[] {
  const tokens: Token[] = []
  const n = xml.length
  let i = 0
  while (i < n) {
    if (xml[i] !== '<') {
      const next = xml.indexOf('<', i)
      const raw  = next === -1 ? xml.slice(i) : xml.slice(i, next)
      if (raw.length) tokens.push({ type: 'text', value: decodeEntities(raw) })
      i = next === -1 ? n : next
      continue
    }

    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4)
      if (end === -1) throw new Error('sophos: malformed XML: unterminated comment')
      i = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9)
      if (end === -1) throw new Error('sophos: malformed XML: unterminated CDATA section')
      tokens.push({ type: 'text', value: xml.slice(i + 9, end) })
      i = end + 3
      continue
    }
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2)
      if (end === -1) throw new Error('sophos: malformed XML: unterminated declaration')
      i = end + 2
      continue
    }
    if (xml.startsWith('<!', i)) {
      const end = xml.indexOf('>', i + 2)
      if (end === -1) throw new Error('sophos: malformed XML: unterminated declaration')
      i = end + 1
      continue
    }
    if (xml[i + 1] === '/') {
      const end = xml.indexOf('>', i)
      if (end === -1) throw new Error('sophos: malformed XML: unterminated closing tag')
      tokens.push({ type: 'end', tag: xml.slice(i + 2, end).trim() })
      i = end + 1
      continue
    }

    const end = findTagEnd(xml, i)
    if (end === -1) throw new Error('sophos: malformed XML: unterminated tag')
    const { tag, attrs, selfClosing } = parseStartTag(xml.slice(i + 1, end))
    tokens.push({ type: 'start', tag, attrs, selfClosing })
    i = end + 1
  }
  return tokens
}

interface XmlNode {
  tag:   string
  attrs: Record<string, string | undefined>
  parts: XmlPart[]
}
type XmlPart = { kind: 'element'; node: XmlNode } | { kind: 'text'; value: string }

function parseXmlTree(xml: string): XmlNode {
  const tokens = tokenize(xml)
  const root: XmlNode = { tag: '#document', attrs: {}, parts: [] }
  const stack: XmlNode[] = [root]
  for (const tok of tokens) {
    const top = stack[stack.length - 1]
    if (tok.type === 'start') {
      const node: XmlNode = { tag: tok.tag, attrs: tok.attrs, parts: [] }
      top.parts.push({ kind: 'element', node })
      if (!tok.selfClosing) stack.push(node)
    } else if (tok.type === 'end') {
      if (stack.length <= 1) throw new Error(`sophos: malformed XML: unexpected closing tag </${tok.tag}>`)
      const node = stack.pop() as XmlNode
      if (node.tag !== tok.tag) throw new Error(`sophos: malformed XML: expected </${node.tag}>, got </${tok.tag}>`)
    } else {
      top.parts.push({ kind: 'text', value: tok.value })
    }
  }
  if (stack.length !== 1) throw new Error(`sophos: malformed XML: unclosed <${stack[stack.length - 1].tag}>`)
  return root
}

function childElements(node: XmlNode): XmlNode[] {
  const out: XmlNode[] = []
  for (const p of node.parts) if (p.kind === 'element') out.push(p.node)
  return out
}

function fullText(node: XmlNode): string {
  let out = ''
  for (const part of node.parts) out += part.kind === 'text' ? part.value : fullText(part.node)
  return out
}

// ─── Record extraction (scalar-or-slice) ───────────────────────────────────────
// Repeated sibling elements accumulate into an array in document order. A single
// occurrence stays a scalar. This is THE correctness property: group membership
// (<FQDNHostList><FQDNHost>a</FQDNHost><FQDNHost>b</FQDNHost></FQDNHostList>) must
// survive a read, or a read-modify-write silently evicts every member but the last.

function elementValue(node: XmlNode): unknown {
  const children = childElements(node)
  return children.length === 0 ? fullText(node).trim() : elementToObject(node)
}

function elementToObject(node: XmlNode): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const child of childElements(node)) {
    const value = elementValue(child)
    if (Object.prototype.hasOwnProperty.call(obj, child.tag)) {
      const prev = obj[child.tag]
      if (Array.isArray(prev)) prev.push(value)
      else obj[child.tag] = [prev, value]
    } else {
      obj[child.tag] = value
    }
  }
  return obj
}

// A <Status code="NNN">msg</Status> anywhere inside a record fragment marks the
// whole fragment as a status, not data — but only when it carries a code
// attribute. <Status>Enable</Status> with no code is an ordinary field.
function findStatusNode(node: XmlNode): XmlNode | null {
  for (const child of childElements(node)) {
    if (child.tag === 'Status' && child.attrs.code !== undefined && child.attrs.code !== '') return child
    const found = findStatusNode(child)
    if (found) return found
  }
  return null
}

function findEmbeddedStatus(node: XmlNode): { code: number; message: string } | null {
  const statusNode = findStatusNode(node)
  if (!statusNode) return null
  const code = Number(statusNode.attrs.code)
  if (!Number.isFinite(code)) return null
  return { code, message: fullText(statusNode).trim() }
}

// ─── Serialisation ──────────────────────────────────────────────────────────────

// Serialise a plain object to XML children. Arrays emit repeated siblings.
// Nested objects recurse. null/undefined values are skipped. Numbers/booleans
// are stringified. Keys are validated with safeXmlTag.
export function objectToXml(body: Record<string, unknown>): string {
  let xml = ''
  for (const [key, value] of Object.entries(body)) {
    if (value === null || value === undefined) continue
    const tag = safeXmlTag(key, 'field name')
    if (Array.isArray(value)) {
      for (const item of value) xml += serializeField(tag, item)
    } else {
      xml += serializeField(tag, value)
    }
  }
  return xml
}

function serializeField(tag: string, value: unknown): string {
  if (value === null || value === undefined) return `<${tag}></${tag}>`
  if (Array.isArray(value)) return value.map(v => serializeField(tag, v)).join('')
  if (typeof value === 'object') return `<${tag}>${objectToXml(value as Record<string, unknown>)}</${tag}>`
  return `<${tag}>${xmlEscape(String(value))}</${tag}>`
}

// ─── Envelope builders ──────────────────────────────────────────────────────────

function buildLogin(username: string, password: string): string {
  return `<Login><Username>${xmlEscape(username)}</Username><Password>${xmlEscape(password)}</Password></Login>`
}

function requestOpenTag(apiVersion?: string): string {
  return apiVersion ? `<Request APIVersion="${xmlEscape(apiVersion)}">` : '<Request>'
}

function wrapRequest(inner: string, username: string, password: string, apiVersion?: string): string {
  return `${requestOpenTag(apiVersion)}${buildLogin(username, password)}${inner}</Request>`
}

function buildFilterXml(f: FilterClause): string {
  return `<Filter><key name="${xmlEscape(f.field)}" criteria="${xmlEscape(f.criteria)}">${xmlEscape(f.value)}</key></Filter>`
}

export function buildGetEnvelope(
  opts: { tag: string; name?: string; filter?: FilterClause; apiVersion?: string },
  username: string, password: string,
): string {
  const tag = safeXmlTag(opts.tag, 'tag')
  if (opts.filter) validateGetFilter(opts.filter)
  const filterXml = opts.filter
    ? buildFilterXml(opts.filter)
    : opts.name !== undefined
      ? buildFilterXml({ field: 'Name', criteria: '=', value: opts.name })
      : ''
  return wrapRequest(`<Get><${tag}>${filterXml}</${tag}></Get>`, username, password, opts.apiVersion)
}

export function buildStatisticsEnvelope(
  opts: { tag: string; filter?: FilterClause; apiVersion?: string },
  username: string, password: string,
): string {
  const tag = safeXmlTag(opts.tag, 'tag')
  if (opts.filter) validateStatsFilter(opts.filter)
  const filterXml = opts.filter ? buildFilterXml(opts.filter) : ''
  // Statistics tags are top-level siblings of Get/Set/Remove, never nested in <Get>.
  return wrapRequest(`<${tag}>${filterXml}</${tag}>`, username, password, opts.apiVersion)
}

export function buildSetEnvelope(
  opts: { operation: 'add' | 'update'; tag: string; body: Record<string, unknown>; apiVersion?: string },
  username: string, password: string,
): string {
  if (opts.operation !== 'add' && opts.operation !== 'update')
    throw new Error(`buildSetEnvelope: operation must be "add" or "update", got "${String(opts.operation)}"`)
  const tag = safeXmlTag(opts.tag, 'tag')
  const bodyXml = objectToXml(opts.body)
  return wrapRequest(`<Set operation="${opts.operation}"><${tag}>${bodyXml}</${tag}></Set>`, username, password, opts.apiVersion)
}

export function buildRemoveEnvelope(
  opts: { tag: string; name: string; keyField?: string; apiVersion?: string },
  username: string, password: string,
): string {
  const tag      = safeXmlTag(opts.tag, 'tag')
  const keyField = safeXmlTag(opts.keyField ?? 'Name', 'keyField')
  return wrapRequest(`<Remove><${tag}><${keyField}>${xmlEscape(opts.name)}</${keyField}></${tag}></Remove>`, username, password, opts.apiVersion)
}

// Wraps user-supplied operation XML. If it already contains <Request>, splice
// <Login> in right after the opening tag; otherwise wrap it.
export function buildRawEnvelope(raw: string, username: string, password: string, apiVersion?: string): string {
  const login = buildLogin(username, password)
  // Match the opening tag with or without attributes — a caller-supplied envelope
  // commonly carries APIVersion, and a bare-tag check would double-wrap it.
  const open = /<Request(\s[^>]*)?>/.exec(raw)
  if (open) return raw.slice(0, open.index + open[0].length) + login + raw.slice(open.index + open[0].length)
  return `${requestOpenTag(apiVersion)}${login}${raw}</Request>`
}

// ─── Response parsing ────────────────────────────────────────────────────────────

// Throws on malformed XML only. Sophos-level failures are surfaced by responseError().
export function parseResponse(xml: string): SophosResponse {
  let root: XmlNode
  try {
    root = parseXmlTree(xml)
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'sophos: malformed XML')
  }

  const result: SophosResponse = { apiVersion: '', loginOk: false, loginStatus: '', body: {}, statuses: [] }
  const response = childElements(root).find(n => n.tag === 'Response')
  if (!response) return result
  result.apiVersion = response.attrs.APIVersion ?? ''

  for (const child of childElements(response)) {
    if (child.tag === 'Login') {
      result.loginStatus = fullText(child).trim()
      result.loginOk     = result.loginStatus === 'Authentication Successful'
      continue
    }

    const status = findEmbeddedStatus(child)
    if (status) {
      result.statuses.push({ tag: child.tag, code: status.code, message: status.message })
      continue
    }

    if (!result.body[child.tag]) result.body[child.tag] = []
    result.body[child.tag].push(elementToObject(child))
  }

  return result
}

// ─── Status mapping ───────────────────────────────────────────────────────────────

function statusToError(code: number, message: string): SophosStatusError | null {
  if (code >= 200 && code < 300) return null
  if (code === 534) return new SophosStatusError(code, message, 'auth')
  if (code === 526) return new SophosStatusError(code, message, 'not_found')
  if (code === 535) return new SophosStatusError(code, message, 'permission')
  if (code >= 500 && code <= 530) return new SophosStatusError(code, message, 'invalid')
  return new SophosStatusError(code, message, 'server')
}

// null when the response is fully successful.
export function responseError(r: SophosResponse): SophosStatusError | null {
  if (!r.loginOk) return new SophosStatusError(534, r.loginStatus, 'auth')
  for (const s of r.statuses) {
    const err = statusToError(s.code, s.message)
    if (err) return err
  }
  return null
}

// ─── Filter validation ────────────────────────────────────────────────────────────

const GET_CRITERIA   = new Set(['=', '!=', 'like'])
const STATS_CRITERIA = new Set(['=', '!=', 'like', 'not like', 'startswith', 'in', '>', '>='])

export function validateGetFilter(f: FilterClause): void {
  if (!f.field) throw new Error('filter: field is required')
  if (!GET_CRITERIA.has(f.criteria))
    throw new Error(`filter: "${f.criteria}" is not a valid Get criteria (allowed: =, !=, like)`)
}

export function validateStatsFilter(f: FilterClause): void {
  if (!f.field) throw new Error('filter: field is required')
  if (!STATS_CRITERIA.has(f.criteria))
    throw new Error(`filter: "${f.criteria}" is not a valid Statistics criteria (allowed: =, !=, like, not like, startswith, in, >, >=)`)
}

// ─── Mutation detection ───────────────────────────────────────────────────────────

// Detect the ELEMENT, then read its operation attribute — never the other way round.
// Matching a specific attribute shape fails open: single quotes, a bare <Set> (which
// SFOS accepts and treats as add), any attribute ordered before operation, or an
// unrecognised operation value would all read as non-mutating and sail through both
// the SOPHOS_READONLY block and raw_xml_get's read-only guard.
const SET_EL_RE  = /<Set(?=[\s/>])[^>]*>/g
const REMOVE_RE  = /<Remove(?=[\s/>])/
const OP_ATTR_RE = /\boperation\s*=\s*(?:"([^"]*)"|'([^']*)')/

export function isMutating(xml: string): { mutating: boolean; verbs: string[] } {
  const verbs = new Set<string>()
  let m: RegExpExecArray | null
  SET_EL_RE.lastIndex = 0
  while ((m = SET_EL_RE.exec(xml))) {
    const op  = OP_ATTR_RE.exec(m[0])
    const val = op ? (op[1] ?? op[2] ?? '') : ''
    verbs.add(val ? `Set:${val}` : 'Set')
  }
  if (REMOVE_RE.test(xml)) verbs.add('Remove')
  return { mutating: verbs.size > 0, verbs: [...verbs].sort() }
}

// ─── Redaction ────────────────────────────────────────────────────────────────────

const USERNAME_RE = /<Username>[\s\S]*?<\/Username>/g
const PASSWORD_RE = /<Password>[\s\S]*?<\/Password>/g

// Idempotent. Rewrites <Username>…</Username> and <Password>…</Password> to ***.
export function redactXml(xml: string): string {
  return xml
    .replace(USERNAME_RE, '<Username>***</Username>')
    .replace(PASSWORD_RE, '<Password>***</Password>')
}

// ─── Diff hash ────────────────────────────────────────────────────────────────────

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value === 'object') {
    const obj  = value as Record<string, unknown>
    const keys = Object.keys(obj).filter(k => k !== '_diffHash' && obj[k] !== undefined).sort()
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// sha256 hex over canonical JSON (recursively key-sorted). Strips `_diffHash`
// before hashing so re-hashing an already-stamped record is stable.
export function diffHash(record: unknown): string {
  return createHash('sha256').update(canonicalize(record)).digest('hex')
}
