import { describe, it, expect, vi } from 'vitest'
import { getAiStatusObserverScript, attachAiStatusListener } from './aiStatusObserver'
import { EventEmitter } from 'events'

describe('aiStatusObserver', () => {
  it('generates observer script with provider-specific stop selector', () => {
    const geminiScript = getAiStatusObserverScript('gemini')
    expect(geminiScript).toContain('stop-button')
    expect(geminiScript).toContain('__NEXUS_AI_STATUS__')

    const chatgptScript = getAiStatusObserverScript('chatgpt')
    expect(chatgptScript).toContain('Stop generating')

    const claudeScript = getAiStatusObserverScript('claude')
    expect(claudeScript).toContain('Stop Response')

    const glmScript = getAiStatusObserverScript('glm')
    expect(glmScript).toContain('停止')
    expect(glmScript).toContain('lucide-square')
    expect(glmScript).toContain('isElementVisible')

    const arenaScript = getAiStatusObserverScript('arena')
    expect(arenaScript).toContain('animate-spin')
    expect(arenaScript).toContain('lastTokenTime')
  })

  it('attachAiStatusListener parses __NEXUS_AI_STATUS__ and invokes callback', () => {
    const emitter = new EventEmitter()
    const onStatus = vi.fn()

    const detach = attachAiStatusListener(emitter as any, 'tab-123', onStatus)

    // Regular console message should be ignored
    emitter.emit('console-message', {}, 1, 'Hello from page')
    expect(onStatus).not.toHaveBeenCalled()

    // Status message: generating
    emitter.emit(
      'console-message',
      {},
      1,
      '__NEXUS_AI_STATUS__:' + JSON.stringify({ isGenerating: true, lastSnippet: '' })
    )
    expect(onStatus).toHaveBeenCalledWith('tab-123', true, '')

    // Status message: finished with question
    emitter.emit(
      'console-message',
      {},
      1,
      '__NEXUS_AI_STATUS__:' + JSON.stringify({ isGenerating: false, lastSnippet: 'Should we proceed?' })
    )
    expect(onStatus).toHaveBeenCalledWith('tab-123', false, 'Should we proceed?')

    // Clean up
    detach()
    emitter.emit(
      'console-message',
      {},
      1,
      '__NEXUS_AI_STATUS__:' + JSON.stringify({ isGenerating: true, lastSnippet: '' })
    )
    expect(onStatus).toHaveBeenCalledTimes(2) // No new calls
  })
})
