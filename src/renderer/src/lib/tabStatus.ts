export type TabAiStatus = 'idle' | 'working' | 'waiting-input' | 'done'

/**
 * Context-Aware Hybrid Linger Durations (in milliseconds):
 * - Active tab completed: 6000ms visual confirmation before smoothly transitioning to idle.
 * - Background tab switched to: 4000ms acknowledgment window before transitioning to idle.
 */
export const ACTIVE_TAB_LINGER_MS = 6000
export const SWITCH_TAB_LINGER_MS = 4000

/**
 * Determines whether a given tab status represents a completed AI state
 * (either standard completion 'done' or action-required 'waiting-input').
 */
export function isCompletedStatus(status?: TabAiStatus | null): boolean {
  return status === 'done' || status === 'waiting-input'
}

/**
 * Format a tab title for the collapsed vertical sidebar state.
 * Extracts the first 3 to 5 words (default 4) so the tab's topic
 * is immediately readable without requiring sidebar expansion.
 */
export function formatCollapsedTitle(title?: string | null, maxWords: number = 4): string {
  if (!title || !title.trim()) {
    return 'New Chat'
  }
  const words = title.trim().split(/\s+/)
  if (words.length <= maxWords) {
    return title.trim()
  }
  return `${words.slice(0, maxWords).join(' ')}…`
}

/**
 * Detects if a completed AI response ends in a question, choice, or confirmation prompt.
 * Used for smart trigger of 'waiting-input' (amber pulse) vs 'done' (emerald dot).
 */
export function hasQuestionOrChoice(text?: string | null): boolean {
  if (!text || typeof text !== 'string') return false
  const trimmed = text.trim()
  if (!trimmed) return false

  // Strip trailing markdown symbols, quotes, asterisks, brackets
  const cleanedEnd = trimmed.replace(/[\s*_"`')\]}]+$/g, '')

  // 1. Check for question mark at or near the end (English ?, Chinese ？, Arabic ؟)
  if (/[?？؟]/.test(cleanedEnd.slice(-15))) {
    return true
  }

  const lower = trimmed.toLowerCase()

  // 2. Question / choice inquiry phrases near the end of response (last 200 chars)
  const tail = lower.slice(-200)
  const choicePhrases = [
    'which one',
    'which option',
    'would you like',
    'do you want me to',
    'should i proceed',
    'let me know',
    'please confirm',
    'please choose',
    'select an option',
    'what do you think',
    'how would you like',
    'choice 1',
    'option 1',
    'option a',
    'yes or no',
    'yes/no'
  ]

  for (const phrase of choicePhrases) {
    if (tail.includes(phrase)) {
      return true
    }
  }

  // 3. Numbered choice list at the end (e.g., "1. ... 2. ...")
  if (/(?:^|\n)\s*1[.)]\s+.+[\r\n]+\s*2[.)]\s+/i.test(tail)) {
    return true
  }

  return false
}

/**
 * Update tab AI status when loading starts or stops.
 * Follows Herdr's paradigm with Smart Question/Choice Detection (A2):
 * - If a background tab stops generating and asks a question/choice -> 'waiting-input' (amber)
 * - If a background tab stops generating with a regular answer -> 'done' (emerald)
 * - If the active tab stops generating -> 'done' (emerald)
 */
export function updateTabLoadingStatus(
  currentStatuses: Record<string, TabAiStatus>,
  tabId: string,
  loading: boolean,
  isActive: boolean,
  lastSnippet?: string
): Record<string, TabAiStatus> {
  const next = { ...currentStatuses }
  if (loading) {
    next[tabId] = 'working'
  } else {
    if (!isActive) {
      const needsInput = hasQuestionOrChoice(lastSnippet)
      next[tabId] = needsInput ? 'waiting-input' : 'done'
    } else {
      next[tabId] = 'done'
    }
  }
  return next
}

/**
 * Acknowledge / dismiss the status state when the user selects or focuses a tab.
 */
export function acknowledgeTabStatus(
  currentStatuses: Record<string, TabAiStatus>,
  tabId: string
): Record<string, TabAiStatus> {
  if (currentStatuses[tabId] === 'waiting-input' || currentStatuses[tabId] === 'done') {
    return {
      ...currentStatuses,
      [tabId]: 'idle'
    }
  }
  return currentStatuses
}
