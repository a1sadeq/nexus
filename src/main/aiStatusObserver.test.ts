import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getAiStatusObserverScript,
  attachAiStatusListener,
  injectAiStatusObserver,
  isSnippetAwaitingInput
} from './aiStatusObserver'
import { EventEmitter } from 'events'
import { JSDOM } from 'jsdom'

describe('aiStatusObserver', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

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
    expect(arenaScript).toContain('[data-perf-target="composer"]')
  })

  it('injects custom assistant, streaming, error, and completion selectors from config overrides', () => {
    const customConfig = {
      customModel: {
        features: {
          assistantMessageSelector: '.my-assistant',
          streamingSelector: '.my-streaming',
          errorSelector: '.my-error-banner',
          completionActionSelector: 'button.my-copy',
          statusWatchdogTimeoutMs: 12000
        }
      }
    }
    const script = getAiStatusObserverScript('customModel', customConfig as any)
    expect(script).toContain('.my-assistant')
    expect(script).toContain('.my-streaming')
    expect(script).toContain('.my-error-banner')
    expect(script).toContain('button.my-copy')
    expect(script).toContain('12000')
    expect(script).toContain('isErrorVisible')
    expect(script).toContain('isCompletionActionVisible')
  })

  it('resolves arena <-> arena-ai config aliases and forwards providerConfigMap in injectAiStatusObserver', () => {
    const executed: string[] = []
    const fakeView = {
      webContents: {
        isDestroyed: () => false,
        executeJavaScript: vi.fn((code: string) => {
          executed.push(code)
          return Promise.resolve()
        })
      }
    }

    const configMap = {
      'arena-ai': {
        features: {
          streamingSelector: '.custom-arena-stream-hook',
          statusWatchdogTimeoutMs: 18000
        }
      }
    }

    // Even when URL fallback inferred 'arena', overrides stored under 'arena-ai' must apply
    injectAiStatusObserver(fakeView as any, 'arena', configMap as any)
    expect(executed).toHaveLength(1)
    expect(executed[0]).toContain('.custom-arena-stream-hook')
    expect(executed[0]).toContain('18000')
  })

  it('attachAiStatusListener parses __NEXUS_AI_STATUS__ for both legacy positional and modern event.message shapes', () => {
    const emitter = new EventEmitter()
    const onStatus = vi.fn()

    const detach = attachAiStatusListener(emitter as any, 'tab-123', onStatus)

    // Regular console message should be ignored
    emitter.emit('console-message', {}, 1, 'Hello from page')
    emitter.emit('console-message', { message: 'Hello modern event' })
    expect(onStatus).not.toHaveBeenCalled()

    // Legacy positional signature: generating
    emitter.emit(
      'console-message',
      {},
      1,
      '__NEXUS_AI_STATUS__:' + JSON.stringify({ isGenerating: true, lastSnippet: '' })
    )
    expect(onStatus).toHaveBeenCalledWith('tab-123', true, '')

    // Modern Electron Event<WebContentsConsoleMessageEventParams> signature: finished with question
    emitter.emit('console-message', {
      level: 'info',
      message:
        '__NEXUS_AI_STATUS__:' + JSON.stringify({ isGenerating: false, lastSnippet: 'Should we proceed?' })
    })
    expect(onStatus).toHaveBeenCalledWith('tab-123', false, 'Should we proceed?')

    // Clean up
    detach()
    emitter.emit('console-message', {
      message: '__NEXUS_AI_STATUS__:' + JSON.stringify({ isGenerating: true, lastSnippet: '' })
    })
    expect(onStatus).toHaveBeenCalledTimes(2)
  })

  it('tracks Arena Agent Mode idle -> orchestrating -> streaming -> ask_user -> completed transitions accurately', () => {
    vi.useFakeTimers()

    const dom = new JSDOM(
      `<!doctype html><html><body>
        <div data-sidebar="content">
          <svg class="lucide-loader-circle animate-spin"></svg>
          <div data-perf-target="sidebar_session"><a data-active="true" href="/agent/1"><span class="icon"></span></a></div>
        </div>
        <div data-perf-target="transcript">
          <div role="log">
            <div id="turns">
              <div data-agent-transcript-message="true" data-chat-message-id="u1">
                <div data-user-message-layout="true">hi</div>
              </div>
              <div data-agent-transcript-message="true" data-chat-message-id="a1">
                <div><div><div class="prose">Hello!</div><div class="mt-3"><button aria-label="Copy">Copy</button></div></div></div>
              </div>
            </div>
          </div>
        </div>
        <div data-perf-target="composer" class="rounded-[14px]">
          <div class="ProseMirror" contenteditable="true"></div>
          <button id="sendBtn" data-perf-target="send" aria-label="Send message" disabled></button>
        </div>
      </body></html>`,
      { runScripts: 'outside-only' }
    )

    // Give laid-out elements non-zero bounding boxes in JSDOM
    ;(dom.window.HTMLElement.prototype as any).getBoundingClientRect = function () {
      return { width: 32, height: 32, top: 0, left: 0, right: 32, bottom: 32 }
    }
    ;(dom.window.SVGElement.prototype as any).getBoundingClientRect = function () {
      return { width: 16, height: 16, top: 0, left: 0, right: 16, bottom: 16 }
    }

    const statuses: Array<{ isGenerating: boolean; lastSnippet: string }> = []
    dom.window.console.log = (...args: unknown[]) => {
      const msg = String(args[0] || '')
      if (msg.startsWith('__NEXUS_AI_STATUS__:')) {
        statuses.push(JSON.parse(msg.slice('__NEXUS_AI_STATUS__:'.length)))
      }
    }

    dom.window.eval(getAiStatusObserverScript('arena-ai'))

    // 1. Idle state (even with sidebar history loader spinning): must NOT emit working!
    vi.advanceTimersByTime(1000)
    expect(statuses).toHaveLength(0)

    const doc = dom.window.document
    const turns = doc.getElementById('turns')!
    const sendBtn = doc.getElementById('sendBtn') as HTMLButtonElement

    // 2. generatingStart ("orchestrating.." + Stop generating inside [data-perf-target="composer"])
    sendBtn.disabled = false
    sendBtn.setAttribute('aria-label', 'Stop generating')
    const orch = doc.createElement('div')
    orch.id = 'orch'
    orch.className = 'relative overflow-hidden bg-surface-primary rounded-xl border w-full'
    orch.textContent = 'orchestrating..'
    turns.appendChild(orch)

    vi.advanceTimersByTime(600)
    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toEqual({ isGenerating: true, lastSnippet: '' })

    // 3. Long tool call (>6s without text growth) while Stop generating remains active: must NOT prematurely end!
    vi.advanceTimersByTime(6500)
    expect(statuses).toHaveLength(1)

    // 4. Waiting for input (ask_user mounts radio options, Stop reverts to disabled Send, no mt-3 Copy bar)
    orch.remove()
    const askTurn = doc.createElement('div')
    askTurn.setAttribute('data-agent-transcript-message', 'true')
    askTurn.setAttribute('data-chat-message-id', 'a2')
    askTurn.innerHTML = `<div><div><div class="prose">Select target environment</div><div role="radiogroup"><button role="radio">Production</button></div></div></div>`
    turns.appendChild(askTurn)
    sendBtn.setAttribute('aria-label', 'Send message')
    sendBtn.disabled = true

    vi.advanceTimersByTime(2800)
    expect(statuses).toHaveLength(2)
    expect(statuses[1].isGenerating).toBe(false)
    expect(isSnippetAwaitingInput(statuses[1].lastSnippet)).toBe(true)

    // 5. User submits choice -> resumes working -> finishes with mt-3 Copy button
    askTurn.innerHTML = `<div><div><div class="prose">Deployment complete.</div></div></div>`
    sendBtn.disabled = false
    sendBtn.setAttribute('aria-label', 'Stop generating')
    vi.advanceTimersByTime(600)
    expect(statuses).toHaveLength(3)
    expect(statuses[2].isGenerating).toBe(true)

    // Finish turn with completion footer + disabled Send button
    askTurn
      .querySelector('div > div')!
      .insertAdjacentHTML('beforeend', '<div class="mt-3"><button aria-label="Copy">Copy</button></div>')
    sendBtn.setAttribute('aria-label', 'Send message')
    sendBtn.disabled = true

    // Completion bar fast-tracks debounce (~250ms)
    vi.advanceTimersByTime(800)
    expect(statuses).toHaveLength(4)
    expect(statuses[3].isGenerating).toBe(false)
    expect(statuses[3].lastSnippet).toContain('Deployment complete.')
  })
})
