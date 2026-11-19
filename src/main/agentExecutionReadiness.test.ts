import { describe, expect, it } from 'vitest'
import {
  assessExecutionReadiness,
  type ExecutionReadinessInput,
  type ReadinessBlocker
} from './agentExecutionReadiness'

function ready(): ExecutionReadinessInput {
  return {
    platformSupported: true,
    isolationVerified: true,
    processTreeContainmentVerified: true,
    writeBoundaryVerified: true,
    protectedReadBoundaryVerified: true,
    egressDataProtectionVerified: true,
    cooperativeStopAndSettlementVerified: true,
    scopeIdentityVerified: true,
    sessionGrantCurrent: true,
    projectScopeApproved: true,
    commandReviewed: true,
    risk: 'ordinary',
    highRiskUserApproval: false,
    touchesSensitiveOrOutsideScope: false,
    sensitiveOrOutsideScopeUserApproval: false,
    networkMode: 'allowed',
    networkPolicyVerified: true
  }
}

describe('advisory execution readiness, not authorization', () => {
  it('reports satisfied assertions without claiming actual sandbox enforcement', () => {
    expect(assessExecutionReadiness(ready())).toEqual({
      assessment: 'requirements-satisfied',
      blockers: []
    })
  })
  it.each([
    ['platformSupported', 'unsupported-platform'],
    ['isolationVerified', 'isolation-unverified'],
    ['processTreeContainmentVerified', 'process-containment-unverified'],
    ['writeBoundaryVerified', 'write-boundary-unverified'],
    ['protectedReadBoundaryVerified', 'protected-read-boundary-unverified'],
    ['egressDataProtectionVerified', 'egress-data-protection-unverified'],
    ['cooperativeStopAndSettlementVerified', 'stop-and-settlement-unverified'],
    ['scopeIdentityVerified', 'identity-unverified'],
    ['sessionGrantCurrent', 'grant-not-current'],
    ['projectScopeApproved', 'scope-not-approved'],
    ['commandReviewed', 'command-not-reviewed'],
    ['networkPolicyVerified', 'network-policy-unverified']
  ] as Array<[keyof ExecutionReadinessInput, ReadinessBlocker]>)(
    'fails closed when %s is false',
    (key, reason) => {
      expect(assessExecutionReadiness({ ...ready(), [key]: false })).toEqual({
        assessment: 'blocked',
        blockers: [reason]
      })
    }
  )
  it('allows default network only when both network and protected-data controls are verified', () => {
    const input = ready()
    input.egressDataProtectionVerified = false
    expect(assessExecutionReadiness(input).blockers).toContain('egress-data-protection-unverified')
    input.networkMode = 'denied'
    expect(assessExecutionReadiness(input).assessment).toBe('requirements-satisfied')
    input.networkPolicyVerified = false
    expect(assessExecutionReadiness(input).blockers).toContain('network-policy-unverified')
  })
  it.each(['high', 'unknown'] as const)(
    '%s risk always requires explicit user approval',
    (risk) => {
      const input = { ...ready(), risk }
      expect(assessExecutionReadiness(input).blockers).toContain('high-risk-approval-required')
      expect(assessExecutionReadiness({ ...input, highRiskUserApproval: true }).assessment).toBe(
        'requirements-satisfied'
      )
    }
  )
  it('requires distinct individual sensitive or outside-project approval', () => {
    const input = {
      ...ready(),
      touchesSensitiveOrOutsideScope: true,
      risk: 'high' as const,
      highRiskUserApproval: true
    }
    expect(assessExecutionReadiness(input).blockers).toContain(
      'sensitive-or-outside-approval-required'
    )
    expect(
      assessExecutionReadiness({ ...input, sensitiveOrOutsideScopeUserApproval: true }).assessment
    ).toBe('requirements-satisfied')
  })
  it('does not interpret missing, null, nonboolean or unknown fields as verified', () => {
    for (const value of [
      null,
      {},
      { ...ready(), risk: 'medium' },
      { ...ready(), networkMode: 'maybe' },
      { ...ready(), isolationVerified: 'true' },
      { ...ready(), commandReviewed: undefined }
    ]) {
      expect(assessExecutionReadiness(value)).toEqual({
        assessment: 'blocked',
        blockers: ['invalid-input']
      })
    }
  })
  it('returns all missing protections without exposing supplied text', () => {
    const value = {
      ...ready(),
      isolationVerified: false,
      writeBoundaryVerified: false,
      secret: 'private text'
    }
    const result = assessExecutionReadiness(value)
    expect(result.blockers).toEqual(['isolation-unverified', 'write-boundary-unverified'])
    expect(JSON.stringify(result)).not.toContain('private')
  })
  it('fails closed on throwing input accessors', () => {
    const value = {
      ...ready(),
      get isolationVerified(): boolean {
        throw new Error('private')
      }
    }
    expect(assessExecutionReadiness(value)).toEqual({
      assessment: 'blocked',
      blockers: ['invalid-input']
    })
  })
})
