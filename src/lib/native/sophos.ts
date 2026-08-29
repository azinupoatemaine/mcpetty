import { getCredential } from '../db'
import type { MCPTool } from '../mcp-client'
import { formFetch } from './http'
import {
  type FilterClause,
  type SophosResponse,
  SophosStatusError,
  buildGetEnvelope,
  buildStatisticsEnvelope,
  buildSetEnvelope,
  buildRemoveEnvelope,
  buildRawEnvelope,
  parseResponse,
  responseError,
  isMutating,
  redactXml,
  diffHash,
} from './sophos-xml'
import {
  SOPHOS_TAGS,
  type SophosTagEntry,
  resolveTag,
  resolveTagLoose,
  isEmptyStub,
  matchesQuery,
  compactRecord,
  describeHost,
} from './sophos-catalog'

// ─── Tools ────────────────────────────────────────────────────────────────────

export const TOOLS: MCPTool[] = [
  // ── Discovery & system (read) ─────────────────────────────────────────────
  { name: 'list_object_types', description: 'List every Sophos object type this handler knows about — tag name, aliases, filterable fields, and whether it can be written to.', inputSchema: { type: 'object', properties: {} } },
  { name: 'system_info',       description: 'Get SFOS system information (version, model, uptime). Some SFOS builds do not answer this query — returns { supported: false } instead of an error in that case.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_interfaces',   description: 'List network interfaces configured on the firewall.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_zones',        description: 'List network zones (LAN, WAN, DMZ, and custom zones).', inputSchema: { type: 'object', properties: {} } },

  // ── Generic object access (read) ──────────────────────────────────────────
  {
    name: 'object_list',
    description: 'List records of any Sophos object type (tag), with an optional server-side filter. Use list_object_types to see valid tags.',
    inputSchema: {
      type: 'object',
      properties: {
        tag:             { type: 'string', description: 'Catalog tag or alias, e.g. "IPHost" or "host-ip"' },
        filter_field:    { type: 'string', description: 'Field name to filter on' },
        filter_criteria: { type: 'string', enum: ['=', '!=', 'like'], description: 'Default "="' },
        filter_value:    { type: 'string' },
        limit:           { type: 'number', description: 'Max records to return (default 100)' },
        compact:         { type: 'boolean', description: 'Project down to the catalog columns instead of full records (default true)' },
      },
      required: ['tag'],
    },
  },
  {
    name: 'object_get',
    description: 'Fetch a single record of any object type by its identity field (usually Name). Stamps _diffHash for use with update/delete actions.',
    inputSchema: { type: 'object', properties: { tag: { type: 'string' }, name: { type: 'string' } }, required: ['tag', 'name'] },
  },
  {
    name: 'object_search',
    description: 'List records of an object type, then keep only those whose fields contain the query text (case-insensitive substring match anywhere in the record).',
    inputSchema: { type: 'object', properties: { tag: { type: 'string' }, query: { type: 'string' }, limit: { type: 'number', description: 'Default 100' } }, required: ['tag', 'query'] },
  },
  {
    name: 'object_usage',
    description: 'Run a usage/statistics query for an object type that supports one (see usageTag in list_object_types). Throws if the tag has no usage query.',
    inputSchema: { type: 'object', properties: { tag: { type: 'string' }, name: { type: 'string', description: 'Optional — narrows to one record' } }, required: ['tag'] },
  },
  {
    name: 'object_references',
    description: 'Find what references a named object — scans IPHostGroup/FQDNHostGroup/ServiceGroup/FirewallRule/NATRule (or a supplied tag list) for exact mentions of the name. Answers "what breaks if I delete this?" — run this before any delete.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        tag:  { type: 'string', description: 'Primary object type being referenced. Default "IPHost". One of IPHost, FQDNHost, MACHost, Services, Zone.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Override the default referrer tag list' },
      },
      required: ['name'],
    },
  },
  {
    name: 'raw_xml_get',
    description: 'Send a hand-written read-only Sophos request envelope for anything not covered by another action. Rejected if it contains a Set or Remove operation — this action never writes, regardless of SOPHOS_READONLY.',
    inputSchema: { type: 'object', properties: { xml: { type: 'string', description: 'The XML fragment inside <Request>, e.g. "<Get><Zone/></Get>"' } }, required: ['xml'] },
  },

  // ── Typed reads ────────────────────────────────────────────────────────────
  { name: 'list_hosts',          description: 'List IPHost objects, each enriched with a derived CIDR/kind summary. Optional Name substring filter.', inputSchema: { type: 'object', properties: { filter_value: { type: 'string', description: 'Name substring filter' }, limit: { type: 'number' } } } },
  { name: 'get_host',            description: 'Get a single IPHost by name, enriched with a derived CIDR/kind summary. Stamps _diffHash.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'list_host_groups',    description: 'List IPHostGroup objects (host groups and their members).', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'list_fqdn_hosts',     description: 'List FQDNHost objects (DNS-name targets).', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'list_mac_hosts',      description: 'List MACHost objects (MAC address host definitions).', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'list_services',       description: 'List Services objects (TCP/UDP/IP/ICMP service definitions).', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'list_service_groups', description: 'List ServiceGroup objects (service groups and their members).', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  {
    name: 'list_firewall_rules',
    description: 'List firewall rules, optionally filtered by enabled/disabled status and/or IP family.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['Enable', 'Disable'] }, ip_family: { type: 'string', enum: ['IPv4', 'IPv6'] }, limit: { type: 'number' } } },
  },
  { name: 'get_firewall_rule',   description: 'Get a single firewall rule by name. Stamps _diffHash.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'list_nat_rules',      description: 'List NAT rules.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'get_nat_rule',        description: 'Get a single NAT rule by name. Stamps _diffHash.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'list_vpn_ipsec',      description: 'List site-to-site IPsec VPN connections.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'list_vpn_profiles',   description: 'List IKE (Phase 1) VPN profiles.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'list_users',          description: 'List local user accounts, optionally filtered by username substring.', inputSchema: { type: 'object', properties: { username: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'list_live_users',     description: 'List currently active/live user sessions.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_sslvpn_policies', description: 'List SSL VPN remote-access policies.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },

  // ── Mutations (all require confirm: true; updates/deletes also require expected_diff_hash) ──
  {
    name: 'create_host',
    description: 'Create an IPHost object. SAFETY: without confirm: true this returns a preview instead of sending — re-run with confirm: true to apply.',
    inputSchema: {
      type: 'object',
      properties: {
        name:       { type: 'string' },
        host_type:  { type: 'string', enum: ['IP', 'Network', 'IPRange', 'IPList'] },
        ip_address: { type: 'string', description: 'Required for HostType IP or Network' },
        subnet:     { type: 'string', description: 'Required for HostType Network' },
        start_ip:   { type: 'string', description: 'Required for HostType IPRange' },
        end_ip:     { type: 'string', description: 'Required for HostType IPRange' },
        ip_list:    { type: 'string', description: 'Required for HostType IPList' },
        ip_family:  { type: 'string', enum: ['IPv4', 'IPv6'], description: 'Default IPv4' },
        confirm:    { type: 'boolean', description: 'Must be true to actually send the write' },
      },
      required: ['name', 'host_type'],
    },
  },
  {
    name: 'update_host',
    description: 'Update an IPHost object. Sophos update is full-replace, so this reads the current object and merges your fields onto it before sending. SAFETY: requires expected_diff_hash from a prior read (rejects if the object changed since) and confirm: true to apply.',
    inputSchema: {
      type: 'object',
      properties: {
        name:                { type: 'string' },
        host_type:           { type: 'string', enum: ['IP', 'Network', 'IPRange', 'IPList'] },
        ip_address:          { type: 'string' },
        subnet:              { type: 'string' },
        start_ip:            { type: 'string' },
        end_ip:              { type: 'string' },
        ip_list:             { type: 'string' },
        ip_family:           { type: 'string', enum: ['IPv4', 'IPv6'] },
        expected_diff_hash:  { type: 'string', description: '_diffHash from a prior get_host/object_get' },
        confirm:             { type: 'boolean' },
      },
      required: ['name', 'expected_diff_hash'],
    },
  },
  {
    name: 'delete_host',
    description: 'Delete an IPHost object. SAFETY: requires expected_diff_hash from a prior read and confirm: true to apply. Run object_references first — this does not check for you.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, expected_diff_hash: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['name', 'expected_diff_hash'] },
  },
  {
    name: 'create_host_group',
    description: 'Create an IPHostGroup with the given member host names. SAFETY: without confirm: true this returns a preview instead of sending.',
    inputSchema: {
      type: 'object',
      properties: {
        name:        { type: 'string' },
        hosts:       { type: 'array', items: { type: 'string' }, description: 'Member IPHost names' },
        description: { type: 'string' },
        ip_family:   { type: 'string', enum: ['IPv4', 'IPv6'] },
        confirm:     { type: 'boolean' },
      },
      required: ['name', 'hosts'],
    },
  },
  {
    name: 'update_host_group',
    description: 'Replace an IPHostGroup\'s member list and description — the hosts array you pass becomes the entire membership, it is not merged with the existing members. SAFETY: requires expected_diff_hash from a prior read and confirm: true to apply.',
    inputSchema: {
      type: 'object',
      properties: {
        name:                { type: 'string' },
        hosts:               { type: 'array', items: { type: 'string' } },
        description:         { type: 'string' },
        ip_family:           { type: 'string', enum: ['IPv4', 'IPv6'] },
        expected_diff_hash:  { type: 'string' },
        confirm:             { type: 'boolean' },
      },
      required: ['name', 'hosts', 'expected_diff_hash'],
    },
  },
  {
    name: 'delete_host_group',
    description: 'Delete an IPHostGroup. SAFETY: requires expected_diff_hash from a prior read and confirm: true to apply. Run object_references first to check for use in rules.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, expected_diff_hash: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['name', 'expected_diff_hash'] },
  },
  {
    name: 'create_fqdn_host',
    description: 'Create an FQDNHost object. SAFETY: without confirm: true this returns a preview instead of sending.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, fqdn: { type: 'string' }, description: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['name', 'fqdn'] },
  },
  {
    name: 'delete_fqdn_host',
    description: 'Delete an FQDNHost object. SAFETY: requires expected_diff_hash from a prior read and confirm: true to apply.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, expected_diff_hash: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['name', 'expected_diff_hash'] },
  },
  {
    name: 'create_service',
    description: 'Create a Services object (TCPorUDP, IP, or ICMP definition). SAFETY: without confirm: true this returns a preview instead of sending.',
    inputSchema: {
      type: 'object',
      properties: {
        name:         { type: 'string' },
        service_type: { type: 'string', enum: ['TCPorUDP', 'IP', 'ICMP'] },
        protocol:     { type: 'string', description: 'TCPorUDP: "TCP"|"UDP". IP: protocol number/name. Not used for ICMP.' },
        src_port:     { type: 'string', description: 'TCPorUDP only. Default "1:65535".' },
        dst_port:     { type: 'string', description: 'TCPorUDP only, required for that type.' },
        icmp_type:    { type: 'string', description: 'ICMP only, required for that type.' },
        icmp_code:    { type: 'string', description: 'ICMP only, required for that type.' },
        confirm:      { type: 'boolean' },
      },
      required: ['name', 'service_type'],
    },
  },
  {
    name: 'delete_service',
    description: 'Delete a Services object. SAFETY: requires expected_diff_hash from a prior read and confirm: true to apply.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, expected_diff_hash: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['name', 'expected_diff_hash'] },
  },
  {
    name: 'create_service_group',
    description: 'Create a ServiceGroup with the given member service names. SAFETY: without confirm: true this returns a preview instead of sending.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, services: { type: 'array', items: { type: 'string' } }, description: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['name', 'services'] },
  },
  {
    name: 'delete_service_group',
    description: 'Delete a ServiceGroup. SAFETY: requires expected_diff_hash from a prior read and confirm: true to apply.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, expected_diff_hash: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['name', 'expected_diff_hash'] },
  },
  {
    name: 'set_firewall_rule_status',
    description: 'Enable or disable a firewall rule. The single most useful mutation in this handler — reads the whole rule and rewrites it with only Status changed. SAFETY: requires expected_diff_hash from a prior read and confirm: true to apply.',
    inputSchema: {
      type: 'object',
      properties: {
        name:               { type: 'string' },
        status:             { type: 'string', enum: ['Enable', 'Disable'] },
        expected_diff_hash: { type: 'string' },
        confirm:            { type: 'boolean' },
      },
      required: ['name', 'status', 'expected_diff_hash'],
    },
  },
  {
    name: 'object_set',
    description: 'Generic create/update for any object type marked mutable in the catalog (unknown or non-mutable tags are refused). update merges your body onto the current record (full-replace on the wire). SAFETY: confirm: true is required to send; update also requires expected_diff_hash from a prior read.',
    inputSchema: {
      type: 'object',
      properties: {
        tag:                { type: 'string' },
        operation:          { type: 'string', enum: ['add', 'update'] },
        body:               { type: 'object', description: 'Record fields to write, using Sophos XML field names' },
        expected_diff_hash: { type: 'string', description: 'Required when operation is "update"' },
        confirm:            { type: 'boolean' },
      },
      required: ['tag', 'operation', 'body'],
    },
  },
  {
    name: 'object_remove',
    description: 'Generic delete for any object type marked mutable in the catalog (unknown or non-mutable tags are refused). SAFETY: requires expected_diff_hash from a prior read and confirm: true to apply.',
    inputSchema: { type: 'object', properties: { tag: { type: 'string' }, name: { type: 'string' }, expected_diff_hash: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['tag', 'name', 'expected_diff_hash'] },
  },
]

// ─── Credentials ──────────────────────────────────────────────────────────────

interface Cfg {
  base:      string
  username:  string
  password:  string
  apiVersion: string
  readOnly:  boolean
}

// SFOS web console default port. Sophos credentials embed the password inside the
// XML body rather than a header — cfg() never logs or returns `password` directly.
function normalizeBase(raw: string): string {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new Error(`Invalid SOPHOS_URL: "${raw}"`)
  }
  const port = u.port || '4444'
  return `${u.protocol}//${u.hostname}:${port}`
}

function cfg(instanceId: string): Cfg {
  const url      = getCredential(instanceId, 'SOPHOS_URL')
  const username = getCredential(instanceId, 'SOPHOS_USERNAME')
  const password = getCredential(instanceId, 'SOPHOS_PASSWORD')
  if (!url || !username || !password)
    throw new Error('Sophos credentials not configured. Set SOPHOS_URL, SOPHOS_USERNAME, SOPHOS_PASSWORD.')
  const apiVersion  = getCredential(instanceId, 'SOPHOS_API_VERSION') || '2200.1'
  const readOnlyRaw = (getCredential(instanceId, 'SOPHOS_READONLY') ?? '').trim().toLowerCase()
  const readOnly    = readOnlyRaw === 'true' || readOnlyRaw === '1' || readOnlyRaw === 'yes'
  return { base: normalizeBase(url), username, password, apiVersion, readOnly }
}

// ─── Transport ────────────────────────────────────────────────────────────────
// Everything goes through send(). Gate 1 (SOPHOS_READONLY) lives here so a bug in
// any action handler above still cannot reach the network with a mutation.

async function send(c: Cfg, xml: string, timeoutMs?: number): Promise<SophosResponse> {
  const mutating = isMutating(xml)
  if (c.readOnly && mutating.mutating)
    throw new Error(`Sophos instance is read-only (SOPHOS_READONLY) — refused ${mutating.verbs.join(', ')}`)
  const text   = await formFetch(c.base, '/webconsole/APIController', { reqxml: xml }, timeoutMs)
  const parsed = parseResponse(text)
  const err    = responseError(parsed)
  if (err) throw err
  return parsed
}

function get(c: Cfg, tag: string, filter?: FilterClause): string {
  return buildGetEnvelope({ tag, filter, apiVersion: c.apiVersion }, c.username, c.password)
}

function stats(c: Cfg, tag: string, filter?: FilterClause): string {
  return buildStatisticsEnvelope({ tag, filter, apiVersion: c.apiVersion }, c.username, c.password)
}

// _diffHash and _omitted are stamped onto records for the agent's benefit. Strip them
// at the single write chokepoint so a record that was read, passed around and handed
// back can never carry them into a <Set> body.
const SYNTHETIC_FIELDS = ['_diffHash', '_omitted']

function setEnv(c: Cfg, operation: 'add' | 'update', tag: string, body: Record<string, unknown>): string {
  const clean = { ...body }
  for (const f of SYNTHETIC_FIELDS) delete clean[f]
  return buildSetEnvelope({ operation, tag, body: clean, apiVersion: c.apiVersion }, c.username, c.password)
}

function removeEnv(c: Cfg, tag: string, name: string, keyField?: string): string {
  return buildRemoveEnvelope({ tag, name, keyField, apiVersion: c.apiVersion }, c.username, c.password)
}

// ─── Arg helpers ──────────────────────────────────────────────────────────────

function str(v: unknown, label: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`${label} is required`)
  return v
}

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

function numOr(v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function strArray(v: unknown, label: string): string[] {
  if (!Array.isArray(v) || v.length === 0) throw new Error(`${label} is required and must be a non-empty array of strings`)
  return v.map((x, i) => {
    if (typeof x !== 'string' || !x) throw new Error(`${label}[${i}] must be a non-empty string`)
    return x
  })
}

// ─── Record / tag helpers ─────────────────────────────────────────────────────

function keyFieldFor(entry: SophosTagEntry | null): string {
  return entry?.keyField ?? 'Name'
}

// Resolve via the catalog when possible (so callers get keyField/columns/etc.);
// otherwise fall back to resolveTagLoose, which still validates the raw tag name.
function resolveAny(tagArg: unknown): { tag: string; entry: SophosTagEntry | null } {
  const entry = typeof tagArg === 'string' ? resolveTag(tagArg) : null
  const tag   = entry ? entry.tag : resolveTagLoose(tagArg)
  return { tag, entry }
}

async function fetchAll(c: Cfg, tag: string, filter?: FilterClause): Promise<Array<Record<string, unknown>>> {
  const entry = resolveTag(tag)
  const res   = await send(c, get(c, tag, filter))
  return (res.body[tag] ?? []).filter(r => !isEmptyStub(r, keyFieldFor(entry)))
}

async function fetchOne(c: Cfg, tag: string, name: string, keyField: string): Promise<Record<string, unknown> | null> {
  const res     = await send(c, get(c, tag, { field: keyField, criteria: '=', value: name }))
  const records = (res.body[tag] ?? []).filter(r => !isEmptyStub(r, keyField))
  return records[0] ?? null
}

function paginate(tag: string, all: Array<Record<string, unknown>>, limit: number) {
  return { tag, count: all.length, truncated: all.length > limit, items: all.slice(0, limit) }
}

async function listTag(c: Cfg, tag: string, limit: number, filter?: FilterClause) {
  return paginate(tag, await fetchAll(c, tag, filter), limit)
}

// ─── Safety gates ─────────────────────────────────────────────────────────────
// Gate 2 (confirm) and gate 3 (optimistic concurrency). Gate 1 lives in send().

interface PreviewResult {
  preview:   true
  action:    string
  tag:       string
  operation: string
  wouldSend: string
  hint:      string
}

function gate(action: string, tag: string, operation: string, xml: string, confirmArg: unknown): PreviewResult | null {
  if (confirmArg === true) return null
  return { preview: true, action, tag, operation, wouldSend: redactXml(xml), hint: 'Re-run with confirm: true to apply.' }
}

// Re-fetches the object and compares diffHash BEFORE the confirm gate is even
// checked — a stale expected_diff_hash fails fast on a dry-run preview too, not
// just on the real write, matching sophosfw's mutate() ordering.
async function assertCurrentHash(c: Cfg, tag: string, name: string, keyField: string, expectedArg: unknown): Promise<Record<string, unknown>> {
  const expected = str(expectedArg, 'expected_diff_hash')
  const current  = await fetchOne(c, tag, name, keyField)
  if (!current) throw new SophosStatusError(526, `${tag} "${name}" not found`, 'not_found')
  const got = diffHash(current)
  if (got !== expected)
    throw new Error(`Object changed since you read it (expected ${expected}, found ${got}) — re-read ${tag} "${name}" and retry.`)
  return current
}

async function deleteObject(c: Cfg, action: string, tag: string, args: Record<string, unknown>): Promise<unknown> {
  const name = str(args.name, 'name')
  await assertCurrentHash(c, tag, name, 'Name', args.expected_diff_hash)
  const xml     = removeEnv(c, tag, name)
  const preview = gate(action, tag, 'remove', xml, args.confirm)
  if (preview) return preview
  await send(c, xml)
  return { ok: true, deleted: name }
}

// ─── IPHost validation ────────────────────────────────────────────────────────
// Ported from sophosfw's validateHostIPCreate. Only checks missing/unknown
// fields — CIDR validity and range ordering are left to Sophos to reject.

function hostFieldOverrides(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (args.ip_address !== undefined) out.IPAddress = args.ip_address
  if (args.subnet !== undefined) out.Subnet = args.subnet
  if (args.start_ip !== undefined) out.StartIPAddress = args.start_ip
  if (args.end_ip !== undefined) out.EndIPAddress = args.end_ip
  if (args.ip_list !== undefined) out.IPAddressList = args.ip_list
  return out
}

function validateHostType(
  hostType: string,
  f: { IPAddress?: unknown; Subnet?: unknown; StartIPAddress?: unknown; EndIPAddress?: unknown; IPAddressList?: unknown },
): void {
  switch (hostType) {
    case 'Network':
      if (!f.IPAddress || !f.Subnet) throw new Error('HostType=Network requires ip_address and subnet')
      break
    case 'IP':
      if (!f.IPAddress) throw new Error('HostType=IP requires ip_address')
      break
    case 'IPRange':
      if (!f.StartIPAddress || !f.EndIPAddress) throw new Error('HostType=IPRange requires start_ip and end_ip')
      break
    case 'IPList':
      if (!f.IPAddressList) throw new Error('HostType=IPList requires ip_list')
      break
    default:
      throw new Error(`unknown HostType "${hostType}" (expected Network|IP|IPRange|IPList)`)
  }
}

// ─── object_references ────────────────────────────────────────────────────────

const REFERENCE_TARGETS: Record<string, string[]> = {
  IPHost:   ['IPHostGroup', 'FirewallRule', 'NATRule'],
  FQDNHost: ['FQDNHostGroup', 'FirewallRule'],
  MACHost:  ['FirewallRule'],
  Services: ['ServiceGroup', 'FirewallRule', 'NATRule'],
  Zone:     ['FirewallRule'],
}

// EXACT leaf-string equality, not the catalog's substring matchesQuery — a host
// named "LAN" must not be reported as referenced by every rule mentioning "LAN-net".
function recordContainsExact(node: unknown, name: string): boolean {
  if (typeof node === 'string') return node === name
  if (Array.isArray(node)) return node.some(n => recordContainsExact(n, name))
  if (node !== null && typeof node === 'object') return Object.values(node as Record<string, unknown>).some(v => recordContainsExact(v, name))
  return false
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

export async function ping(instanceId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const c   = cfg(instanceId)
    const xml = get(c, 'Zone', { field: 'Name', criteria: '=', value: '__mcpetty_ping_probe__' })
    await send(c, xml, 5000)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export async function call(instanceId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const c = cfg(instanceId)

  switch (toolName) {

    // ── Discovery & system ──────────────────────────────────────────────────

    case 'list_object_types':
      return SOPHOS_TAGS.map(t => ({
        tag: t.tag, aliases: t.aliases, description: t.description,
        filterable: t.filterable, mutable: t.mutable, usageTag: t.usageTag,
      }))

    case 'system_info': {
      try {
        const res = await send(c, get(c, 'SystemInformation'))
        return (res.body.SystemInformation ?? [])[0] ?? {}
      } catch (e) {
        if (e instanceof SophosStatusError && (e.kind === 'invalid' || e.kind === 'server' || e.kind === 'not_found'))
          return { supported: false, hint: `SystemInformation is not supported on this SFOS build (status ${e.code}: ${e.message})` }
        throw e
      }
    }

    case 'list_interfaces': {
      const items = await fetchAll(c, 'Interface')
      return { tag: 'Interface', count: items.length, items }
    }

    case 'list_zones': {
      const items = await fetchAll(c, 'Zone')
      return { tag: 'Zone', count: items.length, items }
    }

    // ── Generic object access ───────────────────────────────────────────────

    case 'object_list': {
      const { tag, entry } = resolveAny(args.tag)
      const limit   = numOr(args.limit, 100)
      const compact = args.compact !== undefined ? args.compact === true : true
      const filter: FilterClause | undefined = args.filter_field !== undefined
        ? { field: String(args.filter_field), criteria: optStr(args.filter_criteria) ?? '=', value: optStr(args.filter_value) ?? '' }
        : undefined
      const all       = await fetchAll(c, tag, filter)
      const truncated = all.length > limit
      const items     = all.slice(0, limit).map(r => compact ? compactRecord(r, entry) : r)
      return { tag, count: all.length, truncated, items }
    }

    case 'object_get': {
      const { tag, entry } = resolveAny(args.tag)
      const keyField = keyFieldFor(entry)
      const name     = str(args.name, 'name')
      const rec      = await fetchOne(c, tag, name, keyField)
      if (!rec) throw new SophosStatusError(526, `${tag} "${name}" not found`, 'not_found')
      return { ...rec, _diffHash: diffHash(rec) }
    }

    case 'object_search': {
      const { tag } = resolveAny(args.tag)
      const query = str(args.query, 'query')
      const limit = numOr(args.limit, 100)
      const all   = (await fetchAll(c, tag)).filter(r => matchesQuery(r, query))
      return paginate(tag, all, limit)
    }

    case 'object_usage': {
      const { tag, entry } = resolveAny(args.tag)
      if (!entry?.usageTag) throw new Error(`${tag} has no usage/statistics query available`)
      const name   = optStr(args.name)
      const filter: FilterClause | undefined = name !== undefined ? { field: keyFieldFor(entry), criteria: '=', value: name } : undefined
      const res    = await send(c, stats(c, entry.usageTag, filter))
      return { tag, usageTag: entry.usageTag, records: res.body[entry.usageTag] ?? [] }
    }

    case 'object_references': {
      const name    = str(args.name, 'name')
      const rawTag  = typeof args.tag === 'string' ? args.tag : 'IPHost'
      const primary = resolveTag(rawTag)
      const primaryTag = primary ? primary.tag : rawTag

      let referrers: string[]
      if (Array.isArray(args.tags) && args.tags.length) {
        referrers = args.tags.map(t => resolveTagLoose(t))
      } else {
        const found = REFERENCE_TARGETS[primaryTag]
        if (!found) throw new Error(`object_references: unknown primary tag "${primaryTag}" (supported: ${Object.keys(REFERENCE_TARGETS).join(', ')})`)
        referrers = found
      }

      const refs: Record<string, string[]> = {}
      const errors: Record<string, string> = {}
      const settled = await Promise.allSettled(referrers.map(async (refTag) => {
        const entry     = resolveTag(refTag)
        const keyField  = keyFieldFor(entry)
        const records   = await fetchAll(c, refTag)
        const matches: string[] = []
        for (const rec of records) {
          if (recordContainsExact(rec, name)) {
            const rn = rec[keyField]
            if (typeof rn === 'string' && rn) matches.push(rn)
          }
        }
        return matches
      }))
      referrers.forEach((refTag, i) => {
        const r = settled[i]
        if (r.status === 'fulfilled') refs[refTag] = r.value
        else errors[refTag] = r.reason instanceof Error ? r.reason.message : String(r.reason)
      })

      const out: { name: string; tag: string; refs: Record<string, string[]>; errors?: Record<string, string> } = { name, tag: primaryTag, refs }
      if (Object.keys(errors).length) out.errors = errors
      return out
    }

    case 'raw_xml_get': {
      const xmlArg = str(args.xml, 'xml')
      if (isMutating(xmlArg).mutating) throw new Error('raw_xml_get only accepts read-only envelopes (no <Set>/<Remove>)')
      const sentXml = buildRawEnvelope(xmlArg, c.username, c.password, c.apiVersion)
      const res     = await send(c, sentXml)
      return { request: redactXml(sentXml), response: res }
    }

    // ── Typed reads ──────────────────────────────────────────────────────────

    case 'list_hosts': {
      const limit  = numOr(args.limit, 100)
      const fv     = optStr(args.filter_value)
      const filter: FilterClause | undefined = fv !== undefined ? { field: 'Name', criteria: 'like', value: fv } : undefined
      const all    = await fetchAll(c, 'IPHost', filter)
      const items  = all.slice(0, limit).map(r => ({ ...r, ...describeHost(r) }))
      return { tag: 'IPHost', count: all.length, truncated: all.length > limit, items }
    }

    case 'get_host': {
      const name = str(args.name, 'name')
      const rec  = await fetchOne(c, 'IPHost', name, 'Name')
      if (!rec) throw new SophosStatusError(526, `IPHost "${name}" not found`, 'not_found')
      return { ...rec, ...describeHost(rec), _diffHash: diffHash(rec) }
    }

    case 'list_host_groups':    return listTag(c, 'IPHostGroup', numOr(args.limit, 100))
    case 'list_fqdn_hosts':     return listTag(c, 'FQDNHost', numOr(args.limit, 100))
    case 'list_mac_hosts':      return listTag(c, 'MACHost', numOr(args.limit, 100))
    case 'list_services':       return listTag(c, 'Services', numOr(args.limit, 100))
    case 'list_service_groups': return listTag(c, 'ServiceGroup', numOr(args.limit, 100))

    case 'list_firewall_rules': {
      const limit     = numOr(args.limit, 100)
      const status    = optStr(args.status)
      const ipFamily  = optStr(args.ip_family)
      if (status !== undefined && status !== 'Enable' && status !== 'Disable') throw new Error('status must be "Enable" or "Disable"')
      if (ipFamily !== undefined && ipFamily !== 'IPv4' && ipFamily !== 'IPv6') throw new Error('ip_family must be "IPv4" or "IPv6"')
      const filter: FilterClause | undefined = status !== undefined ? { field: 'Status', criteria: '=', value: status } : undefined
      let all = await fetchAll(c, 'FirewallRule', filter)
      if (ipFamily !== undefined) all = all.filter(r => r.IPFamily === ipFamily)
      return paginate('FirewallRule', all, limit)
    }

    case 'get_firewall_rule': {
      const name = str(args.name, 'name')
      const rec  = await fetchOne(c, 'FirewallRule', name, 'Name')
      if (!rec) throw new SophosStatusError(526, `FirewallRule "${name}" not found`, 'not_found')
      return { ...rec, _diffHash: diffHash(rec) }
    }

    case 'list_nat_rules': return listTag(c, 'NATRule', numOr(args.limit, 100))

    case 'get_nat_rule': {
      const name = str(args.name, 'name')
      const rec  = await fetchOne(c, 'NATRule', name, 'Name')
      if (!rec) throw new SophosStatusError(526, `NATRule "${name}" not found`, 'not_found')
      return { ...rec, _diffHash: diffHash(rec) }
    }

    case 'list_vpn_ipsec':    return listTag(c, 'VPNIPsecConnection', numOr(args.limit, 100))
    case 'list_vpn_profiles': return listTag(c, 'VPNProfile', numOr(args.limit, 100))

    case 'list_users': {
      const limit    = numOr(args.limit, 100)
      const username = optStr(args.username)
      const filter: FilterClause | undefined = username !== undefined ? { field: 'Username', criteria: 'like', value: username } : undefined
      return listTag(c, 'User', limit, filter)
    }

    case 'list_live_users': {
      const items = await fetchAll(c, 'LiveUser')
      return { tag: 'LiveUser', count: items.length, items }
    }

    case 'list_sslvpn_policies': return listTag(c, 'SSLVPNPolicy', numOr(args.limit, 100))

    // ── Mutations: IPHost ────────────────────────────────────────────────────

    case 'create_host': {
      const name     = str(args.name, 'name')
      const hostType = str(args.host_type, 'host_type')
      const ipFamily = optStr(args.ip_family) ?? 'IPv4'
      if (ipFamily !== 'IPv4' && ipFamily !== 'IPv6') throw new Error('ip_family must be "IPv4" or "IPv6"')
      const overrides = hostFieldOverrides(args)
      validateHostType(hostType, overrides)
      const body    = { Name: name, HostType: hostType, IPFamily: ipFamily, ...overrides }
      const xml     = setEnv(c, 'add', 'IPHost', body)
      const preview = gate('create_host', 'IPHost', 'add', xml, args.confirm)
      if (preview) return preview
      await send(c, xml)
      const created = await fetchOne(c, 'IPHost', name, 'Name')
      return created ? { ...created, _diffHash: diffHash(created) } : { ok: true, name }
    }

    case 'update_host': {
      const name    = str(args.name, 'name')
      const current = await assertCurrentHash(c, 'IPHost', name, 'Name', args.expected_diff_hash)
      const overrides = hostFieldOverrides(args)
      const hostType  = optStr(args.host_type) ?? String(current.HostType ?? '')
      validateHostType(hostType, {
        IPAddress:      overrides.IPAddress ?? current.IPAddress,
        Subnet:         overrides.Subnet ?? current.Subnet,
        StartIPAddress: overrides.StartIPAddress ?? current.StartIPAddress,
        EndIPAddress:   overrides.EndIPAddress ?? current.EndIPAddress,
        IPAddressList:  overrides.IPAddressList ?? current.IPAddressList,
      })
      const ipFamily = optStr(args.ip_family)
      if (ipFamily !== undefined && ipFamily !== 'IPv4' && ipFamily !== 'IPv6') throw new Error('ip_family must be "IPv4" or "IPv6"')
      const merged: Record<string, unknown> = { ...current, Name: name, HostType: hostType, ...overrides }
      if (ipFamily !== undefined) merged.IPFamily = ipFamily
      const xml     = setEnv(c, 'update', 'IPHost', merged)
      const preview = gate('update_host', 'IPHost', 'update', xml, args.confirm)
      if (preview) return preview
      await send(c, xml)
      const updated = await fetchOne(c, 'IPHost', name, 'Name')
      return updated ? { ...updated, _diffHash: diffHash(updated) } : { ok: true, name }
    }

    case 'delete_host': return deleteObject(c, 'delete_host', 'IPHost', args)

    // ── Mutations: IPHostGroup ───────────────────────────────────────────────

    case 'create_host_group': {
      const name  = str(args.name, 'name')
      const hosts = strArray(args.hosts, 'hosts')
      const body: Record<string, unknown> = { Name: name, HostList: { Host: hosts } }
      if (args.description !== undefined) body.Description = args.description
      if (args.ip_family !== undefined) body.IPFamily = args.ip_family
      const xml     = setEnv(c, 'add', 'IPHostGroup', body)
      const preview = gate('create_host_group', 'IPHostGroup', 'add', xml, args.confirm)
      if (preview) return preview
      await send(c, xml)
      const created = await fetchOne(c, 'IPHostGroup', name, 'Name')
      return created ? { ...created, _diffHash: diffHash(created) } : { ok: true, name }
    }

    case 'update_host_group': {
      const name    = str(args.name, 'name')
      const current = await assertCurrentHash(c, 'IPHostGroup', name, 'Name', args.expected_diff_hash)
      const hosts   = strArray(args.hosts, 'hosts')
      const merged: Record<string, unknown> = { ...current, Name: name, HostList: { Host: hosts } }
      if (args.description !== undefined) merged.Description = args.description
      if (args.ip_family !== undefined) merged.IPFamily = args.ip_family
      const xml     = setEnv(c, 'update', 'IPHostGroup', merged)
      const preview = gate('update_host_group', 'IPHostGroup', 'update', xml, args.confirm)
      if (preview) return preview
      await send(c, xml)
      const updated = await fetchOne(c, 'IPHostGroup', name, 'Name')
      return updated ? { ...updated, _diffHash: diffHash(updated) } : { ok: true, name }
    }

    case 'delete_host_group': return deleteObject(c, 'delete_host_group', 'IPHostGroup', args)

    // ── Mutations: FQDNHost ───────────────────────────────────────────────────

    case 'create_fqdn_host': {
      const name = str(args.name, 'name')
      const fqdn = str(args.fqdn, 'fqdn')
      const body: Record<string, unknown> = { Name: name, FQDN: fqdn }
      if (args.description !== undefined) body.Description = args.description
      const xml     = setEnv(c, 'add', 'FQDNHost', body)
      const preview = gate('create_fqdn_host', 'FQDNHost', 'add', xml, args.confirm)
      if (preview) return preview
      await send(c, xml)
      const created = await fetchOne(c, 'FQDNHost', name, 'Name')
      return created ? { ...created, _diffHash: diffHash(created) } : { ok: true, name }
    }

    case 'delete_fqdn_host': return deleteObject(c, 'delete_fqdn_host', 'FQDNHost', args)

    // ── Mutations: Services / ServiceGroup ───────────────────────────────────

    case 'create_service': {
      const name        = str(args.name, 'name')
      const serviceType = str(args.service_type, 'service_type')
      if (serviceType !== 'TCPorUDP' && serviceType !== 'IP' && serviceType !== 'ICMP')
        throw new Error('service_type must be one of TCPorUDP, IP, ICMP')
      const detail: Record<string, unknown> = {}
      if (serviceType === 'TCPorUDP') {
        const protocol = optStr(args.protocol)
        const dstPort  = optStr(args.dst_port)
        if (!protocol || !dstPort) throw new Error('service_type=TCPorUDP requires protocol ("TCP"|"UDP") and dst_port')
        detail.Protocol        = protocol
        detail.SourcePort      = optStr(args.src_port) ?? '1:65535'
        detail.DestinationPort = dstPort
      } else if (serviceType === 'IP') {
        const protocol = optStr(args.protocol)
        if (!protocol) throw new Error('service_type=IP requires protocol (protocol number or name)')
        detail.Protocol = protocol
      } else {
        const icmpType = optStr(args.icmp_type)
        const icmpCode = optStr(args.icmp_code)
        if (!icmpType || !icmpCode) throw new Error('service_type=ICMP requires icmp_type and icmp_code')
        detail.ICMPType = icmpType
        detail.ICMPCode = icmpCode
      }
      const body    = { Name: name, Type: serviceType, ServiceDetails: { ServiceDetail: detail } }
      const xml     = setEnv(c, 'add', 'Services', body)
      const preview = gate('create_service', 'Services', 'add', xml, args.confirm)
      if (preview) return preview
      await send(c, xml)
      const created = await fetchOne(c, 'Services', name, 'Name')
      return created ? { ...created, _diffHash: diffHash(created) } : { ok: true, name }
    }

    case 'delete_service': return deleteObject(c, 'delete_service', 'Services', args)

    case 'create_service_group': {
      const name     = str(args.name, 'name')
      const services = strArray(args.services, 'services')
      const body: Record<string, unknown> = { Name: name, ServiceList: { Service: services } }
      if (args.description !== undefined) body.Description = args.description
      const xml     = setEnv(c, 'add', 'ServiceGroup', body)
      const preview = gate('create_service_group', 'ServiceGroup', 'add', xml, args.confirm)
      if (preview) return preview
      await send(c, xml)
      const created = await fetchOne(c, 'ServiceGroup', name, 'Name')
      return created ? { ...created, _diffHash: diffHash(created) } : { ok: true, name }
    }

    case 'delete_service_group': return deleteObject(c, 'delete_service_group', 'ServiceGroup', args)

    // ── Mutations: FirewallRule ───────────────────────────────────────────────

    case 'set_firewall_rule_status': {
      const name   = str(args.name, 'name')
      const status = str(args.status, 'status')
      if (status !== 'Enable' && status !== 'Disable') throw new Error('status must be "Enable" or "Disable"')
      const current = await assertCurrentHash(c, 'FirewallRule', name, 'Name', args.expected_diff_hash)
      const merged: Record<string, unknown> = { ...current, Status: status }
      const xml     = setEnv(c, 'update', 'FirewallRule', merged)
      const preview = gate('set_firewall_rule_status', 'FirewallRule', 'update', xml, args.confirm)
      if (preview) return preview
      await send(c, xml)
      const updated = await fetchOne(c, 'FirewallRule', name, 'Name')
      return updated ? { ...updated, _diffHash: diffHash(updated) } : { ok: true, name }
    }

    // ── Generic write path ────────────────────────────────────────────────────

    case 'object_set': {
      const entry = typeof args.tag === 'string' ? resolveTag(args.tag) : null
      if (!entry || !entry.mutable) throw new Error(`object_set: tag "${String(args.tag)}" is unknown or not mutable`)
      const tag = entry.tag
      const operation = args.operation
      if (operation !== 'add' && operation !== 'update') throw new Error('operation must be "add" or "update"')
      if (args.body === null || typeof args.body !== 'object' || Array.isArray(args.body)) throw new Error('body must be an object')
      const bodyIn   = args.body as Record<string, unknown>
      const keyField = keyFieldFor(entry)
      let body: Record<string, unknown> = bodyIn
      if (operation === 'update') {
        const name = typeof bodyIn[keyField] === 'string' ? bodyIn[keyField] as string : ''
        if (!name) throw new Error(`object_set: body.${keyField} is required to identify the record for update`)
        const current = await assertCurrentHash(c, tag, name, keyField, args.expected_diff_hash)
        body = { ...current, ...bodyIn }
      }
      const xml     = setEnv(c, operation, tag, body)
      const preview = gate('object_set', tag, operation, xml, args.confirm)
      if (preview) return preview
      await send(c, xml)
      const nameForFetch = typeof body[keyField] === 'string' ? body[keyField] as string : undefined
      const result = nameForFetch ? await fetchOne(c, tag, nameForFetch, keyField) : null
      return result ? { ...result, _diffHash: diffHash(result) } : { ok: true }
    }

    case 'object_remove': {
      const entry = typeof args.tag === 'string' ? resolveTag(args.tag) : null
      if (!entry || !entry.mutable) throw new Error(`object_remove: tag "${String(args.tag)}" is unknown or not mutable`)
      const tag      = entry.tag
      const keyField = keyFieldFor(entry)
      const name     = str(args.name, 'name')
      await assertCurrentHash(c, tag, name, keyField, args.expected_diff_hash)
      const xml     = removeEnv(c, tag, name, keyField)
      const preview = gate('object_remove', tag, 'remove', xml, args.confirm)
      if (preview) return preview
      await send(c, xml)
      return { ok: true, deleted: name }
    }

    default:
      throw new Error(`Unknown Sophos tool: ${toolName}`)
  }
}
