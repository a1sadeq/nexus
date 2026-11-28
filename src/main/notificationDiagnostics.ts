/**
 * Why did (or didn't) a notification appear?
 *
 * "Notifications aren't working" has about six different causes and only one of them is a bug
 * in this code: the OS may have no notification daemon, the user may have muted the app, the
 * window may be focused on that very tab, or two completions may have collapsed into one. From
 * outside, all six look identical — nothing pops up.
 *
 * So every attempt is recorded with its outcome and the reason, and the last few can be read
 * back. That turns a guess into an answer, and it is the first thing to look at when a
 * notification does not appear.
 */

export type NotificationOutcome =
  | 'shown'
  | 'unsupported'
  | 'disabled'
  | 'duplicate'
  | 'throttled'
  | 'active-tab'
  /** The window was in front: the in-app card is the notification, the OS was deliberately skipped. */
  | 'in-app'
  | 'failed'

export interface NotificationAttempt {
  at: number
  tabId: string
  status: 'done' | 'waiting-input'
  detail: string
  outcome: NotificationOutcome
  /** Short human phrase, safe to show: never a title, a prompt or a token. */
  reason: string
}

export interface NotificationDiagnostics {
  attempts: NotificationAttempt[]
  totals: Record<NotificationOutcome, number>
  /** Environment facts that decide whether the OS can show anything at all. */
  environment: { nativeSupported: boolean; platform: string; lastFailure?: string }
}

const EMPTY_TOTALS: Record<NotificationOutcome, number> = {
  shown: 0,
  unsupported: 0,
  disabled: 0,
  duplicate: 0,
  throttled: 0,
  'active-tab': 0,
  'in-app': 0,
  failed: 0
}

export interface RecorderOptions {
  limit?: number
  now?: () => number
}

export interface NotificationRecorder {
  record(attempt: Omit<NotificationAttempt, 'at' | 'reason'> & { reason?: string }): NotificationAttempt
  setEnvironment(environment: { nativeSupported: boolean; platform: string }): void
  setFailure(message: string): void
  snapshot(): NotificationDiagnostics
  clear(): void
  /** One line per outcome, in the order they matter when diagnosing. */
  summary(): string[]
}

const DEFAULT_LIMIT = 25

export function createNotificationRecorder(options: RecorderOptions = {}): NotificationRecorder {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT)
  const now = options.now ?? ((): number => Date.now())
  let attempts: NotificationAttempt[] = []
  let totals: Record<NotificationOutcome, number> = { ...EMPTY_TOTALS }
  let environment: NotificationDiagnostics['environment'] = {
    nativeSupported: false,
    platform: 'unknown'
  }

  return {
    record(attempt): NotificationAttempt {
      const entry: NotificationAttempt = {
        at: now(),
        tabId: attempt.tabId,
        status: attempt.status,
        detail: attempt.detail,
        outcome: attempt.outcome,
        reason: attempt.reason ?? defaultReason(attempt.outcome)
      }
      attempts = [...attempts.slice(-(limit - 1)), entry]
      totals[entry.outcome] += 1
      return entry
    },

    setEnvironment(next): void {
      environment = { ...environment, ...next }
    },

    setFailure(message): void {
      environment = { ...environment, lastFailure: message.slice(0, 300) }
    },

    snapshot(): NotificationDiagnostics {
      return { attempts: [...attempts], totals: { ...totals }, environment: { ...environment } }
    },

    clear(): void {
      attempts = []
      totals = { ...EMPTY_TOTALS }
    },

    summary(): string[] {
      const lines: string[] = []
      if (!environment.nativeSupported) {
        lines.push(
          'The OS reports no native notification support here, so nothing can appear as a desktop notification. On Linux this usually means no notification daemon is running.'
        )
      }
      if (environment.lastFailure) {
        lines.push(`The last attempt at the OS level failed: ${environment.lastFailure}`)
      }
      const order: NotificationOutcome[] = [
        'shown',
        'in-app',
        'active-tab',
        'duplicate',
        'throttled',
        'disabled',
        'unsupported',
        'failed'
      ]
      for (const outcome of order) {
        if (totals[outcome] > 0) lines.push(`${totals[outcome]} × ${outcome} — ${defaultReason(outcome)}`)
      }
      if (lines.length === 0) lines.push('No notification has been attempted since the app started.')
      return lines
    }
  }
}

function defaultReason(outcome: NotificationOutcome): string {
  switch (outcome) {
    case 'shown':
      return 'the OS accepted the notification'
    case 'unsupported':
      return 'the OS cannot show notifications'
    case 'disabled':
      return 'desktop notifications are switched off in preferences'
    case 'duplicate':
      return 'the same completion had already been announced'
    case 'throttled':
      return 'another notification for this tab fired less than two seconds earlier'
    case 'in-app':
      return 'the window was in front, so the in-app card was the notification'
    case 'active-tab':
      return 'that tab was already in front of you'
    case 'failed':
      return 'the notification was rejected by the OS'
    default:
      return 'unknown'
  }
}
