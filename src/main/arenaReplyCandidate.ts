// In-memory evidence checker only. Nothing here sends messages, observes the
// DOM, authenticates the provider, or establishes completion or approval.
export type ControlState = 'ready-to-send' | 'generating' | 'send-disabled' | 'unknown'
export type TurnRole = 'user' | 'other'
export interface ObservedTurn {
  id: string
  role: TurnRole
  digest: string
}
export interface ReplySnapshot {
  binding: string
  navigationEpoch: string
  grantRevision: number
  control: ControlState
  turns: ObservedTurn[]
}
export type CandidateResult =
  | { state: 'waiting' }
  | { state: 'stable-candidate'; responseDigest: string }
  | {
      state: 'paused'
      reason:
        | 'invalid-input'
        | 'binding-changed'
        | 'transcript-changed'
        | 'unexpected-turns'
        | 'clock-invalid'
        | 'ambiguous-state'
    }

type PauseReason = Extract<CandidateResult, { state: 'paused' }>['reason']
const digestPattern = /^[a-f0-9]{64}$/
const MAX_TURNS = 10000
const STABILITY_MS = 1500

function safeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
}
function validTurn(value: unknown): value is ObservedTurn {
  if (!value || typeof value !== 'object') return false
  const t = value as Record<string, unknown>
  return (
    safeId(t.id) &&
    (t.role === 'user' || t.role === 'other') &&
    typeof t.digest === 'string' &&
    digestPattern.test(t.digest)
  )
}
function validSnapshot(value: unknown): value is ReplySnapshot {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  if (
    !safeId(s.binding) ||
    !safeId(s.navigationEpoch) ||
    !Number.isSafeInteger(s.grantRevision) ||
    (s.grantRevision as number) < 0 ||
    !['ready-to-send', 'generating', 'send-disabled', 'unknown'].includes(s.control as string) ||
    !Array.isArray(s.turns) ||
    s.turns.length > MAX_TURNS ||
    !Array.from(s.turns).every(validTurn)
  )
    return false
  return new Set(s.turns.map((t: ObservedTurn) => t.id)).size === s.turns.length
}
function sameTurn(a: ObservedTurn, b: ObservedTurn): boolean {
  return a.id === b.id && a.role === b.role && a.digest === b.digest
}

/**
 * Baseline must be captured immediately before an independently authorized
 * send, in a trusted, exclusive-writer context. expectedUserDigest represents
 * the exact user turn expected from that send, produced independently by a
 * future trusted adapter. All digests and IDs are caller assertions. The
 * adapter must check provider/origin/tab identity, actual send, role and
 * content, completion/error states, privacy, and correlation independently.
 * Any mutation, disappearance, reload, competing turn or ambiguity pauses.
 * This observer never creates a verified response or an approval.
 */
export function createArenaReplyCandidate(
  baseline: unknown,
  expectedUserDigest: unknown
): {
  observe: (snapshot: unknown, monotonicMs: number) => CandidateResult
} {
  let paused: PauseReason | null = null
  if (
    !validSnapshot(baseline) ||
    baseline.control !== 'ready-to-send' ||
    typeof expectedUserDigest !== 'string' ||
    !digestPattern.test(expectedUserDigest)
  )
    paused = 'invalid-input'
  // Snapshot immutably; callers may reuse and mutate DOM-derived arrays.
  const initial = validSnapshot(baseline)
    ? {
        binding: baseline.binding,
        navigationEpoch: baseline.navigationEpoch,
        grantRevision: baseline.grantRevision,
        turns: baseline.turns.map((turn) => ({ ...turn }))
      }
    : null
  let lastTime: number | null = null
  let sawGenerating = false
  let stableSince: number | null = null
  let lastResponse: ObservedTurn | null = null
  let userId: string | null = null
  let responseId: string | null = null
  let sawDisabledAfterGeneration = false
  const pause = (reason: PauseReason): CandidateResult => {
    paused = reason
    return { state: 'paused', reason }
  }

  return {
    observe(snapshot: unknown, monotonicMs: number): CandidateResult {
      if (paused) return { state: 'paused', reason: paused }
      if (!initial || !validSnapshot(snapshot)) return pause('invalid-input')
      if (
        !Number.isSafeInteger(monotonicMs) ||
        monotonicMs < 0 ||
        (lastTime !== null && monotonicMs < lastTime)
      )
        return pause('clock-invalid')
      lastTime = monotonicMs
      if (
        snapshot.binding !== initial.binding ||
        snapshot.navigationEpoch !== initial.navigationEpoch ||
        snapshot.grantRevision !== initial.grantRevision
      )
        return pause('binding-changed')
      if (
        snapshot.turns.length < initial.turns.length ||
        initial.turns.some((turn, i) => !sameTurn(turn, snapshot.turns[i]))
      )
        return pause('transcript-changed')
      const added = snapshot.turns.slice(initial.turns.length)
      if (
        added.length > 2 ||
        (added.length >= 1 &&
          (added[0].role !== 'user' || added[0].digest !== expectedUserDigest)) ||
        (added.length === 2 && added[1].role !== 'other')
      )
        return pause('unexpected-turns')
      if (
        (userId && (added.length < 1 || added[0].id !== userId)) ||
        (responseId && (added.length < 2 || added[1].id !== responseId))
      )
        return pause('transcript-changed')
      if (added.length >= 1) userId = added[0].id
      if (added.length === 2) responseId = added[1].id
      if (snapshot.control === 'unknown' || snapshot.control === 'ready-to-send')
        return pause('ambiguous-state')
      if (snapshot.control === 'generating') {
        if (sawDisabledAfterGeneration) return pause('ambiguous-state')
        sawGenerating = true
        stableSince = null
        lastResponse = null
        return { state: 'waiting' }
      }
      // A disabled Send control can also mean failure, cancellation or other
      // states. It is only one weak condition in a provisional observation.
      if (!sawGenerating || added.length !== 2) return pause('ambiguous-state')
      sawDisabledAfterGeneration = true
      const response = added[1]
      if (!lastResponse || !sameTurn(lastResponse, response)) {
        lastResponse = { ...response }
        stableSince = monotonicMs
        return { state: 'waiting' }
      }
      if (stableSince === null || monotonicMs - stableSince < STABILITY_MS)
        return { state: 'waiting' }
      return { state: 'stable-candidate', responseDigest: response.digest }
    }
  }
}
