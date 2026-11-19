import { randomUUID } from 'crypto'

/**
 * Session grants for the agent bridge (plan 01, step 3).
 *
 * A grant is the user's revocable permission for ONE agent session to do a NAMED set of
 * things in ONE project/worktree/conversation for a bounded time. Three properties matter
 * and are enforced here rather than by callers:
 *
 *  - **A grant is checked by id + revision at the moment of the effect.** A caller holding a
 *    stale copy of a revoked or superseded grant gets nothing, even if the timestamps still
 *    look valid.
 *  - **Scope is not inferred.** Any mismatch on session, project, worktree or conversation
 *    fails closed; there is no "closest match".
 *  - **Secrets never live in the grant.** `clientId` identifies the MCP client; the client's
 *    shared secret is checked by the transport and is deliberately absent from what is
 *    persisted or returned.
 */

export type AgentAction =
  | 'consult-arena'
  | 'read-context'
  | 'submit-review'
  | 'prepare-edit'
  | 'dispatch-message'
  | 'run-command'

export const AGENT_ACTIONS: AgentAction[] = [
  'consult-arena',
  'read-context',
  'submit-review',
  'prepare-edit',
  'dispatch-message',
  'run-command'
]

export interface GrantScope {
  clientId: string
  agentSessionId: string
  projectId: string
  worktreeId: string
  conversationId: string
}

export interface AgentGrant extends GrantScope {
  grantId: string
  actions: AgentAction[]
  /** Absolute directories the session may name. Empty means "no paths at all". */
  approvedPaths: string[]
  /** Whether the user allowed autonomous sends inside this scope. */
  autoSend: boolean
  revision: number
  issuedAt: number
  expiresAt: number
  revokedAt: number | null
  revocationReason: string | null
}

export interface IssueGrantInput extends GrantScope {
  actions: AgentAction[]
  approvedPaths?: string[]
  autoSend?: boolean
  ttlMs?: number
  now?: number
}

export type GrantCheckCode =
  | 'unknown-grant'
  | 'revoked'
  | 'expired'
  | 'scope-mismatch'
  | 'action-not-granted'
  | 'auto-send-not-granted'
  | 'path-not-granted'
  | 'revision-mismatch'

export type GrantCheck =
  | { allowed: true; grant: AgentGrant }
  | { allowed: false; code: GrantCheckCode; message: string }

export interface GrantRequirement extends Partial<GrantScope> {
  action: AgentAction
  /** Paths the action would touch, if any. Every one must be granted. */
  paths?: string[]
  /** True when the action sends content outward. */
  needsAutoSend?: boolean
  /** The revision the caller believes is current. A mismatch means it must re-read. */
  expectedRevision?: number
}

/** 30 minutes: short enough that a forgotten session stops being useful. */
export const DEFAULT_GRANT_TTL_MS = 30 * 60 * 1000
export const MAX_GRANT_TTL_MS = 12 * 60 * 60 * 1000

export interface GrantPersistence {
  load(): unknown
  save(grants: AgentGrant[]): void
}

const scopeKeys: ReadonlyArray<keyof GrantScope> = [
  'clientId',
  'agentSessionId',
  'projectId',
  'worktreeId',
  'conversationId'
]

function validateScope(scope: Partial<GrantScope>, keys: ReadonlyArray<keyof GrantScope>): string | null {
  for (const key of keys) {
    const value = scope[key]
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 1024) {
      return `Invalid ${key}.`
    }
  }
  return null
}

const pathCovered = (candidate: string, approved: string[]): boolean =>
  approved.some((root) => {
    const clean = root.replace(/\/+$/, '')
    return candidate === clean || candidate.startsWith(`${clean}/`)
  })

export class AgentGrantStore {
  private grants = new Map<string, AgentGrant>()
  private now: () => number
  private persistence: GrantPersistence | null

  constructor(options: { now?: () => number; persistence?: GrantPersistence } = {}) {
    this.now = options.now ?? Date.now
    this.persistence = options.persistence ?? null
    if (this.persistence) this.restore()
  }

  /** Re-read persisted grants, treating anything malformed as revoked-on-sight. */
  private restore(): void {
    if (!this.persistence) return
    const raw = this.persistence.load()
    if (!Array.isArray(raw)) return
    for (const entry of raw) {
      const grant = entry as AgentGrant
      if (
        !grant ||
        typeof grant !== 'object' ||
        typeof grant.grantId !== 'string' ||
        validateScope(grant, scopeKeys) !== null ||
        !Array.isArray(grant.actions)
      ) {
        continue
      }
      this.grants.set(grant.grantId, { ...grant })
    }
  }

  private persist(): void {
    this.persistence?.save([...this.grants.values()].map((grant) => ({ ...grant })))
  }

  issue(input: IssueGrantInput): AgentGrant {
    const invalid = validateScope(input, scopeKeys)
    if (invalid) throw new Error(invalid)
    if (!Array.isArray(input.actions) || input.actions.length === 0) {
      throw new Error('A grant must name at least one action.')
    }
    for (const action of input.actions) {
      if (!AGENT_ACTIONS.includes(action)) throw new Error(`Unknown action "${String(action)}".`)
    }
    const now = input.now ?? this.now()
    const ttl = Math.min(input.ttlMs ?? DEFAULT_GRANT_TTL_MS, MAX_GRANT_TTL_MS)
    const grant: AgentGrant = {
      grantId: `grant-${randomUUID()}`,
      clientId: input.clientId,
      agentSessionId: input.agentSessionId,
      projectId: input.projectId,
      worktreeId: input.worktreeId,
      conversationId: input.conversationId,
      actions: [...new Set(input.actions)],
      approvedPaths: (input.approvedPaths ?? []).filter((path) => typeof path === 'string' && path.startsWith('/')),
      autoSend: input.autoSend === true,
      revision: 1,
      issuedAt: now,
      expiresAt: now + ttl,
      revokedAt: null,
      revocationReason: null
    }
    this.grants.set(grant.grantId, grant)
    this.persist()
    return { ...grant }
  }

  get(grantId: string): AgentGrant | undefined {
    const grant = this.grants.get(grantId)
    return grant ? { ...grant } : undefined
  }

  list(): AgentGrant[] {
    return [...this.grants.values()].map((grant) => ({ ...grant }))
  }

  /** Revocation is permanent for that id: the record stays, the permission does not. */
  revoke(grantId: string, reason = 'revoked by the user'): boolean {
    const grant = this.grants.get(grantId)
    if (!grant || grant.revokedAt !== null) return false
    grant.revokedAt = this.now()
    grant.revocationReason = reason
    grant.revision += 1
    this.persist()
    return true
  }

  /**
   * Narrow an existing grant (fewer actions, fewer paths). Widening requires a new grant so
   * the user approves exactly what is added.
   */
  narrow(grantId: string, reduction: { actions?: AgentAction[]; approvedPaths?: string[] }): AgentGrant | null {
    const grant = this.grants.get(grantId)
    if (!grant || grant.revokedAt !== null) return null
    const actions = reduction.actions
      ? grant.actions.filter((action) => reduction.actions?.includes(action))
      : grant.actions
    if (actions.length === 0) throw new Error('Narrowing cannot leave a grant with no actions.')
    grant.actions = actions
    if (reduction.approvedPaths) {
      const subset = grant.approvedPaths.filter((path) => pathCovered(path, reduction.approvedPaths ?? []))
      grant.approvedPaths = subset
    }
    grant.revision += 1
    this.persist()
    return { ...grant }
  }

  /** Check at the moment of use. Never call once and reuse the answer later. */
  check(grantId: string, requirement: GrantRequirement): GrantCheck {
    const grant = this.grants.get(grantId)
    if (!grant) {
      return { allowed: false, code: 'unknown-grant', message: 'That grant does not exist.' }
    }
    if (grant.revokedAt !== null) {
      return {
        allowed: false,
        code: 'revoked',
        message: `This grant was revoked${grant.revocationReason ? ` (${grant.revocationReason})` : ''}.`
      }
    }
    if (grant.expiresAt <= this.now()) {
      return { allowed: false, code: 'expired', message: 'This grant has expired; ask the user to renew it.' }
    }
    const mismatch = validateScope(requirement, scopeKeys.filter((key) => requirement[key] !== undefined))
    if (mismatch) {
      return { allowed: false, code: 'scope-mismatch', message: mismatch }
    }
    for (const key of scopeKeys) {
      if (requirement[key] !== undefined && requirement[key] !== grant[key]) {
        return {
          allowed: false,
          code: 'scope-mismatch',
          message: `This grant was issued for a different ${key}.`
        }
      }
    }
    if (!grant.actions.includes(requirement.action)) {
      return {
        allowed: false,
        code: 'action-not-granted',
        message: `"${requirement.action}" was not approved for this session.`
      }
    }
    if (requirement.needsAutoSend && !grant.autoSend) {
      return {
        allowed: false,
        code: 'auto-send-not-granted',
        message: 'Sending without a per-message approval was not granted for this session.'
      }
    }
    for (const path of requirement.paths ?? []) {
      if (!pathCovered(path, grant.approvedPaths)) {
        return {
          allowed: false,
          code: 'path-not-granted',
          message: `"${path}" is outside the paths approved for this session.`
        }
      }
    }
    if (requirement.expectedRevision !== undefined && requirement.expectedRevision !== grant.revision) {
      return {
        allowed: false,
        code: 'revision-mismatch',
        message: 'This grant changed since you read it; re-read it before acting.'
      }
    }
    return { allowed: true, grant: { ...grant } }
  }

  /** Expire grants that timed out. They stay listed as revoked-by-expiry for the audit trail. */
  sweepExpired(): number {
    const now = this.now()
    let count = 0
    for (const grant of this.grants.values()) {
      if (grant.revokedAt === null && grant.expiresAt <= now) {
        grant.revokedAt = now
        grant.revocationReason = 'expired'
        grant.revision += 1
        count++
      }
    }
    if (count > 0) this.persist()
    return count
  }

  /** Drop finished records. Only safe once nothing references the grant ids. */
  prune(olderThanMs: number): number {
    const cutoff = this.now() - olderThanMs
    let removed = 0
    for (const [grantId, grant] of [...this.grants]) {
      if (grant.revokedAt !== null && grant.revokedAt < cutoff) {
        this.grants.delete(grantId)
        removed++
      }
    }
    if (removed > 0) this.persist()
    return removed
  }
}
