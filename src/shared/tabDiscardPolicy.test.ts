import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TAB_DISCARD_POLICY,
  validateTabDiscardPolicy,
  validatePartialTabDiscardPolicy
} from './tabDiscardPolicy'

describe('tabDiscardPolicy validation', () => {
  it('returns default policy when input is invalid or non-object', () => {
    expect(validateTabDiscardPolicy(null).valid).toBe(false)
    expect(validateTabDiscardPolicy(null).policy).toEqual(DEFAULT_TAB_DISCARD_POLICY)
    expect(validateTabDiscardPolicy('string').valid).toBe(false)
    expect(validateTabDiscardPolicy([]).valid).toBe(false)
  })

  it('accepts valid full policy objects', () => {
    const input = { version: 1, tabDiscardMinutes: 60, maxActiveTabs: 3 }
    const result = validateTabDiscardPolicy(input)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.policy).toEqual({
      version: 1,
      tabDiscardMinutes: 60,
      maxActiveTabs: 3
    })
  })

  it('rejects negative numbers, fractions, NaN, and Infinity', () => {
    expect(validateTabDiscardPolicy({ tabDiscardMinutes: -5 }).valid).toBe(false)
    expect(validateTabDiscardPolicy({ tabDiscardMinutes: 2.5 }).valid).toBe(false)
    expect(validateTabDiscardPolicy({ tabDiscardMinutes: NaN }).valid).toBe(false)
    expect(validateTabDiscardPolicy({ maxActiveTabs: Infinity }).valid).toBe(false)
    expect(validateTabDiscardPolicy({ maxActiveTabs: -1 }).valid).toBe(false)
  })

  it('validates partial updates strictly', () => {
    expect(validatePartialTabDiscardPolicy({ tabDiscardMinutes: 30 })).toEqual({
      valid: true,
      updates: { tabDiscardMinutes: 30 }
    })
    expect(validatePartialTabDiscardPolicy({ maxActiveTabs: 5 })).toEqual({
      valid: true,
      updates: { maxActiveTabs: 5 }
    })
    expect(validatePartialTabDiscardPolicy({ tabDiscardMinutes: 0, maxActiveTabs: 0 })).toEqual({
      valid: true,
      updates: { tabDiscardMinutes: 0, maxActiveTabs: 0 }
    })

    expect(validatePartialTabDiscardPolicy({ tabDiscardMinutes: -1 }).valid).toBe(false)
    expect(validatePartialTabDiscardPolicy({ maxActiveTabs: '3' }).valid).toBe(false)
    expect(validatePartialTabDiscardPolicy({}).valid).toBe(false)
    expect(validatePartialTabDiscardPolicy({ otherField: true }).valid).toBe(false)
  })
})
