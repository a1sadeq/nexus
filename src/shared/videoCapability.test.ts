import { describe, it, expect } from 'vitest'
import {
  assessVideoCapability,
  capabilityBadge,
  emptyCapabilityStore,
  upsertObservation,
  validateObservation,
  type CapabilityObservation
} from './videoCapability'

const NOW = new Date('2026-11-19T12:00:00.000Z')

const obs = (over: Partial<CapabilityObservation> = {}): CapabilityObservation => ({
  provider: 'chatgpt',
  kind: 'video',
  status: 'supported',
  fact: 'attachment-confirmed',
  observedAt: '2026-11-10T12:00:00.000Z',
  source: 'live-dom',
  ...over
})

describe('capability model: no evidence is never "supported"', () => {
  it('returns unknown + asks the user when nothing was ever recorded', () => {
    const verdict = assessVideoCapability({ provider: 'chatgpt', kind: 'video', now: NOW }, [])
    expect(verdict.status).toBe('unknown')
    expect(verdict.nativeAllowed).toBe(false)
    expect(verdict.needsUserDecision).toBe(true)
    expect(verdict.reason).toContain('accept attribute is only a hint')
  })

  it('treats an accept-attribute hint as unknown, not as support', () => {
    const verdict = assessVideoCapability(
      { provider: 'chatgpt', kind: 'video', now: NOW },
      [obs({ fact: 'input-accepts-type' })]
    )
    expect(verdict.status).toBe('unknown')
    expect(verdict.nativeAllowed).toBe(false)
    expect(verdict.reason).toContain('listing it is not acceptance')
  })

  it('allows the native route only on fresh acceptance evidence', () => {
    const verdict = assessVideoCapability(
      { provider: 'chatgpt', kind: 'video', now: NOW },
      [obs()]
    )
    expect(verdict.status).toBe('supported')
    expect(verdict.nativeAllowed).toBe(true)
    expect(verdict.needsUserDecision).toBe(false)
    // Even here it must not claim the model understood anything.
    expect(verdict.reason).toContain('not proof the model understood')
  })

  it('does not let a semantic observation stand in for upload acceptance', () => {
    const verdict = assessVideoCapability(
      { provider: 'gemini', kind: 'video', now: NOW },
      [obs({ provider: 'gemini', fact: 'model-understood' })]
    )
    expect(verdict.status).toBe('unknown')
    expect(verdict.nativeAllowed).toBe(false)
    expect(verdict.reason).toContain('nothing proves the file was accepted')
  })

  it('honours a recorded provider rejection and stops offering it', () => {
    const verdict = assessVideoCapability(
      { provider: 'gemini', kind: 'video', now: NOW },
      [obs({ provider: 'gemini', status: 'unsupported', fact: 'provider-error', source: 'provider-error' })]
    )
    expect(verdict.status).toBe('unsupported')
    expect(verdict.nativeAllowed).toBe(false)
    expect(verdict.needsUserDecision).toBe(true)
    expect(verdict.reason).toContain('rejected this video')
  })

  it('prefers a rejection over older acceptance evidence', () => {
    const verdict = assessVideoCapability(
      { provider: 'arena', kind: 'video', now: NOW },
      [
        obs({ provider: 'arena', observedAt: '2026-09-01T00:00:00.000Z' }),
        obs({
          provider: 'arena',
          status: 'unsupported',
          fact: 'provider-error',
          source: 'provider-error',
          observedAt: '2026-11-15T00:00:00.000Z'
        })
      ]
    )
    expect(verdict.status).toBe('unsupported')
  })

  it('expires evidence instead of trusting stale selectors', () => {
    const verdict = assessVideoCapability(
      { provider: 'claude', kind: 'video', now: NOW, maxAgeDays: 7 },
      [obs({ provider: 'claude', observedAt: '2026-10-01T00:00:00.000Z' })]
    )
    expect(verdict.status).toBe('unknown')
    expect(verdict.nativeAllowed).toBe(false)
    expect(verdict.staleObservation).toBeDefined()
    expect(verdict.reason).toContain('re-test')
    expect(capabilityBadge(verdict)).toBe('evidence stale — re-test')
  })

  it('scopes evidence to the requested model when one is recorded', () => {
    const verdict = assessVideoCapability(
      { provider: 'chatgpt', model: 'gpt-5', kind: 'video', now: NOW },
      [obs({ model: 'gpt-5', fact: 'input-accepts-type' }), obs({ model: undefined })]
    )
    // Model-scoped evidence is weaker here (hint only), so the model-scoped pool wins
    // and the verdict must be unknown rather than borrowing provider-wide acceptance.
    expect(verdict.status).toBe('unknown')
    expect(verdict.nativeAllowed).toBe(false)
  })

  it('keeps other file kinds out of a video verdict', () => {
    const verdict = assessVideoCapability(
      { provider: 'chatgpt', kind: 'video', now: NOW },
      [obs({ kind: 'image' })]
    )
    expect(verdict.status).toBe('unknown')
  })
})

describe('capability store', () => {
  it('replaces the same provider/model/kind/fact instead of duplicating it', () => {
    let store = emptyCapabilityStore()
    store = upsertObservation(store, obs())
    store = upsertObservation(store, obs({ observedAt: '2026-11-12T00:00:00.000Z' }))
    expect(store.observations).toHaveLength(1)
    expect(store.observations[0].observedAt).toBe('2026-11-12T00:00:00.000Z')
  })

  it('rejects malformed observations rather than storing a guess', () => {
    expect(validateObservation({ provider: '', kind: 'video' })).toContain('provider is required')
    expect(validateObservation(obs({ fact: 'vibes' as never }))).toContain('fact must be one of')
    expect(validateObservation(obs({ observedAt: 'yesterday' }))).toContain('ISO date')
    expect(() => upsertObservation(emptyCapabilityStore(), obs({ source: 'guess' as never }))).toThrow(
      /invalid capability observation/
    )
  })

  it('badges never overclaim', () => {
    expect(capabilityBadge(assessVideoCapability({ provider: 'x', kind: 'video', now: NOW }, []))).toBe(
      'unverified — ask first'
    )
    expect(
      capabilityBadge(assessVideoCapability({ provider: 'x', kind: 'video', now: NOW }, [obs({ provider: 'x' })]))
    ).toBe('native verified')
  })
})
