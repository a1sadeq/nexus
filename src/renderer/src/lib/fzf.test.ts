import { describe, it, expect } from 'vitest'
import { fzfMatch } from './fzf'

describe('fzfMatch', () => {
  it('matches substring case-insensitively by default', () => {
    expect(fzfMatch('rust', 'Rust borrow checker')).toBe(true)
    expect(fzfMatch('rust', 'RUST borrow checker')).toBe(true)
  })

  it('matches mid-string (not just prefix)', () => {
    expect(fzfMatch('borrow', 'Rust borrow checker')).toBe(true)
  })

  it('empty query matches everything', () => {
    expect(fzfMatch('', 'anything')).toBe(true)
  })

  it('no match returns false', () => {
    expect(fzfMatch('zzz', 'Rust borrow checker')).toBe(false)
  })

  it('smart-case: uppercase query forces case-sensitive', () => {
    expect(fzfMatch('Rust', 'Rust borrow checker')).toBe(true)
    expect(fzfMatch('Rust', 'rust borrow checker')).toBe(false)
    expect(fzfMatch('RUST', 'rust borrow checker')).toBe(false)
  })

  it('multi-word query is treated as literal substring', () => {
    expect(fzfMatch('borrow checker', 'Rust borrow checker')).toBe(true)
    expect(fzfMatch('checker borrow', 'Rust borrow checker')).toBe(false)
  })
})
