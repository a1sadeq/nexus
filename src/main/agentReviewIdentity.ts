import { createHash } from 'crypto'

/** Deterministic identity only: not an approval, authentication or sandbox. */
export type EvidenceStatus = 'passed' | 'failed' | 'not-run' | 'unavailable'
export type ChangeKind = 'added' | 'modified' | 'deleted'
export type ReviewStage = 'proposal' | 'post-apply' | 'merge'

export interface ReviewedFile {
  /** Portable project-relative path. Caller must separately enforce filesystem containment. */
  path: string
  kind: ChangeKind
  /** SHA-256 of exact proposed bytes; deleted files have no proposed bytes. */
  contentHash: string | null
}

export interface ReviewEvidence {
  /** Non-sensitive, bounded ID assigned by the trusted coordinator. */
  id: string
  status: EvidenceStatus
  /** Hash of the exact evidence bytes; null only when not-run/unavailable. */
  contentHash: string | null
}

export interface ReviewMaterial {
  sessionId: string
  targetBindingId: string
  grantRevision: number
  stage: ReviewStage
  projectId: string
  worktreeId: string
  baseRevision: string
  /** SHA-256 of an exact snapshot of the proposed or actual tree. */
  treeHash: string
  /** SHA-256 of the exact patch bytes. */
  patchHash: string
  files: ReviewedFile[]
  evidence: ReviewEvidence[]
  /** Human-readable description of missing context/test coverage; empty means none declared. */
  omissions: string[]
}

const hashPattern = /^[a-f0-9]{64}$/
const allowedStages = new Set<ReviewStage>(['proposal', 'post-apply', 'merge'])
const allowedChanges = new Set<ChangeKind>(['added', 'modified', 'deleted'])
const allowedEvidence = new Set<EvidenceStatus>(['passed', 'failed', 'not-run', 'unavailable'])

export function hashReviewBytes(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) throw new Error('Expected exact bytes')
  return createHash('sha256').update(bytes).digest('hex')
}

function text(value: unknown, label: string, max = 1024): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    value.split('').some((c) => c.charCodeAt(0) <= 0x1f || c.charCodeAt(0) === 0x7f)
  ) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !hashPattern.test(value)) throw new Error(`Invalid ${label}`)
  return value
}

function relativePath(value: unknown): string {
  const p = text(value, 'file path', 4096)
  // Portable forward-slash paths only; this is not a filesystem authorization check.
  if (
    p.startsWith('/') ||
    p.includes('\\') ||
    /^[a-z]:/i.test(p) ||
    p.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error('Invalid file path')
  }
  return p
}

function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Returns a versioned digest of canonical metadata. The caller must independently
 * obtain authoritative file/tree/evidence bytes, compute their hashes, enumerate
 * every change, validate session/target permissions and correlate the Arena reply.
 * A matching digest does not establish any of those facts or authorize an action.
 */
export function reviewIdentity(material: ReviewMaterial): string {
  if (!material || typeof material !== 'object') throw new Error('Invalid review material')
  if (!Number.isSafeInteger(material.grantRevision) || material.grantRevision < 1) {
    throw new Error('Invalid grant revision')
  }
  if (!allowedStages.has(material.stage)) throw new Error('Invalid review stage')
  if (
    !Array.isArray(material.files) ||
    material.files.length === 0 ||
    material.files.length > 10000
  ) {
    throw new Error('Invalid file inventory')
  }
  if (
    !Array.isArray(material.evidence) ||
    material.evidence.length > 1000 ||
    !Array.isArray(material.omissions) ||
    material.omissions.length > 1000
  ) {
    throw new Error('Invalid evidence inventory')
  }
  const seenPaths = new Set<string>()
  const files = material.files
    .map((file) => {
      if (!file || typeof file !== 'object') throw new Error('Invalid file')
      const path = relativePath(file.path)
      if (seenPaths.has(path)) throw new Error('Duplicate file path')
      seenPaths.add(path)
      if (!allowedChanges.has(file.kind)) throw new Error('Invalid change kind')
      const contentHash =
        file.kind === 'deleted'
          ? file.contentHash === null
            ? null
            : (() => {
                throw new Error('Deleted file must have no proposed content hash')
              })()
          : hash(file.contentHash, 'file content hash')
      return { path, kind: file.kind, contentHash }
    })
    .sort((a, b) => byCodePoint(a.path, b.path))

  const seenEvidence = new Set<string>()
  const evidence = material.evidence
    .map((item) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid evidence')
      const id = text(item.id, 'evidence ID')
      if (seenEvidence.has(id)) throw new Error('Duplicate evidence ID')
      seenEvidence.add(id)
      if (!allowedEvidence.has(item.status)) throw new Error('Invalid evidence status')
      const contentHash =
        item.status === 'not-run' || item.status === 'unavailable'
          ? item.contentHash === null
            ? null
            : (() => {
                throw new Error('Unavailable evidence must not carry a result hash')
              })()
          : hash(item.contentHash, 'evidence content hash')
      return { id, status: item.status, contentHash }
    })
    .sort((a, b) => byCodePoint(a.id, b.id))

  const omissions = material.omissions.map((item) => text(item, 'omission', 4096)).sort(byCodePoint)
  const canonical = {
    version: 1,
    sessionId: text(material.sessionId, 'session ID'),
    targetBindingId: text(material.targetBindingId, 'target binding ID'),
    grantRevision: material.grantRevision,
    stage: material.stage,
    projectId: text(material.projectId, 'project ID'),
    worktreeId: text(material.worktreeId, 'worktree ID'),
    baseRevision: text(material.baseRevision, 'base revision'),
    treeHash: hash(material.treeHash, 'tree hash'),
    patchHash: hash(material.patchHash, 'patch hash'),
    files,
    evidence,
    omissions
  }
  return `nexus-review-v1:${hashReviewBytes(Buffer.from(JSON.stringify(canonical), 'utf8'))}`
}

/** Reject ambiguous approvals. Trusted caller must separately verify provenance and permissions. */
export function matchesApprovedReview(expectedIdentity: string, decision: unknown): boolean {
  if (
    !/^nexus-review-v1:[a-f0-9]{64}$/.test(expectedIdentity) ||
    !decision ||
    typeof decision !== 'object'
  )
    return false
  const value = decision as Record<string, unknown>
  return value.decision === 'approve' && value.reviewIdentity === expectedIdentity
}
