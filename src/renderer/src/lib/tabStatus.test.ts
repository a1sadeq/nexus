import { describe, it, expect } from 'vitest'
import {
  formatCollapsedTitle,
  hasQuestionOrChoice,
  updateTabLoadingStatus,
  acknowledgeTabStatus,
  type TabAiStatus
} from './tabStatus'

describe('tabStatus', () => {
  describe('formatCollapsedTitle', () => {
    it('returns "New Chat" when title is undefined, null, or empty', () => {
      expect(formatCollapsedTitle(undefined)).toBe('New Chat')
      expect(formatCollapsedTitle(null)).toBe('New Chat')
      expect(formatCollapsedTitle('')).toBe('New Chat')
      expect(formatCollapsedTitle('   ')).toBe('New Chat')
    })

    it('returns full title when words are within maxWords', () => {
      expect(formatCollapsedTitle('Refactor UI', 4)).toBe('Refactor UI')
      expect(formatCollapsedTitle('Deep research plan ready', 4)).toBe('Deep research plan ready')
    })

    it('truncates to first 4 words and appends ellipsis when longer', () => {
      const longTitle = 'Create a comprehensive test suite for the vertical tabs component in electron'
      expect(formatCollapsedTitle(longTitle, 4)).toBe('Create a comprehensive test…')
      expect(formatCollapsedTitle(longTitle, 3)).toBe('Create a comprehensive…')
      expect(formatCollapsedTitle(longTitle, 5)).toBe('Create a comprehensive test suite…')
    })
  })

  describe('hasQuestionOrChoice', () => {
    it('detects standard English question marks', () => {
      expect(hasQuestionOrChoice('Which option do you prefer?')).toBe(true)
      expect(hasQuestionOrChoice('Would you like me to continue?**')).toBe(true)
      expect(hasQuestionOrChoice('Are you ready to deploy? "')).toBe(true)
    })

    it('detects international question marks (Chinese, Arabic)', () => {
      expect(hasQuestionOrChoice('准备好继续了吗？')).toBe(true)
      expect(hasQuestionOrChoice('هل تريد المتابعة؟')).toBe(true)
    })

    it('detects choice and confirmation phrases', () => {
      expect(hasQuestionOrChoice('Here are the results. Please confirm if this is acceptable.')).toBe(true)
      expect(hasQuestionOrChoice('Please choose between option A and option B.')).toBe(true)
      expect(hasQuestionOrChoice('Let me know what you think.')).toBe(true)
    })

    it('returns false for regular completed answers without questions or choices', () => {
      expect(hasQuestionOrChoice('The script has finished executing successfully.')).toBe(false)
      expect(hasQuestionOrChoice('Here is your summary of the codebase architecture.')).toBe(false)
      expect(hasQuestionOrChoice(null)).toBe(false)
      expect(hasQuestionOrChoice('')).toBe(false)
    })
  })

  describe('updateTabLoadingStatus (Smart Question / Choice Detection)', () => {
    it('sets status to working when loading starts', () => {
      const initial: Record<string, TabAiStatus> = {}
      const updated = updateTabLoadingStatus(initial, 'tab-1', true, true)
      expect(updated['tab-1']).toBe('working')
    })

    it('sets background tab to waiting-input when question/choice is detected', () => {
      const initial: Record<string, TabAiStatus> = { 'tab-bg': 'working' }
      const updated = updateTabLoadingStatus(
        initial,
        'tab-bg',
        false,
        false,
        'Would you like me to proceed with Option 1 or 2?'
      )
      expect(updated['tab-bg']).toBe('waiting-input')
    })

    it('sets background tab to done when normal completion without question/choice', () => {
      const initial: Record<string, TabAiStatus> = { 'tab-bg': 'working' }
      const updated = updateTabLoadingStatus(
        initial,
        'tab-bg',
        false,
        false,
        'Task finished successfully.'
      )
      expect(updated['tab-bg']).toBe('done')
    })

    it('sets active tab to done when loading stops', () => {
      const initial: Record<string, TabAiStatus> = { 'tab-active': 'working' }
      const updated = updateTabLoadingStatus(initial, 'tab-active', false, true)
      expect(updated['tab-active']).toBe('done')
    })
  })

  describe('acknowledgeTabStatus', () => {
    it('clears waiting-input or done to idle when user focuses or selects the tab', () => {
      const current: Record<string, TabAiStatus> = {
        'tab-1': 'waiting-input',
        'tab-2': 'done',
        'tab-3': 'working'
      }
      const next1 = acknowledgeTabStatus(current, 'tab-1')
      expect(next1['tab-1']).toBe('idle')
      expect(next1['tab-2']).toBe('done')

      const next2 = acknowledgeTabStatus(next1, 'tab-2')
      expect(next2['tab-2']).toBe('idle')
      expect(next2['tab-3']).toBe('working')
    })
  })
})
