import { AgentBridgeSessions, type BridgeLease, type BridgeTarget } from './agentBridgeSession'
import {
  createArenaReplyCandidate,
  type CandidateResult,
  type ReplySnapshot
} from './arenaReplyCandidate'

export type ProviderCondition = 'clear' | 'captcha' | 'login' | 'error' | 'unknown'
export type WatchResult =
  | { state: 'waiting' }
  | { state: 'candidate'; responseDigest: string }
  | {
      state: 'paused'
      reason: 'provider-blocked' | 'deadline' | 'lease-invalid' | 'evidence-ambiguous' | 'stopped'
    }

/**
 * Unwired in-memory coordination only. `clear` is a caller assertion, not a
 * verified CAPTCHA detector. Candidate is not an authenticated, completed or
 * approved reply. This helper never dispatches, retries or resolves a lease.
 */
export function watchArenaConsultation(
  sessions: AgentBridgeSessions,
  lease: BridgeLease,
  target: BridgeTarget,
  baseline: ReplySnapshot,
  expectedUserDigest: string,
  startMs: number,
  timeoutMs: number
): {
  observe: (
    snapshot: unknown,
    observedTarget: BridgeTarget,
    condition: ProviderCondition,
    nowMs: number
  ) => WatchResult
  stop: (observedTarget: BridgeTarget) => WatchResult
} {
  // The caller must have already marked dispatch starting. This does NOT mean
  // the provider accepted a send. Capture private copies to resist mutation.
  const ownLease = { ...lease }
  const ownTarget = { ...target }
  sessions.assertLease(ownLease, ownTarget)
  if (sessions.snapshot(ownLease.sessionId).requestPhase !== 'dispatched')
    throw new Error('Dispatch is not marked started')
  let tracker: ReturnType<typeof createArenaReplyCandidate>
  try {
    if (
      !Number.isSafeInteger(startMs) ||
      startMs < 0 ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1000 ||
      timeoutMs > 900000 ||
      !Number.isSafeInteger(startMs + timeoutMs) ||
      !baseline ||
      baseline.binding !== ownTarget.conversationId ||
      baseline.navigationEpoch !== ownTarget.navigationEpoch ||
      baseline.grantRevision !== ownLease.grantRevision
    )
      throw new Error('Invalid baseline')
    tracker = createArenaReplyCandidate(baseline, expectedUserDigest)
    // A getter may have reentered the owner during evidence validation.
    sessions.assertLease(ownLease, ownTarget)
  } catch {
    // Dispatch is already marked: malformed or throwing evidence cannot be
    // treated as a harmless initialization failure or safe to resend.
    try {
      sessions.assertLease(ownLease, ownTarget)
      sessions.pause(ownLease.sessionId)
    } catch {
      // A stale lease must not pause a newer request or override revocation.
    }
    throw new Error('Invalid consultation baseline or deadline; delivery uncertain or lease stale')
  }
  let lastTime = startMs
  let stopped: WatchResult | null = null
  const leaseValid = (observedTarget: BridgeTarget): boolean => {
    try {
      sessions.assertLease(ownLease, observedTarget)
      return true
    } catch {
      return false
    }
  }
  const invalidLease = (): WatchResult => {
    stopped = { state: 'paused', reason: 'lease-invalid' }
    return stopped
  }
  const pause = (
    reason: 'provider-blocked' | 'deadline' | 'evidence-ambiguous' | 'stopped'
  ): WatchResult => {
    // A marked dispatch may have reached the provider: the session foundation
    // deliberately enters uncertain instead of being automatically resumed.
    try {
      sessions.assertLease(ownLease, ownTarget)
      sessions.pause(ownLease.sessionId)
    } catch {
      return invalidLease()
    }
    stopped = { state: 'paused', reason }
    return stopped
  }
  return {
    observe(
      snapshot: unknown,
      observedTarget: BridgeTarget,
      condition: ProviderCondition,
      nowMs: number
    ): WatchResult {
      if (stopped) return stopped
      if (!leaseValid(observedTarget)) return invalidLease()
      if (!Number.isSafeInteger(nowMs) || nowMs < lastTime) return pause('evidence-ambiguous')
      lastTime = nowMs
      if (nowMs - startMs >= timeoutMs) return pause('deadline')
      if (condition !== 'clear') return pause('provider-blocked')
      let result: CandidateResult
      try {
        result = tracker.observe(snapshot, nowMs)
      } catch {
        // Never propagate page-derived errors or leave a dispatched request
        // active after an observer exception.
        return pause('evidence-ambiguous')
      }
      if (!leaseValid(observedTarget)) return invalidLease()
      if (result.state === 'paused') return pause('evidence-ambiguous')
      if (result.state === 'stable-candidate')
        return { state: 'candidate', responseDigest: result.responseDigest }
      return { state: 'waiting' }
    },
    stop(observedTarget: BridgeTarget): WatchResult {
      if (stopped) return stopped
      if (!leaseValid(observedTarget)) return invalidLease()
      return pause('stopped')
    }
  }
}
