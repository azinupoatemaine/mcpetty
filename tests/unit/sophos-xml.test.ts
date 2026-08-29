import { describe, it, expect } from 'vitest'
import {
  safeXmlTag, xmlEscape, objectToXml,
  buildGetEnvelope, buildStatisticsEnvelope, buildSetEnvelope, buildRemoveEnvelope, buildRawEnvelope,
  parseResponse, responseError,
  validateGetFilter, validateStatsFilter,
  isMutating, redactXml, diffHash,
  SophosStatusError,
  type SophosResponse, type SophosStatus,
} from '../../src/lib/native/sophos-xml'

function respXml(inner: string, apiVersion = '2200.1'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response APIVersion="${apiVersion}"><Login><status>Authentication Successful</status></Login>${inner}</Response>`
}

// ── safeXmlTag ─────────────────────────────────────────────────────────────────

describe('safeXmlTag', () => {
  it('accepts a plain alpha tag', () => {
    expect(safeXmlTag('IPHost')).toBe('IPHost')
  })

  it('accepts letters, digits, underscore after the first char', () => {
    expect(safeXmlTag('Foo_Bar1')).toBe('Foo_Bar1')
  })

  it('rejects a leading digit', () => {
    expect(() => safeXmlTag('1Foo')).toThrow()
  })

  it('rejects an empty string', () => {
    expect(() => safeXmlTag('')).toThrow()
  })

  it('rejects whitespace', () => {
    expect(() => safeXmlTag('Foo Bar')).toThrow()
  })

  it('rejects a dash', () => {
    expect(() => safeXmlTag('Foo-Bar')).toThrow()
  })

  it('rejects a closing-tag / attribute injection payload', () => {
    expect(() => safeXmlTag('</Password><Set operation="add">')).toThrow()
  })

  it('rejects a non-string value whose String() form is not a valid tag', () => {
    expect(() => safeXmlTag({})).toThrow()
    expect(() => safeXmlTag([1, 2])).toThrow()
    expect(() => safeXmlTag(3.14)).toThrow()
  })

  it('includes the caller-supplied label in the error', () => {
    expect(() => safeXmlTag('bad tag', 'field name')).toThrow(/field name/)
  })
})

// ── xmlEscape ──────────────────────────────────────────────────────────────────

describe('xmlEscape', () => {
  it('escapes all five XML metacharacters', () => {
    expect(xmlEscape(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f')
  })

  it('neutralises a tag-injection payload into inert text', () => {
    const out = xmlEscape('</Password><Set operation="add">')
    expect(out).not.toContain('<Set')
    expect(out).not.toContain('</Password>')
    expect(out).toBe('&lt;/Password&gt;&lt;Set operation=&quot;add&quot;&gt;')
  })

  it('leaves plain text untouched', () => {
    expect(xmlEscape('hello world 123')).toBe('hello world 123')
  })
})

// ── objectToXml ────────────────────────────────────────────────────────────────

describe('objectToXml', () => {
  it('serialises scalars, numbers, and booleans', () => {
    const xml = objectToXml({ Name: 'X', Port: 80, Enabled: true })
    expect(xml).toBe('<Name>X</Name><Port>80</Port><Enabled>true</Enabled>')
  })

  it('emits arrays as flat repeated siblings', () => {
    const xml = objectToXml({ Members: ['a', 'b', 'c'] })
    expect(xml).toBe('<Members>a</Members><Members>b</Members><Members>c</Members>')
  })

  it('recurses into nested objects', () => {
    const xml = objectToXml({ Group: { A: '1', B: ['x', 'y'] } })
    expect(xml).toBe('<Group><A>1</A><B>x</B><B>y</B></Group>')
  })

  it('skips null and undefined values', () => {
    const xml = objectToXml({ Keep: 'x', Skip: null, Skip2: undefined })
    expect(xml).toBe('<Keep>x</Keep>')
  })

  it('stringifies zero and false rather than skipping them', () => {
    const xml = objectToXml({ Count: 0, Enabled: false })
    expect(xml).toBe('<Count>0</Count><Enabled>false</Enabled>')
  })

  it('escapes injected markup in values', () => {
    const xml = objectToXml({ Description: '</IPHost></Set><Set operation="add">pwned' })
    expect(xml).not.toContain('<Set operation="add">pwned')
    expect(xml).not.toContain('</IPHost>')
    expect(xml).toBe('<Description>&lt;/IPHost&gt;&lt;/Set&gt;&lt;Set operation=&quot;add&quot;&gt;pwned</Description>')
  })

  it('rejects an unsafe key as a tag-injection attempt', () => {
    expect(() => objectToXml({ 'Name><Set operation="add"><IPHost': 'x' })).toThrow()
    expect(() => objectToXml({ 'bad key': 'x' })).toThrow()
  })
})

// ── envelope builders ────────────────────────────────────────────────────────────

describe('buildGetEnvelope', () => {
  it('builds a bare Get for a simple tag', () => {
    const xml = buildGetEnvelope({ tag: 'IPHost' }, 'admin', 'secret')
    expect(xml).toContain('<Request>')
    expect(xml).toContain('<Login>')
    expect(xml).toContain('<Username>admin</Username>')
    expect(xml).toContain('<Password>secret</Password>')
    expect(xml).toContain('<Get><IPHost></IPHost></Get>')
  })

  it('converts `name` into a Name= filter', () => {
    const xml = buildGetEnvelope({ tag: 'IPHost', name: 'LAN' }, 'u', 'p')
    expect(xml).toContain('<key name="Name" criteria="=">LAN</key>')
  })

  it('uses an explicit filter clause over name', () => {
    const xml = buildGetEnvelope(
      { tag: 'IPHost', name: 'ignored', filter: { field: 'Name', criteria: 'like', value: 'LAN' } },
      'u', 'p',
    )
    expect(xml).toContain('<key name="Name" criteria="like">LAN</key>')
    expect(xml).not.toContain('>ignored<')
  })

  it('emits the Request APIVersion attribute when provided', () => {
    const xml = buildGetEnvelope({ tag: 'IPHost', apiVersion: '2200.1' }, 'u', 'p')
    expect(xml.startsWith('<Request APIVersion="2200.1">')).toBe(true)
  })

  it('omits the APIVersion attribute when not provided', () => {
    const xml = buildGetEnvelope({ tag: 'IPHost' }, 'u', 'p')
    expect(xml.startsWith('<Request>')).toBe(true)
  })

  it('escapes username and password', () => {
    const xml = buildGetEnvelope({ tag: 'IPHost' }, 'u<x>', `p"&'`)
    expect(xml).toContain('<Username>u&lt;x&gt;</Username>')
    expect(xml).toContain(`<Password>p&quot;&amp;&apos;</Password>`)
  })

  it('throws on an invalid tag before touching the network', () => {
    expect(() => buildGetEnvelope({ tag: 'IPHost><Remove' }, 'u', 'p')).toThrow()
  })

  it('validates filter criteria itself, so no caller can forget to', () => {
    expect(() =>
      buildGetEnvelope({ tag: 'IPHost', filter: { field: 'Name', criteria: 'whatever', value: 'x' } }, 'u', 'p'),
    ).toThrow(/not a valid Get criteria/)
  })

  it('rejects a Statistics-only criteria on a Get', () => {
    expect(() =>
      buildGetEnvelope({ tag: 'IPHost', filter: { field: 'Name', criteria: 'startswith', value: 'x' } }, 'u', 'p'),
    ).toThrow(/not a valid Get criteria/)
  })
})

describe('buildStatisticsEnvelope', () => {
  it('places the statistics tag at top level, not inside <Get>', () => {
    const xml = buildStatisticsEnvelope({ tag: 'IPHostStatistics' }, 'u', 'p')
    expect(xml).toContain('<IPHostStatistics></IPHostStatistics>')
    expect(xml).not.toContain('<Get>')
  })

  it('includes a filter when provided', () => {
    const xml = buildStatisticsEnvelope(
      { tag: 'IPHostStatistics', filter: { field: 'Name', criteria: 'startswith', value: 'LAN' } },
      'u', 'p',
    )
    expect(xml).toContain('<key name="Name" criteria="startswith">LAN</key>')
  })
})

describe('buildSetEnvelope', () => {
  it('wraps the body in <Set operation="add">', () => {
    const xml = buildSetEnvelope({ operation: 'add', tag: 'IPHost', body: { Name: 'X', IPAddress: '1.1.1.1' } }, 'u', 'p')
    expect(xml).toContain('<Set operation="add">')
    expect(xml).toContain('<IPHost><Name>X</Name><IPAddress>1.1.1.1</IPAddress></IPHost>')
    expect(xml).toContain('</Set>')
    expect(xml.trim().endsWith('</Request>')).toBe(true)
  })

  it('supports operation="update"', () => {
    const xml = buildSetEnvelope({ operation: 'update', tag: 'IPHost', body: { Name: 'X' } }, 'u', 'p')
    expect(xml).toContain('<Set operation="update">')
  })

  it('rejects any operation other than add/update', () => {
    // @ts-expect-error deliberately passing an invalid operation to test the runtime guard
    expect(() => buildSetEnvelope({ operation: 'delete', tag: 'IPHost', body: {} }, 'u', 'p')).toThrow()
  })

  it('serialises repeated group members as flat siblings', () => {
    const xml = buildSetEnvelope(
      { operation: 'update', tag: 'FQDNHostGroup', body: { Name: 'g', FQDNHostList: { FQDNHost: ['a', 'b', 'c'] } } },
      'u', 'p',
    )
    expect(xml).toContain('<FQDNHostList><FQDNHost>a</FQDNHost><FQDNHost>b</FQDNHost><FQDNHost>c</FQDNHost></FQDNHostList>')
  })

  it('escapes an injection attempt in a body value and keeps exactly one real Set tag', () => {
    const xml = buildSetEnvelope(
      { operation: 'add', tag: 'IPHost', body: { Name: 'X', Description: '</IPHost></Set><Set operation="add"><IPHost><Name>pwned</Name></IPHost>' } },
      'u', 'p',
    )
    expect((xml.match(/<Set operation="add">/g) ?? []).length).toBe(1)
    expect(xml).not.toContain('<Name>pwned</Name>')
  })
})

describe('buildRemoveEnvelope', () => {
  it('wraps the identity field in <Remove>', () => {
    const xml = buildRemoveEnvelope({ tag: 'IPHost', name: 'X' }, 'u', 'p')
    expect(xml).toContain('<Remove><IPHost><Name>X</Name></IPHost></Remove>')
  })

  it('supports a custom key field', () => {
    const xml = buildRemoveEnvelope({ tag: 'User', name: 'bob', keyField: 'Username' }, 'u', 'p')
    expect(xml).toContain('<Remove><User><Username>bob</Username></User></Remove>')
  })

  it('escapes the name value', () => {
    const xml = buildRemoveEnvelope({ tag: 'IPHost', name: `X"><Remove>` }, 'u', 'p')
    expect(xml).not.toContain('X"><Remove>')
    expect(xml).toContain('X&quot;&gt;&lt;Remove&gt;')
  })
})

describe('buildRawEnvelope', () => {
  it('splices Login in after an existing <Request> opening tag', () => {
    const raw = `<Request><Get><Zone></Zone></Get></Request>`
    const xml = buildRawEnvelope(raw, 'u', 'p')
    expect(xml).toContain('<Login>')
    expect(xml).toContain('<Username>u</Username>')
    expect(xml).toContain('<Password>p</Password>')
    expect(xml).toContain('<Get><Zone></Zone></Get>')
    expect((xml.match(/<Request>/g) ?? []).length).toBe(1)
  })

  it('wraps a bare operation body', () => {
    const raw = `<Get><Zone></Zone></Get>`
    const xml = buildRawEnvelope(raw, 'u', 'p')
    expect(xml.startsWith('<Request><Login>')).toBe(true)
    expect(xml.trim().endsWith('</Request>')).toBe(true)
  })

  it('applies apiVersion only when wrapping', () => {
    const xml = buildRawEnvelope(`<Get><Zone></Zone></Get>`, 'u', 'p', '2200.1')
    expect(xml.startsWith('<Request APIVersion="2200.1">')).toBe(true)
  })
})

// ── parseResponse ──────────────────────────────────────────────────────────────

describe('parseResponse — basic shape', () => {
  it('parses login success and a single record', () => {
    const r = parseResponse(respXml(`<IPHost transactionid=""><Name>LAN-network</Name><HostType>Network</HostType></IPHost>`))
    expect(r.apiVersion).toBe('2200.1')
    expect(r.loginOk).toBe(true)
    expect(r.loginStatus).toBe('Authentication Successful')
    expect(r.body.IPHost).toEqual([{ Name: 'LAN-network', HostType: 'Network' }])
  })

  it('trims whitespace around the login status text', () => {
    const xml = `<Response><Login>\n    <status>Authentication Successful</status>\n</Login></Response>`
    const r = parseResponse(xml)
    expect(r.loginStatus).toBe('Authentication Successful')
    expect(r.loginOk).toBe(true)
  })

  it('reports login failure', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Response APIVersion="2200.1"><Login><status>Authentication Failure</status></Login></Response>`
    const r = parseResponse(xml)
    expect(r.loginOk).toBe(false)
    expect(r.loginStatus).toBe('Authentication Failure')
  })

  it('accumulates two separate top-level records for the same tag, in order', () => {
    const r = parseResponse(respXml(
      `<IPHost transactionid=""><Name>LAN-network</Name></IPHost>` +
      `<IPHost transactionid=""><Name>DMZ</Name></IPHost>`,
    ))
    expect(r.body.IPHost).toHaveLength(2)
    expect(r.body.IPHost[0].Name).toBe('LAN-network')
    expect(r.body.IPHost[1].Name).toBe('DMZ')
  })

  it('captures an embedded per-tag status instead of adding it to body', () => {
    const r = parseResponse(respXml(
      `<IPHost transactionid=""><Status code="526">No matching record found</Status></IPHost>`,
    ))
    expect(r.body.IPHost).toBeUndefined()
    expect(r.statuses).toEqual([{ tag: 'IPHost', code: 526, message: 'No matching record found' }])
  })

  it('treats a Status field with no code attribute as ordinary data', () => {
    const r = parseResponse(respXml(`<IPSPolicy><Name>rule1</Name><Status>Enable</Status></IPSPolicy>`))
    expect(r.statuses).toHaveLength(0)
    expect(r.body.IPSPolicy).toEqual([{ Name: 'rule1', Status: 'Enable' }])
  })

  it('throws on malformed XML', () => {
    expect(() => parseResponse('<not xml')).toThrow()
  })

  it('throws on a mismatched closing tag', () => {
    expect(() => parseResponse('<Response><Login></Response>')).toThrow()
  })

  it('throws on an unclosed tag', () => {
    expect(() => parseResponse('<Response>')).toThrow()
  })

  it('returns a default empty response when there is no <Response> root, without throwing', () => {
    const r = parseResponse('<Foo></Foo>')
    expect(r.loginOk).toBe(false)
    expect(r.body).toEqual({})
  })
})

describe('parseResponse — repeated sibling elements (the critical property)', () => {
  const THREE_MEMBER_GROUP = respXml(
    `<FQDNHostGroup transactionid="">` +
    `<Name>smtp-bypass</Name>` +
    `<Description>Hosts exempt from MTA interception</Description>` +
    `<IPFamily>IPv4</IPFamily>` +
    `<FQDNHostList>` +
    `<FQDNHost>dingo.example.org</FQDNHost>` +
    `<FQDNHost>docker01.example.org</FQDNHost>` +
    `<FQDNHost>fnas01.example.org</FQDNHost>` +
    `</FQDNHostList>` +
    `</FQDNHostGroup>`,
  )

  it('accumulates a 3-member group into an array, in document order', () => {
    const r = parseResponse(THREE_MEMBER_GROUP)
    expect(r.body.FQDNHostGroup).toHaveLength(1)
    const rec = r.body.FQDNHostGroup[0]
    expect(rec.Name).toBe('smtp-bypass')
    const list = rec.FQDNHostList as Record<string, unknown>
    expect(list.FQDNHost).toEqual(['dingo.example.org', 'docker01.example.org', 'fnas01.example.org'])
  })

  it('a single-member group stays a scalar, not a one-element array', () => {
    const xml = respXml(
      `<FQDNHostGroup><Name>solo-group</Name><FQDNHostList><FQDNHost>dingo.example.org</FQDNHost></FQDNHostList></FQDNHostGroup>`,
    )
    const r = parseResponse(xml)
    const list = r.body.FQDNHostGroup[0].FQDNHostList as Record<string, unknown>
    expect(list.FQDNHost).toBe('dingo.example.org')
  })

  it('round-trips: parse -> objectToXml -> parse again -> deep equal', () => {
    const r1 = parseResponse(THREE_MEMBER_GROUP)
    const record = r1.body.FQDNHostGroup[0]

    const reserialized = `<FQDNHostGroup>${objectToXml(record)}</FQDNHostGroup>`
    const wrapped = `<Response APIVersion="2200.1"><Login><status>Authentication Successful</status></Login>${reserialized}</Response>`
    const r2 = parseResponse(wrapped)

    expect(r2.body.FQDNHostGroup[0]).toEqual(record)
  })

  it('cardinality: zero, one, two, and many (17) repeats', () => {
    const zero = parseResponse(respXml(`<G><Name>g</Name><L></L></G>`))
    expect(zero.body.G[0].L).toBe('')

    const one = parseResponse(respXml(`<G><Name>g</Name><L><M>a</M></L></G>`))
    expect((one.body.G[0].L as Record<string, unknown>).M).toBe('a')

    const two = parseResponse(respXml(`<G><Name>g</Name><L><M>a</M><M>b</M></L></G>`))
    expect((two.body.G[0].L as Record<string, unknown>).M).toEqual(['a', 'b'])

    const names = 'abcdefghijklmnopq'.split('')
    const manyXml = respXml(`<G><Name>g</Name><L>${names.map(n => `<M>${n}</M>`).join('')}</L></G>`)
    const many = parseResponse(manyXml)
    const list = (many.body.G[0].L as Record<string, unknown>).M as unknown[]
    expect(list).toHaveLength(17)
    expect(list).toEqual(names)
  })

  it('repeated complex (non-leaf) children accumulate into an array of objects', () => {
    const xml = respXml(
      `<Services><Name>web</Name><ServiceDetails>` +
      `<ServiceDetail><Protocol>TCP</Protocol><DestinationPort>80</DestinationPort></ServiceDetail>` +
      `<ServiceDetail><Protocol>TCP</Protocol><DestinationPort>443</DestinationPort></ServiceDetail>` +
      `</ServiceDetails></Services>`,
    )
    const r = parseResponse(xml)
    const details = (r.body.Services[0].ServiceDetails as Record<string, unknown>).ServiceDetail as Array<Record<string, unknown>>
    expect(details).toHaveLength(2)
    expect(details[0].DestinationPort).toBe('80')
    expect(details[1].DestinationPort).toBe('443')
  })

  it('independent sibling lists under the same parent do not bleed into each other', () => {
    const xml = respXml(
      `<FirewallRule><Name>r</Name><Zones>` +
      `<Zone>LAN</Zone><Zone>DMZ</Zone>` +
      `<Network>net1</Network><Network>net2</Network><Network>net3</Network>` +
      `</Zones></FirewallRule>`,
    )
    const r = parseResponse(xml)
    const zones = r.body.FirewallRule[0].Zones as Record<string, unknown>
    expect(zones.Zone).toEqual(['LAN', 'DMZ'])
    expect(zones.Network).toEqual(['net1', 'net2', 'net3'])
  })
})

describe('parseResponse — hand-written parser mechanics', () => {
  it('decodes CDATA without interpreting entities inside it', () => {
    const r = parseResponse(respXml(`<IPHost><Name><![CDATA[LAN & Friends <weird>]]></Name></IPHost>`))
    expect(r.body.IPHost[0].Name).toBe('LAN & Friends <weird>')
  })

  it('decodes named and numeric XML entities', () => {
    const r = parseResponse(respXml(
      `<IPHost><Name>A&amp;B &lt;t&gt; &quot;q&quot; &apos;s&apos; &#65; &#x42;</Name></IPHost>`,
    ))
    expect(r.body.IPHost[0].Name).toBe(`A&B <t> "q" 's' A B`)
  })

  it('ignores comments, including inline ones', () => {
    const r = parseResponse(respXml(`<!-- top level --><IPHost><Name>X<!-- inline --></Name></IPHost>`))
    expect(r.body.IPHost[0].Name).toBe('X')
  })

  it('handles self-closing tags as empty leaves', () => {
    const r = parseResponse(respXml(`<IPHost><Name>X</Name><Description/></IPHost>`))
    expect(r.body.IPHost[0]).toEqual({ Name: 'X', Description: '' })
  })

  it('handles the XML declaration', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response APIVersion="1"><Login><status>Authentication Successful</status></Login><IPHost><Name>X</Name></IPHost></Response>`
    const r = parseResponse(xml)
    expect(r.body.IPHost[0].Name).toBe('X')
  })

  it('handles attribute values containing angle brackets safely', () => {
    const r = parseResponse(respXml(`<IPHost note="a > b"><Name>X</Name></IPHost>`))
    expect(r.body.IPHost[0]).toEqual({ Name: 'X' })
  })
})

// ── responseError / status mapping ──────────────────────────────────────────────

function mkResponse(statuses: SophosStatus[], loginOk = true): SophosResponse {
  return { apiVersion: '2200.1', loginOk, loginStatus: 'Authentication Successful', body: {}, statuses }
}

describe('responseError', () => {
  it('returns null for a fully successful response', () => {
    expect(responseError(mkResponse([]))).toBeNull()
    expect(responseError(mkResponse([{ tag: 'IPHost', code: 200, message: 'ok' }]))).toBeNull()
  })

  it('treats any 2xx as success, including the boundary and a non-200 value', () => {
    expect(responseError(mkResponse([{ tag: 'X', code: 200, message: 'ok' }]))).toBeNull()
    expect(responseError(mkResponse([{ tag: 'X', code: 216, message: 'ok' }]))).toBeNull()
    expect(responseError(mkResponse([{ tag: 'X', code: 299, message: 'ok' }]))).toBeNull()
  })

  it('reports an auth failure before looking at statuses at all', () => {
    const r = mkResponse([{ tag: 'X', code: 200, message: 'ok' }], false)
    r.loginStatus = 'Authentication Failure'
    const err = responseError(r)
    expect(err).toBeInstanceOf(SophosStatusError)
    expect(err?.code).toBe(534)
    expect(err?.kind).toBe('auth')
    expect(err?.message).toContain('Authentication Failure')
  })

  it('maps 526 to not_found', () => {
    const err = responseError(mkResponse([{ tag: 'IPHost', code: 526, message: 'No matching record found' }]))
    expect(err?.code).toBe(526)
    expect(err?.kind).toBe('not_found')
  })

  it('maps 535 to permission', () => {
    const err = responseError(mkResponse([{ tag: 'IPHost', code: 535, message: 'Permission denied' }]))
    expect(err?.kind).toBe('permission')
  })

  it('maps 500-530 to invalid, including both boundaries', () => {
    expect(responseError(mkResponse([{ tag: 'X', code: 500, message: 'bad' }]))?.kind).toBe('invalid')
    expect(responseError(mkResponse([{ tag: 'X', code: 530, message: 'bad' }]))?.kind).toBe('invalid')
  })

  it('maps anything else to server', () => {
    expect(responseError(mkResponse([{ tag: 'X', code: 531, message: 'huh' }]))?.kind).toBe('server')
    expect(responseError(mkResponse([{ tag: 'X', code: 599, message: 'huh' }]))?.kind).toBe('server')
    expect(responseError(mkResponse([{ tag: 'X', code: 300, message: 'huh' }]))?.kind).toBe('server')
  })

  it('surfaces the first non-success status and ignores a later success', () => {
    const err = responseError(mkResponse([
      { tag: 'A', code: 200, message: 'ok' },
      { tag: 'B', code: 526, message: 'not found' },
      { tag: 'C', code: 200, message: 'ok' },
    ]))
    expect(err?.code).toBe(526)
  })

  it('preserves code and message on the thrown error', () => {
    const err = responseError(mkResponse([{ tag: 'X', code: 535, message: 'Permission denied' }]))
    expect(err?.code).toBe(535)
    expect(err?.message).toContain('Permission denied')
  })
})

// ── filter validation ─────────────────────────────────────────────────────────

describe('validateGetFilter', () => {
  it('accepts =, !=, like', () => {
    for (const criteria of ['=', '!=', 'like']) {
      expect(() => validateGetFilter({ field: 'Name', criteria, value: 'x' })).not.toThrow()
    }
  })

  it('rejects statistics-only criteria', () => {
    expect(() => validateGetFilter({ field: 'Name', criteria: 'startswith', value: 'x' })).toThrow()
    expect(() => validateGetFilter({ field: 'Name', criteria: '>=', value: 'x' })).toThrow()
  })

  it('rejects an empty field', () => {
    expect(() => validateGetFilter({ field: '', criteria: '=', value: 'x' })).toThrow()
  })
})

describe('validateStatsFilter', () => {
  it('accepts the full rich criteria set', () => {
    for (const criteria of ['=', '!=', 'like', 'not like', 'startswith', 'in', '>', '>=']) {
      expect(() => validateStatsFilter({ field: 'Name', criteria, value: 'x' })).not.toThrow()
    }
  })

  it('rejects an unknown criteria', () => {
    expect(() => validateStatsFilter({ field: 'Name', criteria: 'contains', value: 'x' })).toThrow()
  })

  it('rejects an empty field', () => {
    expect(() => validateStatsFilter({ field: '', criteria: '=', value: 'x' })).toThrow()
  })
})

// ── isMutating ─────────────────────────────────────────────────────────────────

describe('isMutating', () => {
  it('detects Set operation="add"', () => {
    const { mutating, verbs } = isMutating('<Request><Set operation="add"><IPHost><Name>x</Name></IPHost></Set></Request>')
    expect(mutating).toBe(true)
    expect(verbs).toContain('Set:add')
  })

  it('detects Set operation="update"', () => {
    const { mutating, verbs } = isMutating('<Request><Set operation="update"><IPHost></IPHost></Set></Request>')
    expect(mutating).toBe(true)
    expect(verbs).toContain('Set:update')
  })

  it('detects Remove', () => {
    const { mutating, verbs } = isMutating('<Request><Remove><IPHost><Name>x</Name></IPHost></Remove></Request>')
    expect(mutating).toBe(true)
    expect(verbs).toContain('Remove')
  })

  it('does not flag a Get as mutating', () => {
    const { mutating, verbs } = isMutating('<Request><Get><IPHost></IPHost></Get></Request>')
    expect(mutating).toBe(false)
    expect(verbs).toEqual([])
  })

  it('does not flag a Statistics query as mutating', () => {
    const { mutating } = isMutating('<Request><IPHostStatistics><Filter></Filter></IPHostStatistics></Request>')
    expect(mutating).toBe(false)
  })

  it('reports every distinct verb, deduplicated', () => {
    const { mutating, verbs } = isMutating('<Request><Set operation="add"></Set><Remove></Remove></Request>')
    expect(mutating).toBe(true)
    expect(verbs).toHaveLength(2)
  })

  it('tolerates irregular whitespace around the operation attribute', () => {
    const { mutating, verbs } = isMutating('<Request><Set  operation = "add" ><IPHost></IPHost></Set></Request>')
    expect(mutating).toBe(true)
    expect(verbs).toContain('Set:add')
  })

  it('is not fooled by Set/Remove appearing only as text content', () => {
    const { mutating } = isMutating('<Request><Get><IPHost><Name>please Remove this Set operation</Name></IPHost></Get></Request>')
    expect(mutating).toBe(false)
  })
})

// ── redactXml ──────────────────────────────────────────────────────────────────

describe('redactXml', () => {
  it('replaces Username and Password contents with ***', () => {
    const xml = '<Request><Login><Username>admin</Username><Password>hunter2</Password></Login><Get><IPHost></IPHost></Get></Request>'
    const out = redactXml(xml)
    expect(out).not.toContain('admin')
    expect(out).not.toContain('hunter2')
    expect(out).toContain('<Username>***</Username>')
    expect(out).toContain('<Password>***</Password>')
    expect(out).toContain('<Get><IPHost></IPHost></Get>')
  })

  it('is idempotent', () => {
    const xml = '<Login><Username>x</Username><Password>y</Password></Login>'
    const once = redactXml(xml)
    const twice = redactXml(once)
    expect(twice).toBe(once)
  })

  it('leaves XML with no credentials unchanged', () => {
    const xml = '<Get><IPHost></IPHost></Get>'
    expect(redactXml(xml)).toBe(xml)
  })

  it('redacts every occurrence when Login appears more than once', () => {
    const xml = '<A><Username>u1</Username><Password>p1</Password></A><B><Username>u2</Username><Password>p2</Password></B>'
    const out = redactXml(xml)
    expect(out).not.toContain('u1')
    expect(out).not.toContain('u2')
    expect(out).not.toContain('p1')
    expect(out).not.toContain('p2')
  })

  it('redacts a real envelope built with a credential containing markup', () => {
    const envelope = buildGetEnvelope({ tag: 'IPHost' }, 'admin', `p"><Login><Username>x`)
    const redacted = redactXml(envelope)
    expect(redacted).not.toContain('admin')
    expect(redacted).not.toContain('p&quot;')
    expect(redacted).toContain('<Username>***</Username>')
    expect(redacted).toContain('<Password>***</Password>')
  })
})

// ── diffHash ───────────────────────────────────────────────────────────────────

describe('diffHash', () => {
  it('is stable for identical input', () => {
    const a = { Name: 'LAN-network', HostType: 'Network', IPAddress: '10.0.0.0' }
    const b = { Name: 'LAN-network', HostType: 'Network', IPAddress: '10.0.0.0' }
    expect(diffHash(a)).toBe(diffHash(b))
  })

  it('produces a 64-char hex sha256', () => {
    expect(diffHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs for different input', () => {
    const a = { Name: 'A', IPAddress: '1.1.1.1' }
    const b = { Name: 'A', IPAddress: '2.2.2.2' }
    expect(diffHash(a)).not.toBe(diffHash(b))
  })

  it('is invariant under top-level key reordering', () => {
    const a = { Name: 'X', IPAddress: '1.1.1.1', HostType: 'IP' }
    const b = { HostType: 'IP', IPAddress: '1.1.1.1', Name: 'X' }
    expect(diffHash(a)).toBe(diffHash(b))
  })

  it('is invariant under nested key reordering (recursive sort)', () => {
    const a = { Name: 'g', List: { Members: ['x', 'y'], Meta: { A: 1, B: 2 } } }
    const b = { List: { Meta: { B: 2, A: 1 }, Members: ['x', 'y'] }, Name: 'g' }
    expect(diffHash(a)).toBe(diffHash(b))
  })

  it('strips _diffHash before hashing so re-hashing a stamped record is stable', () => {
    const record = { Name: 'X', IPAddress: '1.1.1.1' }
    const h1 = diffHash(record)
    const stamped = { ...record, _diffHash: h1 }
    const h2 = diffHash(stamped)
    expect(h2).toBe(h1)
  })

  it('produces the same hash regardless of where _diffHash was inserted', () => {
    const record = { Name: 'X', IPAddress: '1.1.1.1' }
    const h1 = diffHash(record)
    const stampedFront = { _diffHash: 'whatever', ...record }
    expect(diffHash(stampedFront)).toBe(h1)
  })
})

// ── credential safety ────────────────────────────────────────────────────────────

describe('credentials never leak into thrown errors', () => {
  const SECRET = 'Sup3r-S3cr3t-Marker'

  it('buildGetEnvelope: invalid tag error omits the password', () => {
    let message = ''
    try {
      buildGetEnvelope({ tag: 'Bad Tag' }, 'admin', SECRET)
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    expect(message).not.toContain(SECRET)
  })

  it('buildSetEnvelope: invalid operation error omits the password', () => {
    let message = ''
    try {
      // @ts-expect-error deliberately invalid operation
      buildSetEnvelope({ operation: 'delete', tag: 'IPHost', body: {} }, 'admin', SECRET)
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    expect(message).not.toContain(SECRET)
  })

  it('buildRemoveEnvelope: invalid tag error omits the password', () => {
    let message = ''
    try {
      buildRemoveEnvelope({ tag: 'Bad Tag', name: 'x' }, 'admin', SECRET)
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    expect(message).not.toContain(SECRET)
  })

  it('parseResponse malformed-XML error omits any credential-shaped substring', () => {
    let message = ''
    try {
      parseResponse(`<not xml ${SECRET}`)
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    expect(message).not.toContain(SECRET)
  })

  it('responseError never derives its message from request credentials', () => {
    const r = mkResponse([], false)
    r.loginStatus = 'Authentication Failure'
    const err = responseError(r)
    expect(err?.message).not.toContain(SECRET)
  })

  it('redactXml scrubs the password out of a fully built envelope', () => {
    const envelope = buildSetEnvelope({ operation: 'add', tag: 'IPHost', body: { Name: 'X' } }, 'admin', SECRET)
    expect(envelope).toContain(SECRET) // sanity: the raw envelope does carry it, by protocol design
    expect(redactXml(envelope)).not.toContain(SECRET)
  })
})

// ─── Review-pass regressions ─────────────────────────────────────────────────

describe('safeXmlTag — non-string inputs', () => {
  it('rejects undefined rather than laundering it into the tag "undefined"', () => {
    expect(() => safeXmlTag(undefined)).toThrow(/expected a tag name/)
  })

  it('rejects null, numbers and objects', () => {
    expect(() => safeXmlTag(null)).toThrow(/got null/)
    expect(() => safeXmlTag(42)).toThrow(/expected a tag name/)
    expect(() => safeXmlTag({ tag: 'IPHost' })).toThrow(/expected a tag name/)
  })

  it('propagates through the envelope builders', () => {
    expect(() => buildGetEnvelope({ tag: undefined as unknown as string }, 'u', 'p')).toThrow(/expected a tag name/)
  })
})

describe('buildRawEnvelope — opening tag with attributes', () => {
  it('splices Login into <Request APIVersion="..."> instead of double-wrapping', () => {
    const out = buildRawEnvelope('<Request APIVersion="2200.1"><Get><Zone></Zone></Get></Request>', 'u', 'p')
    expect(out.match(/<Request/g)).toHaveLength(1)
    expect(out.match(/<Login>/g)).toHaveLength(1)
    expect(out).toContain('<Request APIVersion="2200.1"><Login>')
    expect(parseResponse.bind(null, out)).not.toThrow()
  })

  it('still splices into a bare <Request>', () => {
    const out = buildRawEnvelope('<Request><Get><Zone></Zone></Get></Request>', 'u', 'p')
    expect(out.match(/<Request/g)).toHaveLength(1)
    expect(out).toContain('<Request><Login>')
  })

  it('wraps a bare operation body', () => {
    const out = buildRawEnvelope('<Get><Zone></Zone></Get>', 'u', 'p')
    expect(out.match(/<Request/g)).toHaveLength(1)
    expect(out.endsWith('</Request>')).toBe(true)
  })

  it('redacts credentials spliced into an attributed envelope', () => {
    const out = buildRawEnvelope('<Request APIVersion="2200.1"><Get><Zone></Zone></Get></Request>', 'admin', 'hunter2')
    expect(redactXml(out)).not.toContain('hunter2')
  })
})

describe('isMutating — fail-closed element detection', () => {
  const SET_BODY = '<IPHost><Name>x</Name></IPHost>'

  it('detects a single-quoted operation attribute', () => {
    expect(isMutating(`<Request><Set operation='add'>${SET_BODY}</Set></Request>`).mutating).toBe(true)
    expect(isMutating(`<Request><Set operation='update'>${SET_BODY}</Set></Request>`).mutating).toBe(true)
  })

  it('detects a bare <Set> with no operation attribute — SFOS treats it as add', () => {
    const r = isMutating(`<Request><Set>${SET_BODY}</Set></Request>`)
    expect(r.mutating).toBe(true)
    expect(r.verbs).toContain('Set')
  })

  it('detects operation when another attribute precedes it', () => {
    expect(isMutating(`<Request><Set xmlns="u" operation="add">${SET_BODY}</Set></Request>`).verbs).toContain('Set:add')
  })

  it('flags an unrecognised operation value rather than ignoring it', () => {
    expect(isMutating(`<Request><Set operation="delete">${SET_BODY}</Set></Request>`).mutating).toBe(true)
  })

  it('detects a self-closing <Set/>', () => {
    expect(isMutating('<Request><Set/></Request>').mutating).toBe(true)
  })

  it('fails closed when a quote is unbalanced inside the tag', () => {
    expect(isMutating('<Request><Set operation="a>b">x</Set></Request>').mutating).toBe(true)
  })

  it('detects <Remove> in every spacing form', () => {
    expect(isMutating('<Request><Remove><IPHost/></Remove></Request>').verbs).toContain('Remove')
    expect(isMutating('<Request><Remove />').verbs).toContain('Remove')
  })

  it('does not flag a read envelope', () => {
    expect(isMutating('<Request><Get><IPHost></IPHost></Get></Request>').mutating).toBe(false)
  })

  it('does not flag an element that merely starts with Set', () => {
    expect(isMutating('<Request><Get><Settings></Settings></Get></Request>').mutating).toBe(false)
    expect(isMutating('<Request><Get><SetupWizard/></Get></Request>').mutating).toBe(false)
  })
})
