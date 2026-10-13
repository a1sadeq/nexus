import { describe, it, expect } from 'vitest'
import { splitSelectorList } from './selectorUtils'

describe('splitSelectorList', () => {
  it('splits a simple list and trims segments', () => {
    expect(splitSelectorList('textarea#a, .ProseMirror, div[x]')).toEqual([
      'textarea#a', '.ProseMirror', 'div[x]'
    ])
  })
  it('does not split inside :not(a, b)', () => {
    expect(splitSelectorList('div:not([class*="user" i], .assistant), span')).toEqual([
      'div:not([class*="user" i], .assistant)', 'span'
    ])
  })
  it('does not split inside quoted attribute values', () => {
    expect(splitSelectorList('[aria-label*="Send, now"], button')).toEqual([
      '[aria-label*="Send, now"]', 'button'
    ])
  })
  it('drops empty segments and handles single selectors', () => {
    expect(splitSelectorList('  #solo  ')).toEqual(['#solo'])
    expect(splitSelectorList('a,,b')).toEqual(['a', 'b'])
    expect(splitSelectorList('')).toEqual([])
  })
  it('PAGE_HELPERS-style embedding produces working page code', () => {
    const pageCode = `const splitList = ${splitSelectorList.toString()}; return splitList('a, b:not(x, y)')`
    const fn = new Function(pageCode)
    expect(fn()).toEqual(['a', 'b:not(x, y)'])
  })
})
