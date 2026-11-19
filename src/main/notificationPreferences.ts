import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  DEFAULT_NOTIFICATION_DETAIL,
  isNotificationDetail,
  type NotificationDetail
} from '../shared/notificationContent'

/**
 * Notification preferences, stored next to the app's other state.
 *
 * Read tolerantly and written atomically enough for the purpose: a corrupt or partial file
 * must never stop the app from notifying, it just falls back to the defaults. Anything in the
 * file that is not understood is dropped rather than carried around.
 */

export interface NotificationPreferences {
  detail: NotificationDetail
  /** Master switch. Off means no desktop notification at all, not a quieter one. */
  desktopEnabled: boolean
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  detail: DEFAULT_NOTIFICATION_DETAIL,
  desktopEnabled: true
}

export function sanitiseNotificationPreferences(raw: unknown): NotificationPreferences {
  const defaults = DEFAULT_NOTIFICATION_PREFERENCES
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...defaults }
  const input = raw as Record<string, unknown>
  return {
    detail: isNotificationDetail(input.detail) ? input.detail : defaults.detail,
    desktopEnabled: typeof input.desktopEnabled === 'boolean' ? input.desktopEnabled : defaults.desktopEnabled
  }
}

/** Never throws: a missing or damaged file means "defaults". */
export function loadNotificationPreferences(file: string): NotificationPreferences {
  try {
    return sanitiseNotificationPreferences(JSON.parse(readFileSync(file, 'utf-8')))
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  }
}

/** Returns whether the write succeeded; the app keeps running with the in-memory value either way. */
export function saveNotificationPreferences(file: string, preferences: NotificationPreferences): boolean {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(sanitiseNotificationPreferences(preferences), null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    })
    return true
  } catch {
    return false
  }
}

/** Applies a partial update without letting an unknown detail name through. */
export function applyNotificationPreferenceChange(
  current: NotificationPreferences,
  change: unknown
): NotificationPreferences {
  if (typeof change !== 'object' || change === null || Array.isArray(change)) return current
  const input = change as Record<string, unknown>
  return sanitiseNotificationPreferences({ ...current, ...input })
}
