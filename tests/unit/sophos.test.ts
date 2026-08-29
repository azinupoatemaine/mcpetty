import { describe, it, expect, vi, afterEach } from 'vitest'
import type { MCPTool } from '../../src/lib/mcp-client'
import { diffHash, objectToXml, parseResponse } from '../../src/lib/native/sophos-xml'

// sophos.ts pulls credentials from the DB (which opens SQLite on import) and reaches
// the network exclusively through formFetch. Both are stubbed — no real DB, no real
// network call should ever happen while this file runs.
const state = vi.hoisted(() => ({
  creds: {
    SOPHOS_URL:         'https://fw.example.com:4444',
    SOPHOS_USERNAME:    'admin',
    SOPHOS_PASSWORD:    'p@ssw0rd-CANARY-9f31',
    SOPHOS_API_VERSION: '2200.1',
    SOPHOS_READONLY:    null,
  } as Record<string, string | null>,
  calls: [] as Array<{ baseUrl: string; path: string; form: Record<string, string>; timeoutMs?: number }>,
  queue: [] as Array<string | Error>,
  fallback: '<?xml version="1.0" encoding="UTF-8"?><Response APIVersion="2200.1"><Login><status>Authentication Successful</status></Login></Response>',
}))

vi.mock('../../src/lib/db', () => ({
  getCredential: (_instanceId: string, key: string) => state.creds[key] ?? null,
}))

vi.mock('../../src/lib/native/http', () => ({
  formFetch: vi.fn(async (baseUrl: string, path: string, form: Record<string, string>, timeoutMs?: number) => {
    state.calls.push({ baseUrl, path, form, timeoutMs })
    const next = state.queue.length ? state.queue.shift()! : state.fallback
    if (next instanceof Error) throw next
    return next
  }),
}))

const { call, ping, TOOLS } = await import('../../src/lib/native/sophos')

afterEach(() => {
  state.calls.length = 0
  state.queue.length = 0
  state.creds.SOPHOS_READONLY = null
})

const PASSWORD_CANARY = state.creds.SOPHOS_PASSWORD as string
const IID = 'sophos1'

// ─── Fixture builders ───────────────────────────────────────────────────────────

function wrapResponse(bodyXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response APIVersion="2200.1"><Login><status>Authentication Successful</status></Login>${bodyXml}</Response>`
}

const AUTH_FAILURE_XML = `<?xml version="1.0" encoding="UTF-8"?><Response APIVersion="2200.1"><Login><status>Authentication Failure</status></Login></Response>`

function fixtureXml(tag: string, fields: Record<string, unknown>): string {
  return `<${tag} transactionid="">${objectToXml(fields)}</${tag}>`
}

function fixtureList(tag: string, recs: Array<Record<string, unknown>>): string {
  return recs.map(r => fixtureXml(tag, r)).join('')
}

function statusResponse(tag: string, code: number, message: string): string {
  return wrapResponse(`<${tag} transactionid=""><Status code="${code}">${message}</Status></${tag}>`)
}

// Queues a realistic GET response for `tag`/`fields` and returns the diffHash it
// will round-trip to — the same value the handler's assertCurrentHash will compute
// after parsing the fixture back into a record.
function queueRead(tag: string, fields: Record<string, unknown>): string {
  state.queue.push(wrapResponse(fixtureXml(tag, fields)))
  return diffHash(fields)
}

const IPHOST_REC        = { Name: 'LAN-network', IPFamily: 'IPv4', HostType: 'Network', IPAddress: '10.0.0.0', Subnet: '255.255.255.0' }
const IPHOSTGROUP_REC   = { Name: 'infra-group', IPFamily: 'IPv4', Description: 'Infra hosts', HostList: { Host: ['LAN-network', 'DMZ', 'mail01'] } }
const FQDNHOST_REC      = { Name: 'fq1', FQDN: 'example.com', IPFamily: 'IPv4' }
const SERVICES_REC      = { Name: 'svc1', Type: 'TCPorUDP', ServiceDetails: { ServiceDetail: { Protocol: 'TCP', SourcePort: '1:65535', DestinationPort: '80' } } }
const SERVICEGROUP_REC  = { Name: 'sg1', Description: 'grp', ServiceList: { Service: ['svc1', 'svc2'] } }
const FIREWALLRULE_REC  = { Name: 'rule1', Status: 'Enable', Action: 'Accept', Position: 'Top', IPFamily: 'IPv4' }

interface PreviewResult { preview: boolean; wouldSend: string; action: string; tag: string; operation: string }
interface DiffHashed { _diffHash: string; [key: string]: unknown }
interface RefsResult { name: string; tag: string; refs: Record<string, string[]>; errors?: Record<string, string> }
interface RawXmlResult { request: string; response: unknown }

// ─── Derive the mutating action set programmatically from TOOLS ─────────────────
// A tool is "mutating" iff its inputSchema declares a `confirm` property. This is
// intentionally not a hand-typed list — it must track TOOLS as the handler evolves.

function isMutatingTool(tool: MCPTool): boolean {
  const props = tool.inputSchema.properties
  return !!props && Object.prototype.hasOwnProperty.call(props, 'confirm')
}

const MUTATING_ACTIONS = TOOLS.filter(isMutatingTool).map(t => t.name)

// Plausible args (minus `confirm`) for every mutating action. Actions that need
// expected_diff_hash also queue the prior-read fixture that makes it valid, via
// queueRead — call the factory fresh inside each test so the queue is right.
const MUT_CASES: Record<string, () => Record<string, unknown>> = {
  create_host:              () => ({ name: 'new-host', host_type: 'IP', ip_address: '10.1.1.1' }),
  update_host:               () => ({ name: 'LAN-network', ip_address: '10.0.0.55', expected_diff_hash: queueRead('IPHost', IPHOST_REC) }),
  delete_host:                () => ({ name: 'LAN-network', expected_diff_hash: queueRead('IPHost', IPHOST_REC) }),
  create_host_group:        () => ({ name: 'new-group', hosts: ['a', 'b'] }),
  update_host_group:         () => ({ name: 'infra-group', hosts: ['a', 'b'], expected_diff_hash: queueRead('IPHostGroup', IPHOSTGROUP_REC) }),
  delete_host_group:          () => ({ name: 'infra-group', expected_diff_hash: queueRead('IPHostGroup', IPHOSTGROUP_REC) }),
  create_fqdn_host:         () => ({ name: 'newfq', fqdn: 'test.example.com' }),
  delete_fqdn_host:            () => ({ name: 'fq1', expected_diff_hash: queueRead('FQDNHost', FQDNHOST_REC) }),
  create_service:           () => ({ name: 'newsvc', service_type: 'TCPorUDP', protocol: 'TCP', dst_port: '443' }),
  delete_service:              () => ({ name: 'svc1', expected_diff_hash: queueRead('Services', SERVICES_REC) }),
  create_service_group:     () => ({ name: 'newsg', services: ['svc1', 'svc2'] }),
  delete_service_group:        () => ({ name: 'sg1', expected_diff_hash: queueRead('ServiceGroup', SERVICEGROUP_REC) }),
  set_firewall_rule_status:  () => ({ name: 'rule1', status: 'Disable', expected_diff_hash: queueRead('FirewallRule', FIREWALLRULE_REC) }),
  object_set:                () => ({ tag: 'IPHost', operation: 'add', body: { Name: 'objset-host', HostType: 'IP', IPAddress: '10.2.2.2', IPFamily: 'IPv4' } }),
  object_remove:               () => ({ tag: 'IPHost', name: 'LAN-network', expected_diff_hash: queueRead('IPHost', IPHOST_REC) }),
}

function sentAMutatingEnvelope(): boolean {
  return state.calls.some(c => /<Set\s/.test(c.form.reqxml) || /<Remove[\s>]/.test(c.form.reqxml))
}

// ─── Claim 1: no mutating action can reach the network without confirm: true ────

describe('claim 1: confirm gate blocks every mutating action', () => {
  it('MUT_CASES covers exactly the mutating actions derived from TOOLS (no hand-typed drift)', () => {
    expect(new Set(Object.keys(MUT_CASES))).toEqual(new Set(MUTATING_ACTIONS))
    expect(MUTATING_ACTIONS.length).toBeGreaterThan(0)
  })

  const SNEAKY: Array<[string, unknown]> = [
    ['omitted', undefined],
    ['string "true"', 'true'],
    ['number 1', 1],
    ['string "yes"', 'yes'],
    ['empty array', []],
    ['empty object', {}],
  ]

  for (const action of MUTATING_ACTIONS) {
    describe(action, () => {
      for (const [label, confirmValue] of SNEAKY) {
        it(`blocked when confirm is ${label}`, async () => {
          const args = MUT_CASES[action]()
          if (confirmValue !== undefined) args.confirm = confirmValue
          const result = await call(IID, action, args) as PreviewResult
          expect(result.preview).toBe(true)
          expect(sentAMutatingEnvelope()).toBe(false)
        })
      }

      it('proceeds and sends when confirm: true', async () => {
        const args = MUT_CASES[action]()
        args.confirm = true
        await call(IID, action, args)
        expect(sentAMutatingEnvelope()).toBe(true)
      })
    })
  }
})

// ─── Claim 2: SOPHOS_READONLY blocks every mutation at the transport layer ──────

describe('claim 2: SOPHOS_READONLY blocks every mutation at the transport layer', () => {
  for (const action of MUTATING_ACTIONS) {
    it(`${action} throws even with confirm: true when SOPHOS_READONLY=true`, async () => {
      state.creds.SOPHOS_READONLY = 'true'
      const args = MUT_CASES[action]()
      args.confirm = true
      await expect(call(IID, action, args)).rejects.toThrow(/read-only/i)
      expect(sentAMutatingEnvelope()).toBe(false)
    })
  }

  for (const spelling of ['true', '1', 'yes', 'TRUE', 'YES', ' 1 ']) {
    it(`truthy spelling "${spelling}" blocks mutation`, async () => {
      state.creds.SOPHOS_READONLY = spelling
      const args = MUT_CASES.create_host()
      args.confirm = true
      await expect(call(IID, 'create_host', args)).rejects.toThrow(/read-only/i)
      expect(state.calls.length).toBe(0)
    })
  }

  it('unset SOPHOS_READONLY does not block a mutation', async () => {
    state.creds.SOPHOS_READONLY = null
    const args = MUT_CASES.create_host()
    args.confirm = true
    await call(IID, 'create_host', args)
    expect(sentAMutatingEnvelope()).toBe(true)
  })

  it('"false" does not block a mutation', async () => {
    state.creds.SOPHOS_READONLY = 'false'
    const args = MUT_CASES.create_host()
    args.confirm = true
    await call(IID, 'create_host', args)
    expect(sentAMutatingEnvelope()).toBe(true)
  })

  it('reads are not blocked while SOPHOS_READONLY=true', async () => {
    state.creds.SOPHOS_READONLY = 'true'
    state.queue.push(wrapResponse(fixtureList('IPHost', [IPHOST_REC])))
    const result = await call(IID, 'list_hosts', {})
    expect(result).toBeTruthy()
    expect(state.calls.length).toBe(1)
  })
})

// ─── BUG: isMutating() only recognises double-quoted operation attributes ───────
// SFOS/XML allow single-quoted attribute values (`operation='add'` is exactly as
// valid as `operation="add"`). isMutating()'s detection regex hard-codes a double
// quote, so a single-quoted <Set operation='add'> is NOT flagged as mutating. This
// breaks BOTH guarantees below via raw_xml_get: the action's own "never writes"
// promise, and the SOPHOS_READONLY transport gate in send(). These tests encode the
// claims as documented; if the underlying bug is real they will fail, which is the
// point — see the write-up in the final report.

describe('isMutating bypass via single-quoted operation attribute (raw_xml_get)', () => {
  const maliciousSet = `<Set operation='add'><IPHost><Name>evil-host</Name><IPFamily>IPv4</IPFamily><HostType>IP</HostType><IPAddress>6.6.6.6</IPAddress></IPHost></Set>`

  it('raw_xml_get rejects a single-quoted <Set operation=\'add\'> exactly like the double-quoted form', async () => {
    await expect(call(IID, 'raw_xml_get', { xml: maliciousSet }))
      .rejects.toThrow(/only accepts read-only envelopes/)
    expect(state.calls.length).toBe(0)
  })

  it('SOPHOS_READONLY still blocks a single-quoted <Set operation=\'add\'> from reaching formFetch', async () => {
    state.creds.SOPHOS_READONLY = 'true'
    await expect(call(IID, 'raw_xml_get', { xml: maliciousSet })).rejects.toThrow()
    expect(state.calls.some(c => /operation\s*=\s*['"]add['"]/.test(c.form.reqxml))).toBe(false)
  })

  it('raw_xml_get rejects the double-quoted form for comparison (control case — must pass)', async () => {
    const doubleQuoted = `<Set operation="add"><IPHost><Name>evil-host</Name></IPHost></Set>`
    await expect(call(IID, 'raw_xml_get', { xml: doubleQuoted }))
      .rejects.toThrow(/only accepts read-only envelopes/)
    expect(state.calls.length).toBe(0)
  })
})

// ─── Claim 3: the password never leaks ──────────────────────────────────────────

function assertNoLeak(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain(PASSWORD_CANARY)
}

describe('claim 3: the password never leaks', () => {
  it('success path (list_hosts) does not leak the password', async () => {
    state.queue.push(wrapResponse(fixtureList('IPHost', [IPHOST_REC])))
    const result = await call(IID, 'list_hosts', {})
    assertNoLeak(result)
  })

  it('object_get success does not leak the password', async () => {
    state.queue.push(wrapResponse(fixtureXml('IPHost', IPHOST_REC)))
    const result = await call(IID, 'object_get', { tag: 'IPHost', name: 'LAN-network' })
    assertNoLeak(result)
  })

  it('a mutation preview (wouldSend) redacts the password', async () => {
    const result = await call(IID, 'create_host', { name: 'x', host_type: 'IP', ip_address: '1.2.3.4' }) as PreviewResult
    expect(result.preview).toBe(true)
    expect(result.wouldSend).not.toContain(PASSWORD_CANARY)
    expect(result.wouldSend).toContain('<Password>***</Password>')
  })

  it('raw_xml_get redacts the password in the echoed request', async () => {
    state.queue.push(wrapResponse(''))
    const result = await call(IID, 'raw_xml_get', { xml: '<Get><Zone/></Get>' }) as RawXmlResult
    assertNoLeak(result.request)
    expect(result.request).toContain('<Password>***</Password>')
  })

  it('an auth failure (534) error does not leak the password', async () => {
    state.queue.push(AUTH_FAILURE_XML)
    const err = await call(IID, 'list_hosts', {}).catch((e: unknown) => e) as Error
    expect(err).toBeInstanceOf(Error)
    expect(err.message).not.toContain(PASSWORD_CANARY)
    expect(err.stack ?? '').not.toContain(PASSWORD_CANARY)
  })

  it('a not-found (526) status error does not leak the password', async () => {
    state.queue.push(statusResponse('IPHost', 526, 'No matching record found'))
    const err = await call(IID, 'get_host', { name: 'ghost' }).catch((e: unknown) => e) as Error
    expect(err.message).not.toContain(PASSWORD_CANARY)
  })

  it('a permission-denied (535) status error does not leak the password', async () => {
    state.queue.push(statusResponse('IPHost', 535, 'Permission denied'))
    const err = await call(IID, 'list_hosts', {}).catch((e: unknown) => e) as Error
    expect(err.message).not.toContain(PASSWORD_CANARY)
  })

  it('a malformed XML response does not leak the password', async () => {
    state.queue.push('<Response><Login><status>Authentication Successful</status></Login><IPHost>')
    const err = await call(IID, 'list_hosts', {}).catch((e: unknown) => e) as Error
    expect(err).toBeInstanceOf(Error)
    expect(err.message).not.toContain(PASSWORD_CANARY)
  })

  it('a network error does not leak the password', async () => {
    state.queue.push(new Error('Cannot reach https://fw.example.com:4444 — ECONNREFUSED'))
    const err = await call(IID, 'list_hosts', {}).catch((e: unknown) => e) as Error
    expect(err.message).not.toContain(PASSWORD_CANARY)
  })

  it('an invalid-args error (missing required field) does not leak the password', async () => {
    const err = await call(IID, 'create_host', {}).catch((e: unknown) => e) as Error
    expect(err.message).not.toContain(PASSWORD_CANARY)
  })

  it('a diffHash mismatch error does not leak the password', async () => {
    state.queue.push(wrapResponse(fixtureXml('IPHost', IPHOST_REC)))
    const err = await call(IID, 'update_host', { name: 'LAN-network', expected_diff_hash: 'bogus', confirm: true })
      .catch((e: unknown) => e) as Error
    expect(err.message).not.toContain(PASSWORD_CANARY)
  })

  it('ping() failure does not leak the password', async () => {
    state.queue.push(new Error('Cannot reach https://fw.example.com:4444 — ECONNREFUSED'))
    const result = await ping(IID)
    expect(result.ok).toBe(false)
    expect(result.error ?? '').not.toContain(PASSWORD_CANARY)
  })
})

// ─── Claim 4: object_references uses exact match, not substring ────────────────

describe('claim 4: object_references uses exact match, not substring', () => {
  it('a host named LAN is not reported as referenced by groups/rules that only mention LAN-network', async () => {
    state.queue.push(wrapResponse(fixtureList('IPHostGroup', [
      { Name: 'grp-substr', IPFamily: 'IPv4', HostList: { Host: ['LAN-network', 'DMZ'] } },
      { Name: 'grp-exact', IPFamily: 'IPv4', HostList: { Host: ['LAN', 'mail01'] } },
    ])))
    state.queue.push(wrapResponse(fixtureList('FirewallRule', [
      { Name: 'rule-substr', Status: 'Enable', SourceNetworks: 'LAN-network' },
      { Name: 'rule-exact', Status: 'Enable', SourceNetworks: 'LAN' },
    ])))
    state.queue.push(new Error('NAT service temporarily unavailable'))

    const result = await call(IID, 'object_references', { name: 'LAN' }) as RefsResult

    expect(result.refs.IPHostGroup).toEqual(['grp-exact'])
    expect(result.refs.FirewallRule).toEqual(['rule-exact'])
    expect(result.refs.NATRule).toBeUndefined()
    expect('NATRule' in result.refs).toBe(false)
    expect(result.errors?.NATRule).toBeDefined()
  })

  it('a referrer queried successfully with no hits yields [], all-success omits errors entirely', async () => {
    state.queue.push(wrapResponse(fixtureList('IPHostGroup', [{ Name: 'g1', IPFamily: 'IPv4', HostList: { Host: ['other'] } }])))
    state.queue.push(wrapResponse(fixtureList('FirewallRule', [{ Name: 'r1', Status: 'Enable' }])))
    state.queue.push(wrapResponse(fixtureList('NATRule', [{ Name: 'n1', Status: 'Enable' }])))

    const result = await call(IID, 'object_references', { name: 'nonexistent-host' }) as RefsResult
    expect(result.refs.IPHostGroup).toEqual([])
    expect(result.refs.FirewallRule).toEqual([])
    expect(result.refs.NATRule).toEqual([])
    expect(result.errors).toBeUndefined()
  })

  it('one failing referrer does not lose the others\' results', async () => {
    state.queue.push(new Error('IPHostGroup query timed out'))
    state.queue.push(wrapResponse(fixtureList('FirewallRule', [{ Name: 'rule-exact', Status: 'Enable', SourceNetworks: 'LAN' }])))
    state.queue.push(wrapResponse(fixtureList('NATRule', [{ Name: 'n1', Status: 'Enable' }])))

    const result = await call(IID, 'object_references', { name: 'LAN' }) as RefsResult
    expect(result.refs.IPHostGroup).toBeUndefined()
    expect(result.errors?.IPHostGroup).toBeDefined()
    expect(result.refs.FirewallRule).toEqual(['rule-exact'])
    expect(result.refs.NATRule).toEqual([])
  })

  it('unknown primary tag throws, listing supported tags', async () => {
    await expect(call(IID, 'object_references', { name: 'x', tag: 'NotARealTag123' }))
      .rejects.toThrow(/unknown primary tag/)
  })
})

// ─── Claim 5: updates are read-modify-write; unrelated fields are not wiped ─────

describe('claim 5: updates preserve untouched fields (read-modify-write)', () => {
  it('update_host preserves untouched fields, only changes what was passed', async () => {
    const rec = { Name: 'srv1', IPFamily: 'IPv4', HostType: 'Network', IPAddress: '10.5.0.0', Subnet: '255.255.255.0', Comment: 'do not touch' }
    const hash = queueRead('IPHost', rec)
    state.queue.push(wrapResponse(''))
    state.queue.push(wrapResponse(fixtureXml('IPHost', { ...rec, IPAddress: '10.5.0.99' })))

    await call(IID, 'update_host', { name: 'srv1', ip_address: '10.5.0.99', expected_diff_hash: hash, confirm: true })

    const sentXml = state.calls[1].form.reqxml
    expect(sentXml).toContain('<IPAddress>10.5.0.99</IPAddress>')
    expect(sentXml).toContain('<IPFamily>IPv4</IPFamily>')
    expect(sentXml).toContain('<Subnet>255.255.255.0</Subnet>')
    expect(sentXml).toContain('<HostType>Network</HostType>')
    expect(sentXml).toContain('<Comment>do not touch</Comment>')
    expect(sentXml).not.toContain('_diffHash')
  })

  it('update_host_group preserves ALL original group members and untouched fields', async () => {
    const rec = { ...IPHOSTGROUP_REC }
    const hash = queueRead('IPHostGroup', rec)
    state.queue.push(wrapResponse(''))
    state.queue.push(wrapResponse(fixtureXml('IPHostGroup', rec)))

    await call(IID, 'update_host_group', {
      name: 'infra-group',
      hosts: ['LAN-network', 'DMZ', 'mail01'],
      description: 'Updated infra hosts',
      expected_diff_hash: hash,
      confirm: true,
    })

    const sentXml = state.calls[1].form.reqxml
    expect((sentXml.match(/<Host>/g) ?? []).length).toBe(3)
    expect(sentXml).toContain('<Host>LAN-network</Host>')
    expect(sentXml).toContain('<Host>DMZ</Host>')
    expect(sentXml).toContain('<Host>mail01</Host>')
    expect(sentXml).toContain('<Description>Updated infra hosts</Description>')
    expect(sentXml).toContain('<IPFamily>IPv4</IPFamily>')
  })

  it('set_firewall_rule_status preserves every other field, including a repeated-sibling group', async () => {
    const rec = { ...FIREWALLRULE_REC, SourceZones: { Zone: ['LAN', 'WAN'] } }
    const hash = queueRead('FirewallRule', rec)
    state.queue.push(wrapResponse(''))
    state.queue.push(wrapResponse(fixtureXml('FirewallRule', { ...rec, Status: 'Disable' })))

    await call(IID, 'set_firewall_rule_status', { name: 'rule1', status: 'Disable', expected_diff_hash: hash, confirm: true })

    const sentXml = state.calls[1].form.reqxml
    expect(sentXml).toContain('<Status>Disable</Status>')
    expect(sentXml).toContain('<Action>Accept</Action>')
    expect(sentXml).toContain('<Position>Top</Position>')
    expect(sentXml).toContain('<IPFamily>IPv4</IPFamily>')
    expect((sentXml.match(/<Zone>/g) ?? []).length).toBe(2)
    expect(sentXml).toContain('<Zone>LAN</Zone>')
    expect(sentXml).toContain('<Zone>WAN</Zone>')
  })

  it('object_set update strips a client-echoed _diffHash before serialising (would otherwise crash on an illegal tag name)', async () => {
    const rec = { ...IPHOST_REC }
    const hash = queueRead('IPHost', rec)
    state.queue.push(wrapResponse(''))
    state.queue.push(wrapResponse(fixtureXml('IPHost', rec)))

    // Simulates a client echoing back exactly what object_get returned, _diffHash included.
    await call(IID, 'object_set', {
      tag: 'IPHost', operation: 'update',
      body: { ...rec, _diffHash: hash },
      expected_diff_hash: hash,
      confirm: true,
    })

    const sentXml = state.calls[1].form.reqxml
    expect(sentXml).not.toContain('_diffHash')
    expect(sentXml).toContain('<IPAddress>10.0.0.0</IPAddress>')
  })
})

// ─── Claim 6: expected_diff_hash actually gates ─────────────────────────────────

describe('claim 6: expected_diff_hash gates writes', () => {
  it('a wrong hash throws and does not send', async () => {
    state.queue.push(wrapResponse(fixtureXml('IPHost', IPHOST_REC)))
    await expect(call(IID, 'update_host', { name: 'LAN-network', ip_address: '10.0.0.1', expected_diff_hash: 'deadbeefdeadbeef', confirm: true }))
      .rejects.toThrow(/changed since you read it/)
    expect(state.calls.length).toBe(1)
    expect(sentAMutatingEnvelope()).toBe(false)
  })

  it('a missing hash on update throws before any network call', async () => {
    await expect(call(IID, 'update_host', { name: 'LAN-network', confirm: true }))
      .rejects.toThrow(/expected_diff_hash is required/)
    expect(state.calls.length).toBe(0)
  })

  it('a missing hash on delete throws before any network call', async () => {
    await expect(call(IID, 'delete_host', { name: 'LAN-network', confirm: true }))
      .rejects.toThrow(/expected_diff_hash is required/)
    expect(state.calls.length).toBe(0)
  })

  it('a missing hash on object_remove throws before any network call', async () => {
    await expect(call(IID, 'object_remove', { tag: 'IPHost', name: 'LAN-network', confirm: true }))
      .rejects.toThrow(/expected_diff_hash is required/)
    expect(state.calls.length).toBe(0)
  })

  it('a correct hash taken from a real read action (get_host) proceeds — full round trip', async () => {
    state.queue.push(wrapResponse(fixtureXml('IPHost', IPHOST_REC)))
    const read = await call(IID, 'get_host', { name: 'LAN-network' }) as DiffHashed
    expect(typeof read._diffHash).toBe('string')
    expect(read._diffHash).toHaveLength(64)

    state.queue.push(wrapResponse(fixtureXml('IPHost', IPHOST_REC)))
    const result = await call(IID, 'update_host', { name: 'LAN-network', ip_address: '10.0.0.2', expected_diff_hash: read._diffHash }) as PreviewResult
    // confirm omitted: must reach the preview stage, i.e. the hash check passed.
    expect(result.preview).toBe(true)
  })

  it('a correct hash from object_get round-trips into object_set update', async () => {
    state.queue.push(wrapResponse(fixtureXml('FirewallRule', FIREWALLRULE_REC)))
    const read = await call(IID, 'object_get', { tag: 'FirewallRule', name: 'rule1' }) as DiffHashed

    state.queue.push(wrapResponse(fixtureXml('FirewallRule', FIREWALLRULE_REC)))
    const result = await call(IID, 'object_set', {
      tag: 'FirewallRule', operation: 'update', body: { Name: 'rule1', Status: 'Disable' },
      expected_diff_hash: read._diffHash,
    }) as PreviewResult
    expect(result.preview).toBe(true)
  })
})

// ─── Claim 7: injection payloads are escaped, never structural ─────────────────

describe('claim 7: injection payloads are escaped, never able to introduce a new element', () => {
  interface Payload { label: string; value: string; extra?: (xml: string) => void }

  const PAYLOADS: Payload[] = [
    { label: 'element injection attempt', value: `x</Name><Set operation="add"><IPHost><Name>evil` },
    { label: 'path traversal string', value: '../../../etc/passwd' },
    { label: 'newline + fake remove tag', value: 'line1\n<Remove></Remove>\nline2' },
    {
      label: 'ampersand', value: 'AT&T-net',
      extra: xml => expect(xml).toContain('<Name>AT&amp;T-net</Name>'),
    },
    {
      label: 'unicode', value: 'héllo-🔥-世界',
      extra: xml => expect(xml).toContain('<Name>héllo-🔥-世界</Name>'),
    },
  ]

  for (const { label, value, extra } of PAYLOADS) {
    it(`create_host name: ${label}`, async () => {
      const result = await call(IID, 'create_host', { name: value, host_type: 'IP', ip_address: '1.2.3.4' }) as PreviewResult
      expect(result.preview).toBe(true)
      const xml = result.wouldSend
      expect((xml.match(/<Set operation="add">/g) ?? []).length).toBe(1)
      expect(xml).not.toMatch(/<Remove>/)
      expect(xml).not.toMatch(/<Name>evil/)
      expect(() => parseResponse(xml)).not.toThrow()
      extra?.(xml)
    })
  }

  it('filter_value injection in object_list is escaped — exactly one <Get>, request still parses', async () => {
    state.queue.push(wrapResponse(''))
    await call(IID, 'object_list', {
      tag: 'IPHost', filter_field: 'Name',
      filter_value: `x</key></Filter></IPHost></Get><Set operation="add"><IPHost><Name>evil`,
    })
    const xml = state.calls[0].form.reqxml
    expect((xml.match(/<Get>/g) ?? []).length).toBe(1)
    expect(xml).not.toContain('<Set operation="add"><IPHost><Name>evil<')
    expect(() => parseResponse(xml)).not.toThrow()
  })

  it('a malicious member inside create_host_group hosts[] is escaped, exactly one <Set>', async () => {
    const result = await call(IID, 'create_host_group', {
      name: 'g1', hosts: ['ok-host', `x</Host></HostList><Set operation="add">pwn`],
    }) as PreviewResult
    expect(result.preview).toBe(true)
    expect((result.wouldSend.match(/<Set operation="add">/g) ?? []).length).toBe(1)
    expect(() => parseResponse(result.wouldSend)).not.toThrow()
  })

  it('a malicious tag name (not in the catalog) is rejected outright, not interpolated', async () => {
    await expect(call(IID, 'object_list', { tag: `IPHost><Set operation="add` }))
      .rejects.toThrow()
    expect(state.calls.length).toBe(0)
  })

  it('object_set/object_remove refuse an unknown tag rather than interpolating it', async () => {
    await expect(call(IID, 'object_set', { tag: 'TotallyMadeUpTag', operation: 'add', body: { Name: 'x' }, confirm: true }))
      .rejects.toThrow(/unknown or not mutable/)
    await expect(call(IID, 'object_remove', { tag: 'TotallyMadeUpTag', name: 'x', expected_diff_hash: 'abc', confirm: true }))
      .rejects.toThrow(/unknown or not mutable/)
    expect(state.calls.length).toBe(0)
  })

  it('object_set/object_remove refuse a known but non-mutable tag (Zone)', async () => {
    await expect(call(IID, 'object_set', { tag: 'Zone', operation: 'add', body: { Name: 'x' }, confirm: true }))
      .rejects.toThrow(/unknown or not mutable/)
    await expect(call(IID, 'object_remove', { tag: 'Zone', name: 'x', expected_diff_hash: 'abc', confirm: true }))
      .rejects.toThrow(/unknown or not mutable/)
  })
})

// ─── TOOLS integrity ─────────────────────────────────────────────────────────────

describe('TOOLS integrity', () => {
  it('every tool name is unique', () => {
    const names = TOOLS.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every tool has a non-empty description', () => {
    for (const t of TOOLS) {
      expect(typeof t.description).toBe('string')
      expect((t.description ?? '').length).toBeGreaterThan(0)
    }
  })

  it('every tool has an object inputSchema', () => {
    for (const t of TOOLS) expect(t.inputSchema.type).toBe('object')
  })

  it('every tool name has a matching case in call() — never falls through to default', async () => {
    for (const t of TOOLS) {
      state.calls.length = 0
      state.queue.length = 0
      let hitDefault = false
      try {
        await call(IID, t.name, {})
      } catch (e) {
        if (e instanceof Error && e.message === `Unknown Sophos tool: ${t.name}`) hitDefault = true
      }
      expect(hitDefault).toBe(false)
    }
  })

  it('an unknown action throws "Unknown Sophos tool: <name>"', async () => {
    await expect(call(IID, 'totally_made_up_action', {})).rejects.toThrow('Unknown Sophos tool: totally_made_up_action')
  })
})

// ─── Spot-checks: representative read actions ────────────────────────────────────

describe('read action spot-checks', () => {
  it('list_object_types makes no network call', async () => {
    const result = await call(IID, 'list_object_types', {}) as Array<{ tag: string }>
    expect(state.calls.length).toBe(0)
    expect(result.some(t => t.tag === 'IPHost')).toBe(true)
  })

  it('list_hosts enriches each item with describeHost() output', async () => {
    state.queue.push(wrapResponse(fixtureList('IPHost', [IPHOST_REC])))
    const result = await call(IID, 'list_hosts', {}) as { items: Array<{ cidr?: string; kind?: string }> }
    expect(result.items[0].kind).toBe('Network')
    expect(result.items[0].cidr).toBe('10.0.0.0/24')
  })

  it('get_firewall_rule stamps _diffHash', async () => {
    state.queue.push(wrapResponse(fixtureXml('FirewallRule', FIREWALLRULE_REC)))
    const result = await call(IID, 'get_firewall_rule', { name: 'rule1' }) as DiffHashed
    expect(typeof result._diffHash).toBe('string')
  })

  it('get_nat_rule stamps _diffHash and throws not-found (526) when absent', async () => {
    state.queue.push(statusResponse('NATRule', 526, 'No matching record found'))
    await expect(call(IID, 'get_nat_rule', { name: 'ghost' })).rejects.toThrow(/526/)
  })

  it('list_firewall_rules validates the status enum', async () => {
    await expect(call(IID, 'list_firewall_rules', { status: 'Bogus' })).rejects.toThrow(/status must be/)
  })

  it('list_firewall_rules filters client-side by ip_family', async () => {
    state.queue.push(wrapResponse(fixtureList('FirewallRule', [
      { ...FIREWALLRULE_REC, Name: 'r4', IPFamily: 'IPv4' },
      { ...FIREWALLRULE_REC, Name: 'r6', IPFamily: 'IPv6' },
    ])))
    const result = await call(IID, 'list_firewall_rules', { ip_family: 'IPv6' }) as { items: Array<{ Name: string }> }
    expect(result.items.map(i => i.Name)).toEqual(['r6'])
  })

  it('object_usage builds a top-level Statistics envelope, not nested in <Get>', async () => {
    state.queue.push(wrapResponse('<IPHostStatistics transactionid=""><Requests>5</Requests></IPHostStatistics>'))
    const result = await call(IID, 'object_usage', { tag: 'IPHost', name: 'LAN-network' }) as { usageTag: string }
    const xml = state.calls[0].form.reqxml
    expect(xml).toMatch(/<\/Login><IPHostStatistics>/)
    expect(xml).not.toMatch(/<Get>\s*<IPHostStatistics>/)
    expect(result.usageTag).toBe('IPHostStatistics')
  })

  it('object_usage throws for a tag with no usage query (FirewallRule) — no network call', async () => {
    await expect(call(IID, 'object_usage', { tag: 'FirewallRule' })).rejects.toThrow(/no usage/)
    expect(state.calls.length).toBe(0)
  })

  it('raw_xml_get sends the raw envelope and returns the parsed response alongside the redacted request', async () => {
    state.queue.push(wrapResponse(fixtureList('Zone', [{ Name: 'LAN', Type: 'LAN' }])))
    const result = await call(IID, 'raw_xml_get', { xml: '<Get><Zone/></Get>' }) as RawXmlResult
    expect(state.calls[0].form.reqxml).toContain('<Get><Zone/></Get>')
    expect(result.request).toContain('<Username>***</Username>')
  })

  it('system_info returns real data on success', async () => {
    state.queue.push(wrapResponse('<SystemInformation transactionid=""><Model>XG115</Model></SystemInformation>'))
    const result = await call(IID, 'system_info', {}) as { Model?: string }
    expect(result.Model).toBe('XG115')
  })

  it('system_info degrades to {supported:false} on an unsupported-build status (5xx)', async () => {
    state.queue.push(statusResponse('SystemInformation', 501, 'Unknown request'))
    const result = await call(IID, 'system_info', {}) as { supported?: boolean; hint?: string }
    expect(result.supported).toBe(false)
    expect(result.hint).toContain('SystemInformation')
  })

  it('system_info still throws on an auth failure rather than swallowing it', async () => {
    state.queue.push(AUTH_FAILURE_XML)
    await expect(call(IID, 'system_info', {})).rejects.toThrow()
  })

  it('ping() succeeds when login is OK, regardless of result emptiness', async () => {
    state.queue.push(wrapResponse(''))
    const result = await ping(IID)
    expect(result.ok).toBe(true)
    expect(state.calls[0].timeoutMs).toBe(5000)
  })

  it('ping() fails on auth failure', async () => {
    state.queue.push(AUTH_FAILURE_XML)
    const result = await ping(IID)
    expect(result.ok).toBe(false)
  })
})

// ─── Synthetic fields must never round-trip to the device ──────────────────────

describe('synthetic fields are stripped at the write chokepoint', () => {
  it('strips _diffHash and _omitted from an object_set add body', async () => {
    state.queue.push(statusResponse('IPHost', 200, 'Configuration applied successfully.'))
    state.queue.push(wrapResponse(fixtureXml('IPHost', IPHOST_REC)))
    await call(IID, 'object_set', {
      tag: 'IPHost', operation: 'add', confirm: true,
      body: { ...IPHOST_REC, _diffHash: 'deadbeef', _omitted: ['Comment'] },
    })
    const sent = state.calls.map(c => c.form.reqxml).join('')
    expect(sent).not.toContain('_diffHash')
    expect(sent).not.toContain('_omitted')
    expect(sent).toContain('<Name>LAN-network</Name>')
  })

  it('strips them on the update path too, without losing real fields', async () => {
    const hash = queueRead('IPHost', IPHOST_REC)
    state.queue.push(statusResponse('IPHost', 200, 'Configuration applied successfully.'))
    state.queue.push(wrapResponse(fixtureXml('IPHost', IPHOST_REC)))
    await call(IID, 'update_host', { name: 'LAN-network', subnet: '255.255.0.0', expected_diff_hash: hash, confirm: true })
    const setXml = state.calls.map(c => c.form.reqxml).find(x => x.includes('<Set'))!
    expect(setXml).not.toContain('_diffHash')
    expect(setXml).toContain('<Subnet>255.255.0.0</Subnet>')
    expect(setXml).toContain('<IPFamily>IPv4</IPFamily>')
  })

  it('leaves the stamped _diffHash on the value returned to the caller', async () => {
    state.queue.push(wrapResponse(fixtureXml('IPHost', IPHOST_REC)))
    const out = await call(IID, 'get_host', { name: 'LAN-network' }) as Record<string, unknown>
    expect(typeof out._diffHash).toBe('string')
  })
})
