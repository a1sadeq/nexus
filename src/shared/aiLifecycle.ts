import { formatNotificationContent } from './notificationContent'
/**
 * Authoritative AI lifecycle states for tabs in Nexus.
 *
 * Discard policy rules:
 * - 'unknown': Initial unverified state or uninstrumented provider; protected from discard.
 * - 'idle': Verified quiescent state with no active generation, input prompt, or error.
 *           Eligible for discard subject to background idle timeout and capacity limits.
 * - 'working': Active generation/orchestration in progress; protected from discard.
 * - 'waiting-input': Prompt/interaction requires user attention; protected from discard.
 * - 'done': Turn recently completed; protected during visible confirmation linger
 *           (6s for active tab; background completions remain 'done' until visited + 4s).
 * - 'error': Failed or aborted generation; protected until cleared/resolved.
 */
export type AiLifecycleStatus = 'unknown' | 'idle' | 'working' | 'waiting-input' | 'done' | 'error'

export interface TabAiLifecycleState {
  tabId: string
  status: AiLifecycleStatus
  revision: number
  viewGeneration: number
  lastSnippet?: string
  error?: string
  updatedAt: number
  enteredIdleAt?: number
  isBackgroundCompletion?: boolean
}

export interface AiLifecycleStatusUpdate {
  tabId: string
  status: AiLifecycleStatus
  revision: number
  viewGeneration: number
  lastSnippet?: string
  error?: string
  timestamp: number
}

export interface AiObserverReport {
  isGenerating: boolean
  lastSnippet?: string
  status?: AiLifecycleStatus
  error?: string
  hasReliableHooks?: boolean
  initial?: boolean
  viewGeneration?: number
}

export const ACTIVE_TAB_DONE_LINGER_MS = 6000
export const VISITED_DONE_LINGER_MS = 4000

/**
 * Returns true if the lifecycle status requires tab retention / protection from eviction.
 * Only 'idle' is eligible for discard; unknown, working, waiting-input, done, and error
 * are strictly protected.
 */
export function isProtectedLifecycleStatus(status: AiLifecycleStatus | undefined | null): boolean {
  return status !== 'idle'
}

/**
 * Maps AiLifecycleStatus to renderer badge display representation.
 */
export function mapLifecycleToBadge(status: AiLifecycleStatus | undefined): {
  badge: 'working' | 'waiting-input' | 'done' | 'error' | null
  label: string
} {
  switch (status) {
    case 'working':
      return { badge: 'working', label: 'Working' }
    case 'waiting-input':
      return { badge: 'waiting-input', label: 'Waiting for input' }
    case 'done':
      return { badge: 'done', label: 'Done' }
    case 'error':
      return { badge: 'error', label: 'Error' }
    case 'unknown':
    case 'idle':
    default:
      return { badge: null, label: 'Idle' }
  }
}

/**
 * Distinguishes genuine model generation completions from unverified initial/setup transitions.
 * Only transitions where previous status was 'working' and next status is 'done' or 'waiting-input'
 * represent authentic task completions.
 */
export function isGenuineCompletionTransition(
  prevStatus: AiLifecycleStatus,
  nextStatus: AiLifecycleStatus
): nextStatus is 'done' | 'waiting-input' {
  return prevStatus === 'working' && (nextStatus === 'done' || nextStatus === 'waiting-input')
}

/**
 * Whether a transition should be announced.
 *
 * Deliberately looser than `isGenuineCompletionTransition`, which requires the previous status
 * to be exactly `working`. That requirement loses real completions: a fast turn, or one seen
 * between polls, arrives as `unknown -> done`, and the user is never told. Announcing it is not
 * a risk — the callers still deduplicate — whereas staying silent is the bug being fixed.
 *
 * Still excluded: no actual change, and leaving `idle` (a restore, not a completion).
 */
export function isNotifiableCompletion(
  prevStatus: AiLifecycleStatus,
  nextStatus: AiLifecycleStatus
): nextStatus is 'done' | 'waiting-input' {
  if (nextStatus !== 'done' && nextStatus !== 'waiting-input') return false
  if (prevStatus === nextStatus) return false
  if (prevStatus === 'idle') return false
  return true
}

/**
 * Prevents redundant notification popups when rapid duplicate completions fire.
 */
export function shouldDeduplicateCompletion(
  prev: { status: string; revision: number; time: number } | undefined,
  status: 'done' | 'waiting-input',
  revision: number,
  now: number,
  dedupWindowMs = 2000
): boolean {
  if (!prev) return false
  if (prev.revision === revision && prev.status === status) return true
  if (now - prev.time < dedupWindowMs && prev.status === status) return true
  return false
}

/**
 * The old generic formatter.
 *
 * Deprecated rather than deleted: it is the contract a review test pins, and it is genuinely
 * useful as "no detail at all". It now delegates, so there is one implementation of the wording
 * instead of two that can drift apart.
 */
export function formatDesktopNotificationContent(data: {
  tabTitle: string
  status: 'done' | 'waiting-input'
  snippet?: string
}): { title: string; body: string } {
  const content = formatNotificationContent(
    { tabTitle: data.tabTitle, status: data.status, snippet: data.snippet },
    { detail: 'generic' }
  )
  return { title: content.title, body: content.body }
}
