/**
 * Advisory, unwired checklist only: never an authorization token or sandbox.
 * All inputs are assertions from a future trusted verifier, not facts inferred
 * from command text, model output, renderer IPC or this function itself.
 */
export interface ExecutionReadinessInput {
  platformSupported: boolean
  isolationVerified: boolean
  processTreeContainmentVerified: boolean
  writeBoundaryVerified: boolean
  protectedReadBoundaryVerified: boolean
  egressDataProtectionVerified: boolean
  cooperativeStopAndSettlementVerified: boolean
  scopeIdentityVerified: boolean
  sessionGrantCurrent: boolean
  projectScopeApproved: boolean
  commandReviewed: boolean
  risk: 'ordinary' | 'high' | 'unknown'
  highRiskUserApproval: boolean
  touchesSensitiveOrOutsideScope: boolean
  sensitiveOrOutsideScopeUserApproval: boolean
  networkMode: 'allowed' | 'denied'
  networkPolicyVerified: boolean
}
export type ReadinessBlocker =
  | 'invalid-input'
  | 'unsupported-platform'
  | 'isolation-unverified'
  | 'process-containment-unverified'
  | 'write-boundary-unverified'
  | 'protected-read-boundary-unverified'
  | 'egress-data-protection-unverified'
  | 'stop-and-settlement-unverified'
  | 'identity-unverified'
  | 'grant-not-current'
  | 'scope-not-approved'
  | 'command-not-reviewed'
  | 'high-risk-approval-required'
  | 'sensitive-or-outside-approval-required'
  | 'network-policy-unverified'
export interface ExecutionReadinessResult {
  assessment: 'blocked' | 'requirements-satisfied'
  blockers: ReadinessBlocker[]
}

/**
 * Even requirements-satisfied means only that assertions are internally
 * consistent; an independent enforcement layer must still deny unauthorized
 * launches and verify its guarantees at the effect boundary. A test script,
 * shell, executable, or allowed command can run arbitrary child processes.
 */
export function assessExecutionReadiness(value: unknown): ExecutionReadinessResult {
  const invalid: ExecutionReadinessResult = { assessment: 'blocked', blockers: ['invalid-input'] }
  let v: ExecutionReadinessInput
  try {
    if (!value || typeof value !== 'object') return invalid
    // structuredClone prevents getters from being re-evaluated inconsistently.
    v = structuredClone(value) as ExecutionReadinessInput
  } catch {
    return invalid
  }
  const booleans: ReadonlyArray<keyof ExecutionReadinessInput> = [
    'platformSupported',
    'isolationVerified',
    'processTreeContainmentVerified',
    'writeBoundaryVerified',
    'protectedReadBoundaryVerified',
    'egressDataProtectionVerified',
    'cooperativeStopAndSettlementVerified',
    'scopeIdentityVerified',
    'sessionGrantCurrent',
    'projectScopeApproved',
    'commandReviewed',
    'highRiskUserApproval',
    'touchesSensitiveOrOutsideScope',
    'sensitiveOrOutsideScopeUserApproval',
    'networkPolicyVerified'
  ]
  if (
    booleans.some((key) => typeof v[key] !== 'boolean') ||
    !['ordinary', 'high', 'unknown'].includes(v.risk) ||
    !['allowed', 'denied'].includes(v.networkMode)
  )
    return invalid
  const blockers: ReadinessBlocker[] = []
  if (!v.platformSupported) blockers.push('unsupported-platform')
  if (!v.isolationVerified) blockers.push('isolation-unverified')
  if (!v.processTreeContainmentVerified) blockers.push('process-containment-unverified')
  if (!v.writeBoundaryVerified) blockers.push('write-boundary-unverified')
  if (!v.protectedReadBoundaryVerified) blockers.push('protected-read-boundary-unverified')
  if (v.networkMode === 'allowed' && !v.egressDataProtectionVerified)
    blockers.push('egress-data-protection-unverified')
  if (!v.cooperativeStopAndSettlementVerified) blockers.push('stop-and-settlement-unverified')
  if (!v.scopeIdentityVerified) blockers.push('identity-unverified')
  if (!v.sessionGrantCurrent) blockers.push('grant-not-current')
  if (!v.projectScopeApproved) blockers.push('scope-not-approved')
  if (!v.commandReviewed) blockers.push('command-not-reviewed')
  if (v.risk !== 'ordinary' && !v.highRiskUserApproval) blockers.push('high-risk-approval-required')
  if (v.touchesSensitiveOrOutsideScope && !v.sensitiveOrOutsideScopeUserApproval)
    blockers.push('sensitive-or-outside-approval-required')
  if (!v.networkPolicyVerified) blockers.push('network-policy-unverified')
  return { assessment: blockers.length ? 'blocked' : 'requirements-satisfied', blockers }
}
