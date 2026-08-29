// Verified tag catalog for the Sophos Firewall (SFOS) native handler — no XML or
// network knowledge here, just the tag registry and record-shaping helpers shared
// by the handler and gateway layer.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SophosTagEntry {
  tag:         string
  aliases:     string[]
  description: string
  columns:     string[]      // interesting fields, used to build compact list output
  filterable:  string[]
  usageTag?:   string        // *Statistics tag, when the object supports usage queries
  mutable:     boolean       // whether write actions are allowed against it
  keyField?:   string        // identity field, default 'Name'
}

// ─── Catalog ──────────────────────────────────────────────────────────────────

export const SOPHOS_TAGS: SophosTagEntry[] = [
  // Ported verbatim from sophosfw/internal/catalog/objects.yaml
  { tag: 'IPHost',              aliases: ['host-ip', 'ip-host'],                             description: 'IP host objects (single addresses, ranges, networks)',                      columns: ['Name', 'IPFamily', 'HostType', 'IPAddress', 'Subnet'],                   filterable: ['Name', 'IPAddress', 'IPFamily', 'HostType'], usageTag: 'IPHostStatistics',       mutable: true },
  { tag: 'IPHostGroup',         aliases: ['host-group', 'ip-host-group'],                    description: 'Group of IPHost objects',                                                   columns: ['Name', 'IPFamily', 'HostList'],                                          filterable: ['Name', 'IPFamily'],                          usageTag: 'IPHostGroupStatistics',  mutable: true },
  { tag: 'Services',            aliases: ['service'],                                        description: 'Service objects (TCP/UDP/IP/ICMP definitions)',                             columns: ['Name', 'Type', 'ServiceDetails'],                                        filterable: ['Name', 'Type'],                              usageTag: 'ServicesStatistics',     mutable: true },
  { tag: 'ServiceGroup',        aliases: ['service-group'],                                  description: 'Group of Services objects',                                                 columns: ['Name', 'ServiceList'],                                                   filterable: ['Name'],                                      usageTag: 'ServiceGroupStatistics', mutable: true },
  { tag: 'FQDNHost',            aliases: ['fqdn', 'fqdn-host', 'host-fqdn'],                 description: 'FQDN host objects (DNS-name targets)',                                      columns: ['Name', 'FQDN', 'IPFamily'],                                              filterable: ['Name', 'FQDN', 'IPFamily'],                  usageTag: 'FQDNHostStatistics',     mutable: true },
  { tag: 'FQDNHostGroup',       aliases: ['fqdn-group'],                                     description: 'Group of FQDN host objects',                                                columns: ['Name', 'FQDNHostList'],                                                  filterable: ['Name'],                                      usageTag: 'FQDNHostGroupStatistics', mutable: true },
  { tag: 'MACHost',             aliases: ['mac', 'mac-host', 'host-mac'],                    description: 'MAC address host objects',                                                  columns: ['Name', 'Type', 'MACAddress'],                                            filterable: ['Name', 'Type', 'MACAddress'],                usageTag: 'MACHostStatistics',      mutable: true },
  { tag: 'Zone',                aliases: ['zone'],                                           description: 'Network zones (LAN, WAN, DMZ, custom)',                                     columns: ['Name', 'Type', 'Description'],                                           filterable: ['Name', 'Type'],                              usageTag: 'ZoneStatistics',         mutable: false },
  { tag: 'Interface',           aliases: ['interface'],                                      description: 'Network interfaces',                                                        columns: ['Name', 'Hardware', 'IPAddress', 'NetworkZone'],                          filterable: ['Name', 'Hardware'],                          usageTag: 'InterfaceStatistics',    mutable: false },
  { tag: 'GatewayConfiguration', aliases: ['gateway', 'Gateway'],                            description: 'Gateways used in WAN/SD-WAN (Sophos uses the GatewayConfiguration XML tag)', columns: ['Name', 'IPAddress', 'GatewayType'],                                      filterable: ['Name', 'IPAddress'],                         usageTag: 'GatewayStatistics',      mutable: false },
  { tag: 'FirewallRule',        aliases: ['firewall-rule', 'fw-rule'],                       description: 'Firewall rules',                                                            columns: ['Name', 'Status', 'Position', 'IPFamily', 'Action', 'SourceZones', 'DestinationZones'], filterable: ['Name', 'Status', 'IPFamily'],       mutable: true },
  { tag: 'NATRule',             aliases: ['nat-rule', 'nat'],                                description: 'NAT rules (linked NAT, source NAT)',                                        columns: ['Name', 'Status', 'Position', 'OriginalSource', 'TranslatedSource'],       filterable: ['Name', 'Status'],                            mutable: true },
  { tag: 'VPNIPsecConnection',  aliases: ['vpn-ipsec', 'ipsec-tunnel', 'ipsec-connection'],   description: 'Site-to-site IPsec VPN tunnels',                                            columns: ['Name', 'Status', 'ConnectionType', 'AuthenticationType', 'Strategy'],     filterable: ['Name', 'Status', 'ConnectionType'],          mutable: true },
  { tag: 'VPNProfile',          aliases: ['ike-profile', 'vpn-ike-profile', 'vpn-profile'],  description: 'IKE (Phase 1) policies / VPN profiles',                                     columns: ['Name', 'AuthenticationMode'],                                             filterable: ['Name'],                                      mutable: true },

  // Read-only additions verified against sophos-firewall-mcp. AdminSettings carries no
  // columns because its field shape is unverified — better empty than invented.
  { tag: 'User',           aliases: ['user', 'local-user'],   description: 'Local user accounts',                        columns: ['Username', 'Name', 'Group', 'Email'], filterable: ['Name', 'Username'],       mutable: true,  keyField: 'Username' },
  { tag: 'LiveUser',       aliases: ['live-user', 'session'], description: 'Active/live user sessions (read-only)',      columns: ['UserName', 'IPAddress', 'Zone', 'LoginTime'], filterable: ['UserName', 'IPAddress'], mutable: false, keyField: 'UserName' },
  { tag: 'SSLVPNPolicy',   aliases: ['sslvpn', 'sslvpn-policy'], description: 'SSL VPN remote-access policies (read-only)', columns: ['Name', 'Description', 'PolicyMembers'], filterable: ['Name'],                mutable: false },
  { tag: 'AdminSettings',  aliases: ['admin-settings'],       description: 'Appliance-wide admin console settings (read-only)', columns: [], filterable: [],                                                              mutable: false },
]

const TAG_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/

const TAG_INDEX   = new Map(SOPHOS_TAGS.map(e => [e.tag.toLowerCase(), e]))
const ALIAS_INDEX = new Map<string, SophosTagEntry>()
for (const entry of SOPHOS_TAGS) {
  for (const alias of entry.aliases) ALIAS_INDEX.set(alias.toLowerCase(), entry)
}

// ─── Resolution ───────────────────────────────────────────────────────────────

export function resolveTag(tagOrAlias: string): SophosTagEntry | null {
  const k = tagOrAlias.toLowerCase()
  return TAG_INDEX.get(k) ?? ALIAS_INDEX.get(k) ?? null
}

export function resolveTagLoose(tagOrAlias: unknown): string {
  if (typeof tagOrAlias === 'string') {
    const known = resolveTag(tagOrAlias)
    if (known) return known.tag
  }
  if (typeof tagOrAlias !== 'string' || !TAG_NAME_RE.test(tagOrAlias)) {
    const shown = typeof tagOrAlias === 'string' ? tagOrAlias : String(tagOrAlias)
    throw new Error(`Invalid Sophos tag name: ${shown}`)
  }
  return tagOrAlias
}

// ─── Record helpers ───────────────────────────────────────────────────────────

// Sophos answers an empty result set with a stub record whose fields are all blank.
// When the key field is absent we fall back to scanning the whole record rather than
// declaring a stub: a mis-guessed keyField would otherwise drop every real row.
export function isEmptyStub(rec: Record<string, unknown>, keyField: string = 'Name'): boolean {
  if (rec === null || typeof rec !== 'object') return true
  if (keyField in rec) {
    const v = rec[keyField]
    return v === undefined || v === null || v === ''
  }
  return !Object.values(rec).some(v => hasContent(v))
}

function hasContent(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false
  if (Array.isArray(v)) return v.some(hasContent)
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some(hasContent)
  return true
}

export function matchesQuery(rec: unknown, query: string): boolean {
  const needle = query.toLowerCase()
  const visit = (node: unknown): boolean => {
    if (node === null || node === undefined) return false
    if (typeof node === 'string') return node.toLowerCase().includes(needle)
    if (typeof node === 'number' || typeof node === 'boolean') return String(node).toLowerCase().includes(needle)
    if (Array.isArray(node)) return node.some(visit)
    if (typeof node === 'object') return Object.values(node as Record<string, unknown>).some(visit)
    return false
  }
  return visit(rec)
}

export function compactRecord(rec: Record<string, unknown>, entry: SophosTagEntry | null): Record<string, unknown> {
  if (!entry) return rec
  const keyField = entry.keyField ?? 'Name'
  const keep = new Set([keyField, ...entry.columns])
  const out: Record<string, unknown> = {}
  const omitted: string[] = []
  for (const [k, v] of Object.entries(rec)) {
    if (keep.has(k) || Array.isArray(v)) out[k] = v
    else omitted.push(k)
  }
  // Name what was dropped. Some catalog `columns` lists are best-effort, so silent
  // compaction would hide real fields with no way for the caller to know to ask.
  if (omitted.length) out._omitted = omitted
  return out
}

// ─── Host description ─────────────────────────────────────────────────────────

function subnetMaskToPrefix(mask: string): number | null {
  const octets = mask.split('.').map(Number)
  if (octets.length !== 4 || octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)) return null
  const bits = octets.map(o => o.toString(2).padStart(8, '0')).join('')
  if (!/^1*0*$/.test(bits)) return null
  return (bits.match(/1/g) ?? []).length
}

export function describeHost(rec: Record<string, unknown>): { cidr?: string; kind?: string } {
  try {
    if (rec === null || typeof rec !== 'object') return {}
    const hostType = rec.HostType
    if (typeof hostType !== 'string') return {}

    if (hostType === 'IP') {
      const ip = rec.IPAddress
      if (typeof ip !== 'string' || !ip) return {}
      return { cidr: `${ip}/32`, kind: 'IP' }
    }

    if (hostType === 'Network') {
      const ip     = rec.IPAddress
      const subnet = rec.Subnet
      if (typeof ip !== 'string' || !ip || typeof subnet !== 'string' || !subnet) return { kind: 'Network' }
      if (/^\d+$/.test(subnet)) return { cidr: `${ip}/${subnet}`, kind: 'Network' }
      const prefix = subnetMaskToPrefix(subnet)
      return { cidr: `${ip}/${prefix ?? subnet}`, kind: 'Network' }
    }

    if (hostType === 'IPRange') {
      const start = rec.StartIPAddress
      const end   = rec.EndIPAddress
      if (typeof start !== 'string' || !start || typeof end !== 'string' || !end) return { kind: 'IPRange' }
      return { cidr: `${start}-${end}`, kind: 'IPRange' }
    }

    if (hostType === 'IPList') {
      const list = rec.IPAddressList
      if (typeof list === 'string' && list) return { cidr: list, kind: 'IPList' }
      if (Array.isArray(list) && list.length) {
        return { cidr: list.filter((x): x is string => typeof x === 'string').join(','), kind: 'IPList' }
      }
      return { kind: 'IPList' }
    }

    return {}
  } catch {
    return {}
  }
}
