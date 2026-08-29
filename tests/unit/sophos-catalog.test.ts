import { describe, it, expect } from 'vitest'
import {
  SOPHOS_TAGS,
  resolveTag,
  resolveTagLoose,
  isEmptyStub,
  matchesQuery,
  compactRecord,
  describeHost,
  type SophosTagEntry,
} from '../../src/lib/native/sophos-catalog'

const PORTED_TAGS = [
  'IPHost', 'IPHostGroup', 'Services', 'ServiceGroup', 'FQDNHost', 'FQDNHostGroup',
  'MACHost', 'Zone', 'Interface', 'GatewayConfiguration', 'FirewallRule', 'NATRule',
  'VPNIPsecConnection', 'VPNProfile',
]
const EXTRA_TAGS = ['User', 'LiveUser', 'SSLVPNPolicy', 'AdminSettings']

describe('SOPHOS_TAGS', () => {
  it('contains every ported objects.yaml tag plus the five extra read-only entries', () => {
    const tags = SOPHOS_TAGS.map(e => e.tag)
    for (const t of [...PORTED_TAGS, ...EXTRA_TAGS]) expect(tags).toContain(t)
    expect(tags).toHaveLength(PORTED_TAGS.length + EXTRA_TAGS.length)
  })

  it('has no duplicate tags', () => {
    const tags = SOPHOS_TAGS.map(e => e.tag)
    expect(new Set(tags).size).toBe(tags.length)
  })

  it('every entry has a non-empty tag, description, and array fields', () => {
    for (const e of SOPHOS_TAGS) {
      expect(e.tag.length).toBeGreaterThan(0)
      expect(e.description.length).toBeGreaterThan(0)
      expect(Array.isArray(e.aliases)).toBe(true)
      expect(Array.isArray(e.columns)).toBe(true)
      expect(Array.isArray(e.filterable)).toBe(true)
      expect(typeof e.mutable).toBe('boolean')
    }
  })

  it('marks exactly the objects.yaml-mutable tags plus User as mutable', () => {
    const expectedMutable = new Set([
      'IPHost', 'IPHostGroup', 'Services', 'ServiceGroup', 'FQDNHost', 'FQDNHostGroup',
      'MACHost', 'FirewallRule', 'NATRule', 'VPNIPsecConnection', 'VPNProfile', 'User',
    ])
    for (const e of SOPHOS_TAGS) {
      expect(e.mutable).toBe(expectedMutable.has(e.tag))
    }
  })

  it('gives every extra read-only tag mutable: false except User', () => {
    for (const tag of ['LiveUser', 'SSLVPNPolicy', 'AdminSettings']) {
      const e = SOPHOS_TAGS.find(x => x.tag === tag)
      expect(e?.mutable).toBe(false)
    }
    expect(SOPHOS_TAGS.find(x => x.tag === 'User')?.mutable).toBe(true)
  })

  it('User has keyField Username and filterable [Name, Username]', () => {
    const user = SOPHOS_TAGS.find(x => x.tag === 'User')
    expect(user?.keyField).toBe('Username')
    expect(user?.filterable).toEqual(['Name', 'Username'])
  })

  it('IPHost carries a usageTag; the write-through statistics endpoints for groups match objects.yaml', () => {
    expect(resolveTag('IPHost')?.usageTag).toBe('IPHostStatistics')
    expect(resolveTag('IPHostGroup')?.usageTag).toBe('IPHostGroupStatistics')
    expect(resolveTag('Services')?.usageTag).toBe('ServicesStatistics')
    expect(resolveTag('ServiceGroup')?.usageTag).toBe('ServiceGroupStatistics')
    expect(resolveTag('FQDNHost')?.usageTag).toBe('FQDNHostStatistics')
    expect(resolveTag('FQDNHostGroup')?.usageTag).toBe('FQDNHostGroupStatistics')
    expect(resolveTag('MACHost')?.usageTag).toBe('MACHostStatistics')
    expect(resolveTag('Zone')?.usageTag).toBe('ZoneStatistics')
    expect(resolveTag('Interface')?.usageTag).toBe('InterfaceStatistics')
    expect(resolveTag('GatewayConfiguration')?.usageTag).toBe('GatewayStatistics')
  })

  it('rule-shaped tags (FirewallRule, NATRule, VPN*) carry no usageTag, matching the empty yaml string', () => {
    for (const tag of ['FirewallRule', 'NATRule', 'VPNIPsecConnection', 'VPNProfile', 'LiveUser', 'SSLVPNPolicy', 'AdminSettings']) {
      expect(resolveTag(tag)?.usageTag).toBeUndefined()
    }
  })
})

describe('resolveTag', () => {
  it('resolves a canonical tag', () => {
    expect(resolveTag('IPHost')?.tag).toBe('IPHost')
  })

  it('resolves every documented alias case-insensitively', () => {
    expect(resolveTag('host-ip')?.tag).toBe('IPHost')
    expect(resolveTag('HOST-IP')?.tag).toBe('IPHost')
    expect(resolveTag('Ip-Host')?.tag).toBe('IPHost')
    expect(resolveTag('sslvpn')?.tag).toBe('SSLVPNPolicy')
    expect(resolveTag('SSLVPN')?.tag).toBe('SSLVPNPolicy')
    expect(resolveTag('live-user')?.tag).toBe('LiveUser')
    expect(resolveTag('session')?.tag).toBe('LiveUser')
    expect(resolveTag('local-user')?.tag).toBe('User')
    expect(resolveTag('admin-settings')?.tag).toBe('AdminSettings')
  })

  it('resolves the mixed-case gateway alias verbatim from objects.yaml', () => {
    expect(resolveTag('gateway')?.tag).toBe('GatewayConfiguration')
    expect(resolveTag('Gateway')?.tag).toBe('GatewayConfiguration')
    expect(resolveTag('GATEWAY')?.tag).toBe('GatewayConfiguration')
  })

  it('returns null for an unknown tag or alias', () => {
    expect(resolveTag('NotARealTag')).toBeNull()
    expect(resolveTag('')).toBeNull()
  })

  it('resolves a canonical tag case-insensitively — a model will type it lowercase', () => {
    expect(resolveTag('iphost')?.tag).toBe('IPHost')
    expect(resolveTag('FIREWALLRULE')?.tag).toBe('FirewallRule')
  })
})

describe('resolveTagLoose — security boundary', () => {
  it('resolves known aliases to their canonical tag', () => {
    expect(resolveTagLoose('host-ip')).toBe('IPHost')
    expect(resolveTagLoose('fw-rule')).toBe('FirewallRule')
    expect(resolveTagLoose('user')).toBe('User')
  })

  it('passes through an unknown but well-formed tag name', () => {
    expect(resolveTagLoose('CustomVendorTag')).toBe('CustomVendorTag')
    expect(resolveTagLoose('X')).toBe('X')
    expect(resolveTagLoose('a_1')).toBe('a_1')
  })

  it('rejects XML injection payloads', () => {
    expect(() => resolveTagLoose('IPHost><Set operation="add"')).toThrow()
    expect(() => resolveTagLoose('IPHost><Login><Username>x')).toThrow()
    expect(() => resolveTagLoose('<Foo>')).toThrow()
  })

  it('rejects path traversal payloads', () => {
    expect(() => resolveTagLoose('../')).toThrow()
    expect(() => resolveTagLoose('../../etc/passwd')).toThrow()
  })

  it('rejects tag names containing whitespace', () => {
    expect(() => resolveTagLoose('Name Space')).toThrow()
    expect(() => resolveTagLoose(' IPHost')).toThrow()
    expect(() => resolveTagLoose('IPHost ')).toThrow()
  })

  it('rejects the empty string', () => {
    expect(() => resolveTagLoose('')).toThrow()
  })

  it('rejects a tag name starting with a digit or underscore', () => {
    expect(() => resolveTagLoose('1Host')).toThrow()
    expect(() => resolveTagLoose('_Host')).toThrow()
  })

  it('rejects non-string input', () => {
    for (const v of [123, null, undefined, {}, [], true, Symbol('x')]) {
      expect(() => resolveTagLoose(v)).toThrow()
    }
  })
})

describe('isEmptyStub', () => {
  it('is true when the default key field ("Name") is blank', () => {
    expect(isEmptyStub({ Name: '', IPAddress: '' })).toBe(true)
  })

  it('falls back to scanning the record when the key field is absent', () => {
    expect(isEmptyStub({ IPAddress: '1.2.3.4' })).toBe(false)
    expect(isEmptyStub({ IPAddress: '', Subnet: '' })).toBe(true)
  })

  it('does not drop real rows when the keyField is guessed wrong', () => {
    expect(isEmptyStub({ UserName: 'jdoe', IPAddress: '10.0.0.9' }, 'Name')).toBe(false)
  })

  it('treats a nested-only record as populated', () => {
    expect(isEmptyStub({ Detail: { Port: '443' } })).toBe(false)
  })

  it('is false when the key field has a real value', () => {
    expect(isEmptyStub({ Name: 'web-server', IPAddress: '1.2.3.4' })).toBe(false)
  })

  it('honours a non-default keyField (User uses Username)', () => {
    expect(isEmptyStub({ Username: '', Name: 'ignored' }, 'Username')).toBe(true)
    expect(isEmptyStub({ Name: 'ignored' }, 'Username')).toBe(false)
    expect(isEmptyStub({ Username: 'jdoe', Name: 'ignored' }, 'Username')).toBe(false)
  })

  it('treats null the same as absent/blank', () => {
    expect(isEmptyStub({ Name: null })).toBe(true)
  })
})

describe('matchesQuery', () => {
  it('matches a case-insensitive substring on a scalar leaf', () => {
    expect(matchesQuery({ Name: 'Production-Web' }, 'web')).toBe(true)
    expect(matchesQuery({ Name: 'Production-Web' }, 'WEB')).toBe(true)
    expect(matchesQuery({ Name: 'Production-Web' }, 'nope')).toBe(false)
  })

  it('matches numbers and booleans by their string form', () => {
    expect(matchesQuery({ Port: 4444 }, '444')).toBe(true)
    expect(matchesQuery({ Active: true }, 'true')).toBe(true)
  })

  it('recurses into nested objects', () => {
    expect(matchesQuery({ Rule: { Source: { Zone: 'LAN' } } }, 'lan')).toBe(true)
  })

  it('recurses into arrays, including arrays of objects', () => {
    expect(matchesQuery({ HostList: ['a.example.org', 'b.example.org'] }, 'b.example')).toBe(true)
    expect(matchesQuery({ Rules: [{ Name: 'r1' }, { Name: 'r2-target' }] }, 'target')).toBe(true)
  })

  it('recurses into arrays nested inside objects nested inside arrays', () => {
    const rec = { Rules: [{ Zones: { SourceZones: ['LAN', 'DMZ'] } }] }
    expect(matchesQuery(rec, 'dmz')).toBe(true)
    expect(matchesQuery(rec, 'wan')).toBe(false)
  })

  it('does not throw on null or undefined leaves or roots', () => {
    expect(matchesQuery(null, 'x')).toBe(false)
    expect(matchesQuery(undefined, 'x')).toBe(false)
    expect(matchesQuery({ Name: null, Other: undefined }, 'x')).toBe(false)
  })

  it('does not throw on odd non-circular shapes', () => {
    expect(() => matchesQuery({ When: new Date(0), Fn: () => 1, Sym: Symbol('s') }, 'x')).not.toThrow()
    expect(() => matchesQuery(42, 'x')).not.toThrow()
    expect(() => matchesQuery('a bare string', 'bare')).not.toThrow()
    expect(matchesQuery('a bare string', 'bare')).toBe(true)
  })
})

describe('compactRecord', () => {
  const iphostEntry = resolveTag('IPHost') as SophosTagEntry

  it('keeps the key field plus catalog columns', () => {
    const rec = { Name: 'web', IPFamily: 'IPv4', HostType: 'IP', IPAddress: '1.2.3.4', Subnet: '', Extra: 'drop-me' }
    const out = compactRecord(rec, iphostEntry)
    expect(out).toEqual({ Name: 'web', IPFamily: 'IPv4', HostType: 'IP', IPAddress: '1.2.3.4', Subnet: '', _omitted: ['Extra'] })
    expect(out.Extra).toBeUndefined()
  })

  it('names dropped fields in _omitted so compaction is never silent', () => {
    const rec = { Name: 'web', HostType: 'IP', Comment: 'x', Owner: 'y' }
    expect(compactRecord(rec, iphostEntry)._omitted).toEqual(['Comment', 'Owner'])
  })

  it('adds no _omitted key when nothing was dropped', () => {
    expect(compactRecord({ Name: 'web', HostType: 'IP' }, iphostEntry)).not.toHaveProperty('_omitted')
  })

  it('keeps any array-valued field even if not in columns, so group membership stays visible', () => {
    const groupEntry = resolveTag('IPHostGroup') as SophosTagEntry
    const rec = { Name: 'grp', IPFamily: 'IPv4', HostList: ['a', 'b', 'c'], UnrelatedArray: [1, 2] }
    const out = compactRecord(rec, groupEntry)
    expect(out.HostList).toEqual(['a', 'b', 'c'])
    expect(out.UnrelatedArray).toEqual([1, 2])
  })

  it('uses the entry keyField instead of Name when set', () => {
    const userEntry = resolveTag('User') as SophosTagEntry
    const rec = { Username: 'jdoe', Name: 'John Doe', Group: 'Open Group', Password: 'hunter2' }
    const out = compactRecord(rec, userEntry)
    expect(out.Username).toBe('jdoe')
    expect(out.Password).toBeUndefined()
    expect(out._omitted).toContain('Password')
  })

  it('returns the record unchanged when the entry is null (unknown tag)', () => {
    const rec = { Whatever: 'stays', Nested: { a: 1 } }
    expect(compactRecord(rec, null)).toEqual(rec)
    expect(compactRecord(rec, null)).toBe(rec)
  })

  it('does not fail on a record missing every catalog column', () => {
    expect(compactRecord({ Unrelated: 'x' }, iphostEntry)).toEqual({ _omitted: ['Unrelated'] })
  })
})

describe('describeHost', () => {
  it('describes HostType IP as a /32', () => {
    expect(describeHost({ HostType: 'IP', IPAddress: '10.0.0.5' })).toEqual({ cidr: '10.0.0.5/32', kind: 'IP' })
  })

  it('describes HostType Network with a dotted mask converted to a prefix length', () => {
    expect(describeHost({ HostType: 'Network', IPAddress: '10.0.0.0', Subnet: '255.255.255.0' }))
      .toEqual({ cidr: '10.0.0.0/24', kind: 'Network' })
    expect(describeHost({ HostType: 'Network', IPAddress: '10.0.0.0', Subnet: '255.255.0.0' }))
      .toEqual({ cidr: '10.0.0.0/16', kind: 'Network' })
    expect(describeHost({ HostType: 'Network', IPAddress: '10.0.0.0', Subnet: '255.255.255.255' }))
      .toEqual({ cidr: '10.0.0.0/32', kind: 'Network' })
  })

  it('passes through a subnet that is already a prefix length', () => {
    expect(describeHost({ HostType: 'Network', IPAddress: '10.0.0.0', Subnet: '24' }))
      .toEqual({ cidr: '10.0.0.0/24', kind: 'Network' })
  })

  it('degrades gracefully on an unrecognised subnet instead of fabricating a wrong prefix', () => {
    const out = describeHost({ HostType: 'Network', IPAddress: '10.0.0.0', Subnet: 'not-a-mask' })
    expect(out.kind).toBe('Network')
    expect(out.cidr).toBe('10.0.0.0/not-a-mask')
  })

  it('describes HostType IPRange as Start-End', () => {
    expect(describeHost({ HostType: 'IPRange', StartIPAddress: '10.0.0.1', EndIPAddress: '10.0.0.50' }))
      .toEqual({ cidr: '10.0.0.1-10.0.0.50', kind: 'IPRange' })
  })

  it('describes HostType IPList by joining the list, whether string or array', () => {
    expect(describeHost({ HostType: 'IPList', IPAddressList: '10.0.0.1,10.0.0.2' }))
      .toEqual({ cidr: '10.0.0.1,10.0.0.2', kind: 'IPList' })
    expect(describeHost({ HostType: 'IPList', IPAddressList: ['10.0.0.1', '10.0.0.2', '10.0.0.3'] }))
      .toEqual({ cidr: '10.0.0.1,10.0.0.2,10.0.0.3', kind: 'IPList' })
  })

  it('returns {} for an unrecognised HostType', () => {
    expect(describeHost({ HostType: 'Wat', IPAddress: '1.2.3.4' })).toEqual({})
  })

  it('returns {} when HostType is missing', () => {
    expect(describeHost({ IPAddress: '1.2.3.4' })).toEqual({})
  })

  it('never throws on a malformed record', () => {
    expect(() => describeHost(null as unknown as Record<string, unknown>)).not.toThrow()
    expect(describeHost(null as unknown as Record<string, unknown>)).toEqual({})

    expect(() => describeHost(undefined as unknown as Record<string, unknown>)).not.toThrow()
    expect(() => describeHost('not an object' as unknown as Record<string, unknown>)).not.toThrow()
    expect(() => describeHost(42 as unknown as Record<string, unknown>)).not.toThrow()
    expect(() => describeHost({ HostType: 'IP', IPAddress: 12345 })).not.toThrow()
    expect(describeHost({ HostType: 'IP', IPAddress: 12345 })).toEqual({})
    expect(() => describeHost({ HostType: 'Network', IPAddress: '10.0.0.0', Subnet: null })).not.toThrow()
    expect(() => describeHost({ HostType: {}, IPAddress: '1.2.3.4' })).not.toThrow()
    expect(() => describeHost({ HostType: 'IPRange' })).not.toThrow()
  })
})
