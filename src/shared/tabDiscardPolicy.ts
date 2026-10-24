export interface TabDiscardPolicy {
  version: 1
  tabDiscardMinutes: number // 0 (Never), 5, 10, 30, 60
  maxActiveTabs: number // 0 (Unlimited), 1, 3, 5, 10
}

export interface TabDiscardStatus {
  residentCount: number
  discardedCount: number
  pendingCount: number
  protectedCount: number
  effectiveCapExceeded: boolean
  exceededReason?: string
  lastEviction: {
    tabId: string
    reason: 'idle-timeout' | 'capacity'
    timestamp: number
  } | null
  policy: TabDiscardPolicy
  revision: number
}

export const DEFAULT_TAB_DISCARD_POLICY: TabDiscardPolicy = {
  version: 1,
  tabDiscardMinutes: 10,
  maxActiveTabs: 0
}

export const VALID_DISCARD_MINUTES = [0, 5, 10, 30, 60] as const
export const VALID_MAX_ACTIVE_TABS = [0, 1, 3, 5, 10] as const

export function validateTabDiscardPolicy(input: unknown): { policy: TabDiscardPolicy; valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { policy: { ...DEFAULT_TAB_DISCARD_POLICY }, valid: false, errors: ['Expected an object'] }
  }

  const raw = input as Record<string, unknown>
  let minutes = DEFAULT_TAB_DISCARD_POLICY.tabDiscardMinutes
  let maxTabs = DEFAULT_TAB_DISCARD_POLICY.maxActiveTabs

  if (raw.tabDiscardMinutes !== undefined) {
    if (typeof raw.tabDiscardMinutes === 'number' && Number.isInteger(raw.tabDiscardMinutes) && raw.tabDiscardMinutes >= 0) {
      minutes = raw.tabDiscardMinutes
    } else {
      errors.push('tabDiscardMinutes must be a non-negative integer')
    }
  }

  if (raw.maxActiveTabs !== undefined) {
    if (typeof raw.maxActiveTabs === 'number' && Number.isInteger(raw.maxActiveTabs) && raw.maxActiveTabs >= 0) {
      maxTabs = raw.maxActiveTabs
    } else {
      errors.push('maxActiveTabs must be a non-negative integer')
    }
  }

  return {
    policy: {
      version: 1,
      tabDiscardMinutes: minutes,
      maxActiveTabs: maxTabs
    },
    valid: errors.length === 0,
    errors
  }
}

export function validatePartialTabDiscardPolicy(
  partial: unknown
): { updates: Partial<Pick<TabDiscardPolicy, 'tabDiscardMinutes' | 'maxActiveTabs'>>; valid: boolean; error?: string } {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    return { updates: {}, valid: false, error: 'Policy update must be an object' }
  }

  const raw = partial as Record<string, unknown>
  const updates: Partial<Pick<TabDiscardPolicy, 'tabDiscardMinutes' | 'maxActiveTabs'>> = {}

  if ('tabDiscardMinutes' in raw) {
    const val = raw.tabDiscardMinutes
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
      return { updates: {}, valid: false, error: 'tabDiscardMinutes must be a non-negative integer' }
    }
    updates.tabDiscardMinutes = val
  }

  if ('maxActiveTabs' in raw) {
    const val = raw.maxActiveTabs
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
      return { updates: {}, valid: false, error: 'maxActiveTabs must be a non-negative integer' }
    }
    updates.maxActiveTabs = val
  }

  if (Object.keys(updates).length === 0) {
    return { updates: {}, valid: false, error: 'No recognizable policy fields to update' }
  }

  return { updates, valid: true }
}
