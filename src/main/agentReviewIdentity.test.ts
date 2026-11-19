import { describe, expect, it } from 'vitest'
import {
  hashReviewBytes,
  matchesApprovedReview,
  reviewIdentity,
  type ReviewMaterial
} from './agentReviewIdentity'

const h = (s: string): string => hashReviewBytes(Buffer.from(s, 'utf8'))
function material(): ReviewMaterial {
  return {
    sessionId: 'session-1',
    targetBindingId: 'target-1',
    grantRevision: 1,
    stage: 'proposal',
    projectId: 'project-1',
    worktreeId: 'tree-1',
    baseRevision: 'base-1',
    treeHash: h('tree'),
    patchHash: h('patch'),
    files: [
      { path: 'src/b.ts', kind: 'modified', contentHash: h('b') },
      { path: 'src/a.ts', kind: 'added', contentHash: h('a') }
    ],
    evidence: [{ id: 'tests', status: 'passed', contentHash: h('pass') }],
    omissions: ['video not included']
  }
}

describe('review identity', () => {
  it('hashes exact UTF-8 bytes deterministically', () => {
    expect(h('مرحبا')).toMatch(/^[a-f0-9]{64}$/)
    expect(h('a')).not.toBe(h('A'))
    expect(() => hashReviewBytes('x' as never)).toThrow(/bytes/)
  })
  it('is canonical across inventories without mutating input', () => {
    const a = material(),
      before = JSON.stringify(a),
      b = material()
    b.files.reverse()
    expect(reviewIdentity(a)).toBe(reviewIdentity(b))
    expect(JSON.stringify(a)).toBe(before)
  })
  it.each(['sessionId', 'targetBindingId', 'projectId', 'worktreeId', 'baseRevision'] as const)(
    'changes if %s changes',
    (field) => {
      const a = material(),
        b = material()
      b[field] = 'different'
      expect(reviewIdentity(a)).not.toBe(reviewIdentity(b))
    }
  )
  it('changes for grant, review stage, patch, tree, evidence, files or omissions', () => {
    const original = material(),
      id = reviewIdentity(original)
    const variants: ReviewMaterial[] = [
      { ...material(), grantRevision: 2 },
      { ...material(), stage: 'merge' },
      { ...material(), patchHash: h('different') },
      { ...material(), treeHash: h('different') },
      {
        ...material(),
        evidence: [{ id: 'tests', status: 'failed', contentHash: h('pass') }]
      },
      {
        ...material(),
        files: [{ path: 'src/a.ts', kind: 'added', contentHash: h('changed') }]
      },
      { ...material(), omissions: ['different omission'] }
    ]
    variants.forEach((v) => expect(reviewIdentity(v)).not.toBe(id))
  })
  it('requires an unambiguous matching approval but does not authenticate its origin', () => {
    const id = reviewIdentity(material())
    expect(matchesApprovedReview(id, { decision: 'approve', reviewIdentity: id })).toBe(true)
    expect(matchesApprovedReview(id, { decision: 'reject', reviewIdentity: id })).toBe(false)
    expect(
      matchesApprovedReview(id, {
        decision: 'approve',
        reviewIdentity: reviewIdentity({ ...material(), grantRevision: 2 })
      })
    ).toBe(false)
    expect(matchesApprovedReview(id, 'approved')).toBe(false)
    expect(
      matchesApprovedReview('bad', {
        decision: 'approve',
        reviewIdentity: 'bad'
      })
    ).toBe(false)
  })
  it.each(['../secret', '/absolute', 'a/../b', 'C:/windows', 'a\\b', 'a//b', 'a/./b'])(
    'rejects unsafe or nonportable labels %s',
    (path) => {
      expect(() =>
        reviewIdentity({
          ...material(),
          files: [{ path, kind: 'added', contentHash: h('x') }]
        })
      ).toThrow(/path/)
    }
  )
  it('rejects duplicate paths, duplicate evidence IDs and invalid hashes', () => {
    const a = material()
    a.files.push(a.files[0])
    expect(() => reviewIdentity(a)).toThrow(/Duplicate file/)
    const b = material()
    b.evidence.push(b.evidence[0])
    expect(() => reviewIdentity(b)).toThrow(/Duplicate evidence/)
    expect(() => reviewIdentity({ ...material(), patchHash: 'wrong' })).toThrow(/hash/)
  })
  it('represents deletion and unavailable evidence without claiming bytes exist', () => {
    const m = material()
    m.files = [{ path: 'removed.txt', kind: 'deleted', contentHash: null }]
    m.evidence = [{ id: 'test', status: 'unavailable', contentHash: null }]
    expect(reviewIdentity(m)).toMatch(/^nexus-review-v1:/)
    m.evidence[0].contentHash = h('invented')
    expect(() => reviewIdentity(m)).toThrow(/Unavailable/)
  })
})
