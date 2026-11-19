import { randomUUID } from 'crypto'

/**
 * Internal in-memory bookkeeping only. This module is NOT an authentication,
 * filesystem isolation, persistence, MCP transport or provider validation layer.
 * Callers must obtain trusted identities and authorize the user independently.
 */
export interface BridgeTarget {
  tabId: string
  providerId: string
  conversationId: string
  navigationEpoch: string
  agentSessionId: string
  projectId: string
  worktreeId: string
}

type SessionPhase = 'awaiting-consent' | 'ready' | 'busy' | 'paused' | 'uncertain' | 'revoked'
type RequestPhase = 'prepared' | 'dispatched'

export interface BridgeSnapshot {
  sessionId: string
  phase: SessionPhase
  grantRevision: number
  requestPhase: RequestPhase | null
}

export interface BridgeLease {
  sessionId: string
  requestId: string
  generation: number
  grantRevision: number
}

interface Session {
  target: BridgeTarget
  phase: SessionPhase
  grantRevision: number
  generation: number
  request: { requestId: string; phase: RequestPhase } | null
  revokedUncertainty: boolean
}

const targetKeys: ReadonlyArray<keyof BridgeTarget> = [
  'tabId',
  'providerId',
  'conversationId',
  'navigationEpoch',
  'agentSessionId',
  'projectId',
  'worktreeId'
]

function copyTarget(target: BridgeTarget): BridgeTarget {
  if (!target || typeof target !== 'object') throw new Error('Invalid target identity')
  for (const key of targetKeys) {
    if (typeof target[key] !== 'string' || !target[key].trim() || target[key].length > 1024) {
      throw new Error('Invalid target identity')
    }
  }
  return {
    tabId: target.tabId,
    providerId: target.providerId,
    conversationId: target.conversationId,
    navigationEpoch: target.navigationEpoch,
    agentSessionId: target.agentSessionId,
    projectId: target.projectId,
    worktreeId: target.worktreeId
  }
}

function targetsMatch(a: BridgeTarget, b: BridgeTarget): boolean {
  return targetKeys.every((key) => a[key] === b[key])
}

/**
 * The owner must serialize actual dispatch per session and invoke assertLease
 * immediately before each side effect. This does not make an async side effect
 * atomic with a subsequent pause/revocation. Uncertain results need reconciliation.
 */
export class AgentBridgeSessions {
  private readonly sessions = new Map<string, Session>()

  create(target: BridgeTarget): BridgeSnapshot {
    const binding = copyTarget(target)
    const sessionId = randomUUID()
    this.sessions.set(sessionId, {
      target: binding,
      phase: 'awaiting-consent',
      grantRevision: 0,
      generation: 0,
      request: null,
      revokedUncertainty: false
    })
    return this.snapshot(sessionId)
  }

  snapshot(sessionId: string): BridgeSnapshot {
    const s = this.requireSession(sessionId)
    return {
      sessionId,
      phase: s.phase,
      grantRevision: s.grantRevision,
      requestPhase: s.request?.phase ?? null
    }
  }

  /** Only a separately authorized user-consent flow may call this. */
  grant(sessionId: string, observedTarget: BridgeTarget): BridgeSnapshot {
    const s = this.requireSession(sessionId)
    this.requireTarget(s, observedTarget)
    if (s.phase !== 'awaiting-consent') throw new Error('Cannot grant in current state')
    s.grantRevision++
    s.generation++
    s.phase = 'ready'
    return this.snapshot(sessionId)
  }

  begin(sessionId: string, observedTarget: BridgeTarget): BridgeLease {
    const s = this.requireSession(sessionId)
    this.requireTarget(s, observedTarget)
    if (s.phase !== 'ready') throw new Error('Session is not ready')
    const requestId = randomUUID()
    s.generation++
    s.request = { requestId, phase: 'prepared' }
    s.phase = 'busy'
    return { sessionId, requestId, generation: s.generation, grantRevision: s.grantRevision }
  }

  assertLease(lease: BridgeLease, observedTarget: BridgeTarget): void {
    const s = this.requireSession(lease.sessionId)
    this.requireTarget(s, observedTarget)
    if (
      s.phase !== 'busy' ||
      !s.request ||
      s.request.requestId !== lease.requestId ||
      s.generation !== lease.generation ||
      s.grantRevision !== lease.grantRevision
    ) {
      throw new Error('Stale or invalid request lease')
    }
  }

  /** Marks an attempt about to cross the side-effect boundary, not provider acceptance. */
  markDispatchStarting(lease: BridgeLease, observedTarget: BridgeTarget): void {
    this.assertLease(lease, observedTarget)
    const s = this.requireSession(lease.sessionId)
    if (!s.request || s.request.phase !== 'prepared') throw new Error('Dispatch already started')
    s.request.phase = 'dispatched'
  }

  /** Call only when the trusted adapter has positively resolved the current attempt. */
  resolve(lease: BridgeLease, observedTarget: BridgeTarget): BridgeSnapshot {
    this.assertLease(lease, observedTarget)
    const s = this.requireSession(lease.sessionId)
    if (s.request?.phase !== 'dispatched') throw new Error('Request has not started dispatch')
    s.request = null
    s.generation++
    s.phase = 'ready'
    return this.snapshot(lease.sessionId)
  }

  /** Pause invalidates every prior lease; dispatched work is uncertain until reconciled. */
  pause(sessionId: string): BridgeSnapshot {
    const s = this.requireSession(sessionId)
    if (s.phase === 'revoked') throw new Error('Session is revoked')
    if (s.phase === 'awaiting-consent') throw new Error('Session has no grant')
    const uncertain = s.phase === 'uncertain' || s.request?.phase === 'dispatched'
    s.generation++
    s.request = null
    s.phase = uncertain ? 'uncertain' : 'paused'
    return this.snapshot(sessionId)
  }

  /** This never grants permission to resend. Caller must reconcile actual provider state. */
  acknowledgeUncertainty(sessionId: string, observedTarget: BridgeTarget): BridgeSnapshot {
    const s = this.requireSession(sessionId)
    this.requireTarget(s, observedTarget)
    if (s.phase !== 'uncertain') throw new Error('Session is not uncertain')
    s.phase = 'paused'
    s.generation++
    return this.snapshot(sessionId)
  }

  resume(sessionId: string, observedTarget: BridgeTarget): BridgeSnapshot {
    const s = this.requireSession(sessionId)
    this.requireTarget(s, observedTarget)
    if (s.phase !== 'paused' || s.grantRevision === 0) throw new Error('Session cannot resume')
    s.phase = 'ready'
    s.generation++
    return this.snapshot(sessionId)
  }

  revoke(sessionId: string): BridgeSnapshot {
    const s = this.requireSession(sessionId)
    s.revokedUncertainty =
      s.revokedUncertainty || s.phase === 'uncertain' || s.request?.phase === 'dispatched'
    s.phase = 'revoked'
    s.request = null
    s.generation++
    s.grantRevision++
    return this.snapshot(sessionId)
  }

  /** Trusted owner only, after independently reconciling revoked delivery. Never resumes. */
  acknowledgeRevokedUncertainty(sessionId: string, observedTarget: BridgeTarget): void {
    const s = this.requireSession(sessionId)
    this.requireTarget(s, observedTarget)
    if (s.phase !== 'revoked') throw new Error('Session is not revoked')
    s.revokedUncertainty = false
  }

  /** Trusted owner can check before removing a separate gate registration. */
  assertRevokedSettled(sessionId: string): void {
    const s = this.requireSession(sessionId)
    if (s.phase !== 'revoked' || s.revokedUncertainty)
      throw new Error('Revoked session is unresolved')
  }

  /** Trusted owner only, after independently preserving any unresolved work. */
  forgetRevoked(sessionId: string): void {
    this.assertRevokedSettled(sessionId)
    this.sessions.delete(sessionId)
  }

  private requireSession(sessionId: string): Session {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('Unknown session')
    return s
  }

  private requireTarget(s: Session, observedTarget: BridgeTarget): void {
    let matches = false
    try {
      matches = targetsMatch(s.target, copyTarget(observedTarget))
    } catch {
      /* fail closed */
    }
    if (!matches) {
      if (s.phase !== 'revoked') {
        const uncertain = s.phase === 'uncertain' || s.request?.phase === 'dispatched'
        s.phase = uncertain ? 'uncertain' : s.grantRevision ? 'paused' : 'awaiting-consent'
        s.request = null
        s.generation++
      }
      throw new Error('Target identity mismatch; session paused or blocked')
    }
  }
}
