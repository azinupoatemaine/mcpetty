import { describe, it, expect } from 'vitest'
import { renderPrompt } from '../../src/lib/mcp-handler'

const args = (...names: string[]) => names.map((name) => ({ name }))

describe('renderPrompt', () => {
  it('substitutes a declared argument', () => {
    expect(renderPrompt('Check {{stack}} now', args('stack'), { stack: 'media' }))
      .toBe('Check media now')
  })

  it('substitutes every occurrence', () => {
    expect(renderPrompt('{{a}} then {{a}}', args('a'), { a: 'x' })).toBe('x then x')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(renderPrompt('{{ stack }}', args('stack'), { stack: 'media' })).toBe('media')
  })

  it('leaves an undeclared placeholder literal so template typos stay visible', () => {
    expect(renderPrompt('{{stack}} / {{stackk}}', args('stack'), { stack: 'media', stackk: 'oops' }))
      .toBe('media / {{stackk}}')
  })

  it('renders a declared-but-omitted optional argument as empty', () => {
    expect(renderPrompt('a{{opt}}b', args('opt'), {})).toBe('ab')
  })

  it('coerces non-string values', () => {
    expect(renderPrompt('{{n}}', args('n'), { n: 42 })).toBe('42')
  })

  it('does not recurse into a substituted value', () => {
    // A value that itself looks like a placeholder must not be expanded again.
    expect(renderPrompt('{{a}}', args('a', 'b'), { a: '{{b}}', b: 'nope' })).toBe('{{b}}')
  })

  it('leaves a template with no placeholders untouched', () => {
    expect(renderPrompt('plain text', [], {})).toBe('plain text')
  })
})
