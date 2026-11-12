import { describe, it, expect } from 'vitest'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { reloadProviderViews } from './providerViewReloader'
import type { WebContentsView } from 'electron'

// Minimal mock of Electron's WebContentsView for testing
function makeMockView(reloadFn: () => void): WebContentsView {
  return {
    webContents: {
      isDestroyed: () => false,
      reload: reloadFn
    } as any
  } as unknown as WebContentsView
}

describe('reloadProviderViews', () => {
  it('[T18] Google import reloads Gemini views only', () => {
    const reloads: string[] = []
    const aiViews = new Map<string, WebContentsView>([
      ['tab-1', makeMockView(() => reloads.push('gemini'))],
      ['tab-2', makeMockView(() => reloads.push('chatgpt'))],
      ['tab-3', makeMockView(() => reloads.push('claude'))]
    ])
    const viewModelKeys = new Map<string, string>([
      ['tab-1', 'gemini'],
      ['tab-2', 'chatgpt'],
      ['tab-3', 'claude']
    ])

    reloadProviderViews(aiViews, viewModelKeys, ['google'])

    // Only gemini view should be reloaded (google normalized to gemini)
    expect(reloads).toEqual(['gemini'])
    expect(reloads).not.toContain('chatgpt')
    expect(reloads).not.toContain('claude')
  })

  it('[T19] ChatGPT import does not reload Gemini views', () => {
    const reloads: string[] = []
    const aiViews = new Map<string, WebContentsView>([
      ['tab-1', makeMockView(() => reloads.push('gemini'))],
      ['tab-2', makeMockView(() => reloads.push('chatgpt'))],
      ['tab-3', makeMockView(() => reloads.push('claude'))]
    ])
    const viewModelKeys = new Map<string, string>([
      ['tab-1', 'gemini'],
      ['tab-2', 'chatgpt'],
      ['tab-3', 'claude']
    ])

    reloadProviderViews(aiViews, viewModelKeys, ['chatgpt'])

    expect(reloads).toEqual(['chatgpt'])
    expect(reloads).not.toContain('gemini')
    expect(reloads).not.toContain('claude')
  })

  it('removes destroyed views from collections', () => {
    const reloads: string[] = []
    const aiViews = new Map<string, WebContentsView>([
      ['tab-1', makeMockView(() => reloads.push('gemini'))],
      ['tab-2', {
        webContents: {
          isDestroyed: () => true,
          reload: () => {}
        }
      } as any]
    ])
    const viewModelKeys = new Map<string, string>([
      ['tab-1', 'gemini'],
      ['tab-2', 'gemini']
    ])

    reloadProviderViews(aiViews, viewModelKeys, ['gemini'])

    // Destroyed view should be removed
    expect(aiViews.has('tab-2')).toBe(false)
    expect(viewModelKeys.has('tab-2')).toBe(false)
    // Live view should still be reloaded
    expect(reloads).toContain('gemini')
  })

  it('normalizes google to gemini for view matching', () => {
    const reloads: string[] = []
    const aiViews = new Map<string, WebContentsView>([
      ['tab-1', makeMockView(() => reloads.push('gemini'))]
    ])
    const viewModelKeys = new Map<string, string>([
      ['tab-1', 'gemini']
    ])

    // Pass 'google' — should match 'gemini' key in viewModelKeys
    reloadProviderViews(aiViews, viewModelKeys, ['google'])
    expect(reloads).toEqual(['gemini'])
  })

  it('handles empty providers gracefully', () => {
    const reloads: string[] = []
    const aiViews = new Map<string, WebContentsView>([
      ['tab-1', makeMockView(() => reloads.push('gemini'))]
    ])
    const viewModelKeys = new Map<string, string>([
      ['tab-1', 'gemini']
    ])

    reloadProviderViews(aiViews, viewModelKeys, [])
    expect(reloads).toHaveLength(0)
  })

  it('handles undefined keys gracefully', () => {
    const reloads: string[] = []
    const aiViews = new Map<string, WebContentsView>([
      ['tab-1', makeMockView(() => reloads.push('gemini'))]
    ])
    const viewModelKeys = new Map<string, string>() // No keys set

    reloadProviderViews(aiViews, viewModelKeys, ['gemini'])
    // Should not crash; no views match because no keys are set
    expect(reloads).toHaveLength(0)
  })
})
