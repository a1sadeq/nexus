import { describe, it, expect } from 'vitest'
import { matchesShortcut, getShortcutKeys } from './shortcuts'

interface ModalStates {
  showSettings: boolean
  showHistory: boolean
  showNewTab: boolean
  showUrlBar: boolean
  showZenGuide: boolean
  showSkillsPalette: boolean
  showBaseSkillsModal: boolean
  showSkillParamsModal: boolean
  showSkillEditorModal: boolean
}

type ShortcutAction =
  | 'none'
  | 'escape-close-all'
  | 'close-settings'
  | 'close-skills-palette'
  | 'close-base-skills'
  | 'close-new-tab'
  | 'close-url-bar'
  | 'close-guide'
  | 'close-history'
  | 'open-settings'
  | 'open-skills-palette'
  | 'open-base-skills'
  | 'open-new-tab'
  | 'open-url-bar'
  | 'open-guide'
  | 'open-history'

function evaluateShortcut(e: KeyboardEvent, modals: ModalStates, isReactInput: boolean): ShortcutAction {
  const isCtrl = e.ctrlKey || e.metaKey
  const overlaysOpen =
    modals.showHistory ||
    modals.showSettings ||
    modals.showNewTab ||
    modals.showUrlBar ||
    modals.showZenGuide ||
    modals.showSkillsPalette ||
    modals.showBaseSkillsModal ||
    modals.showSkillParamsModal ||
    modals.showSkillEditorModal

  if (overlaysOpen) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      return 'escape-close-all'
    }
    if (modals.showSettings && matchesShortcut(e, getShortcutKeys('settings-open'))) {
      return 'close-settings'
    }
    if (modals.showSkillsPalette && matchesShortcut(e, getShortcutKeys('skills-palette'))) {
      return 'close-skills-palette'
    }
    if (modals.showBaseSkillsModal && matchesShortcut(e, getShortcutKeys('skills-base-modal'))) {
      return 'close-base-skills'
    }
    if (modals.showNewTab && matchesShortcut(e, getShortcutKeys('tab-new'))) {
      return 'close-new-tab'
    }
    if (
      modals.showUrlBar &&
      (matchesShortcut(e, getShortcutKeys('url-bar')) ||
        (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'd'))
    ) {
      return 'close-url-bar'
    }
    if (
      modals.showZenGuide &&
      (matchesShortcut(e, getShortcutKeys('guide-open')) ||
        e.key === 'F1' ||
        (isCtrl && (e.key === '?' || e.key === '/')))
    ) {
      return 'close-guide'
    }
    if (modals.showHistory && matchesShortcut(e, getShortcutKeys('history-open'))) {
      return 'close-history'
    }
    // Block any other global modal shortcuts
    return 'none'
  }

  if (isReactInput) {
    return 'none'
  }

  if (matchesShortcut(e, getShortcutKeys('settings-open'))) {
    return 'open-settings'
  }
  if (matchesShortcut(e, getShortcutKeys('skills-palette'))) {
    return 'open-skills-palette'
  }
  if (matchesShortcut(e, getShortcutKeys('skills-base-modal'))) {
    return 'open-base-skills'
  }
  if (matchesShortcut(e, getShortcutKeys('tab-new'))) {
    return 'open-new-tab'
  }
  if (
    matchesShortcut(e, getShortcutKeys('url-bar')) ||
    (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'd')
  ) {
    return 'open-url-bar'
  }
  if (
    matchesShortcut(e, getShortcutKeys('guide-open')) ||
    e.key === 'F1' ||
    (isCtrl && (e.key === '?' || e.key === '/'))
  ) {
    return 'open-guide'
  }
  if (matchesShortcut(e, getShortcutKeys('history-open'))) {
    return 'open-history'
  }

  return 'none'
}

function makeEvent(key: string, code: string, ctrl = false, alt = false, shift = false): KeyboardEvent {
  return {
    key,
    code,
    ctrlKey: ctrl,
    metaKey: false,
    altKey: alt,
    shiftKey: shift
  } as unknown as KeyboardEvent
}

const noModals: ModalStates = {
  showSettings: false,
  showHistory: false,
  showNewTab: false,
  showUrlBar: false,
  showZenGuide: false,
  showSkillsPalette: false,
  showBaseSkillsModal: false,
  showSkillParamsModal: false,
  showSkillEditorModal: false
}

describe('Modal Isolation & Dedicated Shortcut Engine', () => {
  it('opens modals when no overlay is open and not typing in react input', () => {
    expect(evaluateShortcut(makeEvent('t', 'KeyT', true), noModals, false)).toBe('open-new-tab')
    expect(evaluateShortcut(makeEvent('l', 'KeyL', true), noModals, false)).toBe('open-url-bar')
    expect(evaluateShortcut(makeEvent('h', 'KeyH', true), noModals, false)).toBe('open-history')
    expect(evaluateShortcut(makeEvent(',', 'Comma', true), noModals, false)).toBe('open-settings')
    expect(evaluateShortcut(makeEvent('s', 'KeyS', true), noModals, false)).toBe('open-skills-palette')
    expect(evaluateShortcut(makeEvent('S', 'KeyS', true, false, true), noModals, false)).toBe('open-base-skills')
    expect(evaluateShortcut(makeEvent('F1', 'F1'), noModals, false)).toBe('open-guide')
  })

  it('strictly blocks other popup shortcuts (Ctrl+L, Ctrl+H, Ctrl+S) when New Tab modal is open', () => {
    const newTabModalActive: ModalStates = { ...noModals, showNewTab: true }

    // Ctrl+L inside New Tab -> MUST be blocked / ignored (returns 'none')
    expect(evaluateShortcut(makeEvent('l', 'KeyL', true), newTabModalActive, false)).toBe('none')

    // Ctrl+H inside New Tab -> MUST be blocked / ignored (returns 'none')
    expect(evaluateShortcut(makeEvent('h', 'KeyH', true), newTabModalActive, false)).toBe('none')

    // Ctrl+S inside New Tab -> MUST be blocked / ignored (returns 'none')
    expect(evaluateShortcut(makeEvent('s', 'KeyS', true), newTabModalActive, false)).toBe('none')

    // Ctrl+, inside New Tab -> MUST be blocked / ignored (returns 'none')
    expect(evaluateShortcut(makeEvent(',', 'Comma', true), newTabModalActive, false)).toBe('none')

    // Ctrl+T inside New Tab -> Dedicated toggle to close
    expect(evaluateShortcut(makeEvent('t', 'KeyT', true), newTabModalActive, false)).toBe('close-new-tab')

    // Escape inside New Tab -> Close all
    expect(evaluateShortcut(makeEvent('Escape', 'Escape'), newTabModalActive, false)).toBe('escape-close-all')
  })

  it('strictly isolates URL bar modal and History modal', () => {
    const urlBarActive: ModalStates = { ...noModals, showUrlBar: true }
    expect(evaluateShortcut(makeEvent('t', 'KeyT', true), urlBarActive, false)).toBe('none')
    expect(evaluateShortcut(makeEvent('h', 'KeyH', true), urlBarActive, false)).toBe('none')
    expect(evaluateShortcut(makeEvent('l', 'KeyL', true), urlBarActive, false)).toBe('close-url-bar')

    const historyActive: ModalStates = { ...noModals, showHistory: true }
    expect(evaluateShortcut(makeEvent('t', 'KeyT', true), historyActive, false)).toBe('none')
    expect(evaluateShortcut(makeEvent('l', 'KeyL', true), historyActive, false)).toBe('none')
    expect(evaluateShortcut(makeEvent('h', 'KeyH', true), historyActive, false)).toBe('close-history')
  })

  it('protects React DOM inputs from accidental shortcut triggers when no modal is open', () => {
    expect(evaluateShortcut(makeEvent('t', 'KeyT', true), noModals, true)).toBe('none')
    expect(evaluateShortcut(makeEvent('l', 'KeyL', true), noModals, true)).toBe('none')
    expect(evaluateShortcut(makeEvent('h', 'KeyH', true), noModals, true)).toBe('none')
    expect(evaluateShortcut(makeEvent('s', 'KeyS', true), noModals, true)).toBe('none')
  })
})
