/**
 * Pure interpretation of a limited, read-only Arena observation. This module
 * does not query a page, dispatch messages, correlate responses, authorize actions
 * or prove provider acceptance. Observations must come from a trusted adapter.
 */
export interface ElementObservation {
  count: number
  visible: number
  enabled: number
}

export interface ArenaObservation {
  composer: ElementObservation
  send: ElementObservation
  stop: ElementObservation
}

export type ArenaObservedState = 'send-disabled' | 'ready-to-send' | 'generating' | 'unknown'

function valid(value: unknown): value is ElementObservation {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  const { count, visible, enabled } = item
  return (
    typeof count === 'number' &&
    Number.isSafeInteger(count) &&
    count >= 0 &&
    typeof visible === 'number' &&
    Number.isSafeInteger(visible) &&
    visible >= 0 &&
    visible <= count &&
    typeof enabled === 'number' &&
    Number.isSafeInteger(enabled) &&
    enabled >= 0 &&
    enabled <= count
  )
}

function absent(item: ElementObservation): boolean {
  return item.count === 0 && item.visible === 0 && item.enabled === 0
}

/**
 * 'send-disabled' is a control-state label, not a completed-answer or empty-input
 * guarantee. 'ready-to-send' is not permission to send. Never use this alone to
 * target a conversation, correlate a response, approve changes or infer success.
 */
export function classifyArenaObservedState(value: unknown): ArenaObservedState {
  if (!value || typeof value !== 'object') return 'unknown'
  const input = value as Record<string, unknown>
  const { composer, send, stop } = input
  if (!valid(composer) || !valid(send) || !valid(stop)) return 'unknown'

  // Exact single-element matches avoid deriving a visible+enabled intersection
  // from counts that could refer to different elements.
  if (composer.count !== 1 || composer.visible !== 1 || composer.enabled !== 1) return 'unknown'
  if (absent(send) && stop.count === 1 && stop.visible === 1 && stop.enabled === 1)
    return 'generating'
  if (absent(stop) && send.count === 1 && send.visible === 1 && send.enabled === 1)
    return 'ready-to-send'
  if (absent(stop) && send.count === 1 && send.visible === 1 && send.enabled === 0)
    return 'send-disabled'
  return 'unknown'
}
