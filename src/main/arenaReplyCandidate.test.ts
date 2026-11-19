import { describe, expect, it } from 'vitest'
import {
  createArenaReplyCandidate,
  type ReplySnapshot,
  type ObservedTurn
} from './arenaReplyCandidate'

const hash = (letter: string): string => letter.repeat(64)
const turn = (id: string, role: 'user' | 'other', letter: string): ObservedTurn => ({
  id,
  role,
  digest: hash(letter)
})
const original = (): ReplySnapshot => ({
  binding: 'target',
  navigationEpoch: 'nav',
  grantRevision: 1,
  control: 'ready-to-send',
  turns: [turn('old-user', 'user', 'a'), turn('old-other', 'other', 'b')]
})
const post = (control: ReplySnapshot['control'], added: ObservedTurn[]): ReplySnapshot => ({
  ...original(),
  control,
  turns: [...original().turns, ...added]
})
const user = (): ObservedTurn => turn('new-user', 'user', 'c')
const reply = (letter = 'd'): ObservedTurn => turn('new-other', 'other', letter)

describe('Arena reply candidate evidence', () => {
  it('requires observed generating and a stable candidate across the window', () => {
    const tracker = createArenaReplyCandidate(original(), hash('c'))
    expect(tracker.observe(post('generating', [user()]), 0)).toEqual({ state: 'waiting' })
    expect(tracker.observe(post('send-disabled', [user(), reply()]), 100)).toEqual({
      state: 'waiting'
    })
    expect(tracker.observe(post('send-disabled', [user(), reply()]), 1599)).toEqual({
      state: 'waiting'
    })
    expect(tracker.observe(post('send-disabled', [user(), reply()]), 1600)).toEqual({
      state: 'stable-candidate',
      responseDigest: hash('d')
    })
  })
  it('resets the window for changed response bytes', () => {
    const t = createArenaReplyCandidate(original(), hash('c'))
    t.observe(post('generating', [user()]), 0)
    t.observe(post('send-disabled', [user(), reply()]), 1)
    expect(t.observe(post('send-disabled', [user(), reply('e')]), 3000)).toEqual({
      state: 'waiting'
    })
    expect(t.observe(post('send-disabled', [user(), reply('e')]), 4500)).toEqual({
      state: 'stable-candidate',
      responseDigest: hash('e')
    })
  })
  it('pauses if generation was not observed, even when a reply exists', () => {
    const t = createArenaReplyCandidate(original(), hash('c'))
    expect(t.observe(post('send-disabled', [user(), reply()]), 0)).toEqual({
      state: 'paused',
      reason: 'ambiguous-state'
    })
  })
  it('pauses and remains paused on changed binding or grant', () => {
    const t = createArenaReplyCandidate(original(), hash('c'))
    expect(t.observe({ ...post('generating', [user()]), grantRevision: 2 }, 0)).toEqual({
      state: 'paused',
      reason: 'binding-changed'
    })
    expect(t.observe(post('generating', [user()]), 1)).toEqual({
      state: 'paused',
      reason: 'binding-changed'
    })
  })
  it('fails closed on missing or changed baseline and duplicate IDs', () => {
    const a = createArenaReplyCandidate(original(), hash('c'))
    expect(a.observe({ ...original(), control: 'generating', turns: [] }, 1)).toEqual({
      state: 'paused',
      reason: 'transcript-changed'
    })
    const b = createArenaReplyCandidate(original(), hash('c'))
    expect(b.observe(post('generating', [turn('old-user', 'user', 'c')]), 1)).toEqual({
      state: 'paused',
      reason: 'invalid-input'
    })
  })
  it('pauses on unexpected user content, role, or extra turn', () => {
    for (const added of [
      [turn('u', 'user', 'f')],
      [turn('u', 'other', 'c')],
      [user(), reply(), turn('extra', 'other', 'f')]
    ]) {
      expect(
        createArenaReplyCandidate(original(), hash('c')).observe(post('generating', added), 1)
      ).toEqual({ state: 'paused', reason: 'unexpected-turns' })
    }
  })
  it('pauses on replacement or disappearance of a witnessed new turn', () => {
    const a = createArenaReplyCandidate(original(), hash('c'))
    a.observe(post('generating', [user(), reply()]), 0)
    expect(a.observe(post('generating', [user()]), 1)).toEqual({
      state: 'paused',
      reason: 'transcript-changed'
    })
    const b = createArenaReplyCandidate(original(), hash('c'))
    b.observe(post('generating', [user()]), 0)
    expect(b.observe(post('generating', [turn('replacement', 'user', 'c')]), 1)).toEqual({
      state: 'paused',
      reason: 'transcript-changed'
    })
  })
  it('pauses if generation restarts after the observed disabled state', () => {
    const t = createArenaReplyCandidate(original(), hash('c'))
    t.observe(post('generating', [user()]), 0)
    t.observe(post('send-disabled', [user(), reply()]), 1)
    expect(t.observe(post('generating', [user(), reply()]), 2)).toEqual({
      state: 'paused',
      reason: 'ambiguous-state'
    })
  })
  it('rejects invalid baseline, malformed input, unknown controls and backward time', () => {
    expect(
      createArenaReplyCandidate({ ...original(), control: 'unknown' }, hash('c')).observe(
        original(),
        0
      )
    ).toEqual({ state: 'paused', reason: 'invalid-input' })
    expect(createArenaReplyCandidate(original(), 'bad').observe(original(), 0)).toEqual({
      state: 'paused',
      reason: 'invalid-input'
    })
    expect(createArenaReplyCandidate(original(), hash('c')).observe(null, 0)).toEqual({
      state: 'paused',
      reason: 'invalid-input'
    })
    expect(
      createArenaReplyCandidate(original(), hash('c')).observe(post('unknown', []), 0)
    ).toEqual({ state: 'paused', reason: 'ambiguous-state' })
    const t = createArenaReplyCandidate(original(), hash('c'))
    t.observe(post('generating', []), 5)
    expect(t.observe(post('generating', []), 4)).toEqual({
      state: 'paused',
      reason: 'clock-invalid'
    })
  })
  it('copies baseline instead of trusting later mutations', () => {
    const initial = original(),
      t = createArenaReplyCandidate(initial, hash('c'))
    initial.turns[0].digest = hash('e')
    expect(t.observe({ ...initial, control: 'generating' }, 0)).toEqual({
      state: 'paused',
      reason: 'transcript-changed'
    })
  })
  it('rejects sparse snapshots and invalid digests', () => {
    const sparse = original()
    sparse.turns = Array(1) as ObservedTurn[]
    expect(createArenaReplyCandidate(original(), hash('c')).observe(sparse, 0)).toEqual({
      state: 'paused',
      reason: 'invalid-input'
    })
    const invalid = post('generating', [user()])
    invalid.turns[0].digest = 'not-a-hash'
    expect(createArenaReplyCandidate(original(), hash('c')).observe(invalid, 0)).toEqual({
      state: 'paused',
      reason: 'invalid-input'
    })
  })
  it('revokes a previously stable candidate when conversation changes', () => {
    const t = createArenaReplyCandidate(original(), hash('c'))
    t.observe(post('generating', [user()]), 0)
    t.observe(post('send-disabled', [user(), reply()]), 1)
    expect(t.observe(post('send-disabled', [user(), reply()]), 1501).state).toBe('stable-candidate')
    expect(
      t.observe(post('send-disabled', [user(), reply(), turn('extra', 'user', 'a')]), 1502)
    ).toEqual({ state: 'paused', reason: 'unexpected-turns' })
  })
})
