import { describe, expect, it } from 'vitest'
import {
  classifyArenaObservedState,
  type ArenaObservation,
  type ElementObservation
} from './arenaObservedState'

const absent = (): ElementObservation => ({ count: 0, visible: 0, enabled: 0 })
const single = (): ElementObservation => ({ count: 1, visible: 1, enabled: 1 })
const disabled = (): ElementObservation => ({ count: 1, visible: 1, enabled: 0 })
const idle = (): ArenaObservation => ({
  composer: single(),
  send: disabled(),
  stop: absent()
})

describe('Arena observed control state', () => {
  it('matches the observed idle and finished controls without claiming completion', () => {
    expect(classifyArenaObservedState(idle())).toBe('send-disabled')
  })
  it('matches the observed typed state without granting permission to send', () => {
    expect(
      classifyArenaObservedState({
        composer: single(),
        send: single(),
        stop: absent()
      })
    ).toBe('ready-to-send')
  })
  it('matches the observed generating controls', () => {
    expect(
      classifyArenaObservedState({
        composer: single(),
        send: absent(),
        stop: single()
      })
    ).toBe('generating')
  })
  it('treats the observed new empty page as unknown', () => {
    expect(
      classifyArenaObservedState({
        composer: absent(),
        send: absent(),
        stop: absent()
      })
    ).toBe('unknown')
  })
  it('treats simultaneous Send and Stop as unknown', () => {
    expect(
      classifyArenaObservedState({
        composer: single(),
        send: single(),
        stop: single()
      })
    ).toBe('unknown')
  })
  it('treats hidden, disabled and duplicate controls as unknown', () => {
    expect(
      classifyArenaObservedState({
        ...idle(),
        composer: { count: 1, visible: 0, enabled: 1 }
      })
    ).toBe('unknown')
    expect(classifyArenaObservedState({ ...idle(), composer: disabled() })).toBe('unknown')
    expect(
      classifyArenaObservedState({
        ...idle(),
        send: { count: 2, visible: 1, enabled: 1 }
      })
    ).toBe('unknown')
    expect(
      classifyArenaObservedState({
        ...idle(),
        stop: { count: 1, visible: 0, enabled: 1 }
      })
    ).toBe('unknown')
  })
  it.each([
    null,
    {},
    { composer: null },
    { ...idle(), send: { count: 0, visible: 1, enabled: 0 } },
    { ...idle(), stop: { count: -1, visible: 0, enabled: 0 } },
    { ...idle(), stop: { count: 1.5, visible: 0, enabled: 0 } }
  ])('fails closed for invalid input %#', (input) => {
    expect(classifyArenaObservedState(input)).toBe('unknown')
  })
})
