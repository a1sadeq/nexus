import { describe, it, expect } from 'vitest'
import { createNotificationRecorder } from './notificationDiagnostics'
import {
  applyNotificationPreferenceChange,
  DEFAULT_NOTIFICATION_PREFERENCES,
  loadNotificationPreferences,
  saveNotificationPreferences,
  sanitiseNotificationPreferences
} from './notificationPreferences'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('notification recorder', () => {
  it('counts outcomes and keeps the most recent attempts', () => {
    const recorder = createNotificationRecorder({ limit: 3, now: () => 1000 })
    recorder.record({ tabId: 'a', status: 'done', detail: 'standard', outcome: 'shown' })
    recorder.record({ tabId: 'b', status: 'done', detail: 'standard', outcome: 'active-tab' })
    recorder.record({ tabId: 'c', status: 'done', detail: 'standard', outcome: 'throttled' })
    recorder.record({ tabId: 'd', status: 'done', detail: 'standard', outcome: 'shown' })
    const snapshot = recorder.snapshot()
    expect(snapshot.attempts.map((entry) => entry.tabId)).toEqual(['b', 'c', 'd'])
    expect(snapshot.totals.shown).toBe(2)
    expect(snapshot.totals.throttled).toBe(1)
  })

  it('explains a silent system in one line, before listing counts', () => {
    const recorder = createNotificationRecorder()
    recorder.setEnvironment({ nativeSupported: false, platform: 'linux' })
    const summary = recorder.summary()
    expect(summary[0]).toContain('no notification daemon')
  })

  it('says so plainly when nothing has been attempted', () => {
    const recorder = createNotificationRecorder()
    recorder.setEnvironment({ nativeSupported: true, platform: 'linux' })
    expect(recorder.summary()[0]).toContain('No notification has been attempted')
  })

  it('records an OS-level failure and surfaces it', () => {
    const recorder = createNotificationRecorder()
    recorder.setEnvironment({ nativeSupported: true, platform: 'linux' })
    recorder.setFailure('org.freedesktop.Notifications was not provided')
    recorder.record({ tabId: 'a', status: 'done', detail: 'standard', outcome: 'failed' })
    const summary = recorder.summary().join('\n')
    expect(summary).toContain('org.freedesktop.Notifications')
    expect(summary).toContain('1 × failed')
  })

  it('never stores a tab title or a snippet, only identifiers and outcomes', () => {
    const recorder = createNotificationRecorder()
    recorder.record({ tabId: 'tab-1', status: 'done', detail: 'full', outcome: 'shown' })
    const serialised = JSON.stringify(recorder.snapshot())
    expect(serialised).not.toContain('snippet')
    expect(Object.keys(recorder.snapshot().attempts[0])).toEqual([
      'at',
      'tabId',
      'status',
      'detail',
      'outcome',
      'reason'
    ])
  })

  it('resets counts without losing the environment', () => {
    const recorder = createNotificationRecorder()
    recorder.setEnvironment({ nativeSupported: true, platform: 'win32' })
    recorder.record({ tabId: 'a', status: 'done', detail: 'standard', outcome: 'shown' })
    recorder.clear()
    expect(recorder.snapshot().totals.shown).toBe(0)
    expect(recorder.snapshot().environment.platform).toBe('win32')
  })
})

describe('notification preferences', () => {
  let dir = ''

  const file = (): string => {
    dir = mkdtempSync(join(tmpdir(), 'nexus-notif-'))
    return join(dir, 'notifications.json')
  }

  it('defaults to showing the tab title and the model', () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.detail).toBe('standard')
    expect(DEFAULT_NOTIFICATION_PREFERENCES.desktopEnabled).toBe(true)
  })

  it('round-trips through the state file', () => {
    const path = file()
    try {
      const saved = { detail: 'full' as const, desktopEnabled: false }
      expect(saveNotificationPreferences(path, saved)).toBe(true)
      expect(loadNotificationPreferences(path)).toEqual(saved)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to defaults when the file is missing or corrupt', () => {
    const path = file()
    try {
      expect(loadNotificationPreferences(path)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)
      writeFileSync(path, '{ not json', 'utf-8')
      expect(loadNotificationPreferences(path)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('drops an unknown detail level instead of trusting it', () => {
    expect(sanitiseNotificationPreferences({ detail: 'loud' }).detail).toBe('standard')
  })

  it('ignores non-boolean switches', () => {
    const result = sanitiseNotificationPreferences({ desktopEnabled: 'yes please' })
    expect(result.desktopEnabled).toBe(true)
  })

  it('applies a partial change and keeps the rest', () => {
    const next = applyNotificationPreferenceChange(DEFAULT_NOTIFICATION_PREFERENCES, { detail: 'generic' })
    expect(next.detail).toBe('generic')
    expect(next.desktopEnabled).toBe(true)
  })

  it('refuses a change that is not an object', () => {
    expect(applyNotificationPreferenceChange(DEFAULT_NOTIFICATION_PREFERENCES, 'full')).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES
    )
  })
})
