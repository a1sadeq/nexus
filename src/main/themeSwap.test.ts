import { describe, it, expect } from 'vitest'
import { nextThemeSwap } from './themeSwap'

describe('nextThemeSwap', () => {
  it('no-ops when css unchanged', () => {
    const prev = { css: 'body{}', key: 'k1' }
    expect(nextThemeSwap(prev, 'body{}')).toEqual({ swap: false })
  })
  it('swaps when css changed', () => {
    const prev = { css: 'body{}', key: 'k1' }
    expect(nextThemeSwap(prev, 'body{color:red}')).toEqual({
      swap: true,
      oldKey: 'k1',
      css: 'body{color:red}'
    })
  })
  it('swaps with no old key on first apply', () => {
    expect(nextThemeSwap(null, 'body{}')).toEqual({ swap: true, oldKey: undefined, css: 'body{}' })
  })
})
