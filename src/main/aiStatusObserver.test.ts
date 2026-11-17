import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getAiStatusObserverScript,
  attachAiStatusListener,
  injectAiStatusObserver,
  isSnippetAwaitingInput
} from './aiStatusObserver'
import { AiLifecycleManager } from './aiLifecycleManager'
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
    dom.window.setTimeout = setTimeout.bind(globalThis) as any
    dom.window.clearTimeout = clearTimeout.bind(globalThis) as any
    dom.window.setInterval = setInterval.bind(globalThis) as any
    dom.window.clearInterval = clearInterval.bind(globalThis) as any
    dom.window.Date = Date

    const statuses: Array<{ isGenerating: boolean; lastSnippet: string; status?: string }> = []
    dom.window.console.log = (...args: unknown[]) => {
      const msg = String(args[0] || '')
      if (msg.startsWith('__NEXUS_AI_STATUS__:')) {
        statuses.push(JSON.parse(msg.slice('__NEXUS_AI_STATUS__:'.length)))
      }
    }

    dom.window.eval(getAiStatusObserverScript('arena-ai'))

    // 1. Idle state (even with sidebar history loader spinning): emits initial idle, must NOT emit working!
    vi.advanceTimersByTime(1000)
    expect(statuses).toHaveLength(1)
    expect(statuses[0].isGenerating).toBe(false)
    expect(statuses[0].status).toBe('idle')

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
    expect(statuses).toHaveLength(2)
    expect(statuses[1]).toEqual(expect.objectContaining({ isGenerating: true, lastSnippet: '', status: 'working' }))

    // 3. Long tool call (>6s without text growth) while Stop generating remains active: must NOT prematurely end!
    vi.advanceTimersByTime(6500)
    expect(statuses).toHaveLength(2)

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
    expect(statuses).toHaveLength(3)
    expect(statuses[2].isGenerating).toBe(false)
    expect(statuses[2].status).toBe('waiting-input')
    expect(isSnippetAwaitingInput(statuses[2].lastSnippet)).toBe(true)

    // 5. User submits choice -> resumes working -> finishes with mt-3 Copy button
    askTurn.innerHTML = `<div><div><div class="prose">Deployment complete.</div></div></div>`
    sendBtn.disabled = false
    sendBtn.setAttribute('aria-label', 'Stop generating')
    vi.advanceTimersByTime(600)
    expect(statuses).toHaveLength(4)
    expect(statuses[3].isGenerating).toBe(true)
    expect(statuses[3].status).toBe('working')

    // Finish turn with completion footer + disabled Send button
    askTurn
      .querySelector('.prose')!
      .parentElement!
      .insertAdjacentHTML('beforeend', '<div class="mt-3"><button aria-label="Copy">Copy</button></div>')
    sendBtn.setAttribute('aria-label', 'Send message')
    sendBtn.disabled = true

    // Completion bar fast-tracks debounce (~250ms)
    vi.advanceTimersByTime(800)
    expect(statuses).toHaveLength(5)
    expect(statuses[4].isGenerating).toBe(false)
    expect(statuses[4].status).toBe('done')
    expect(statuses[4].lastSnippet).toContain('Deployment complete.')
  })

  it('emits unknown on initial evaluation when live DOM evidence is absent (not merely from nonempty selector strings)', () => {
    vi.useFakeTimers()
    const dom = new JSDOM('<!doctype html><html><body><div id="unrelated">Loading...</div></body></html>', {
      runScripts: 'outside-only'
    })
    dom.window.setTimeout = setTimeout.bind(globalThis) as any
    dom.window.clearTimeout = clearTimeout.bind(globalThis) as any
    dom.window.Date = Date

    const statuses: Array<{ isGenerating: boolean; lastSnippet: string; status?: string; hasReliableHooks?: boolean }> = []
    dom.window.console.log = (...args: unknown[]) => {
      const msg = String(args[0] || '')
      if (msg.startsWith('__NEXUS_AI_STATUS__:')) {
        statuses.push(JSON.parse(msg.slice('__NEXUS_AI_STATUS__:'.length)))
      }
    }

    dom.window.eval(getAiStatusObserverScript('arena-ai'))
    vi.advanceTimersByTime(1000)

    expect(statuses).toHaveLength(1)
    expect(statuses[0].isGenerating).toBe(false)
    expect(statuses[0].status).toBe('unknown')
    expect(statuses[0].hasReliableHooks).toBe(false)
  })

  it('emits waiting-input on initial evaluation when unresolved prompt/choice is present', () => {
    vi.useFakeTimers()
    const dom = new JSDOM(
      `<!doctype html><html><body>
        <div data-perf-target="transcript">
          <div role="log">
            <div data-agent-transcript-message="true" data-chat-message-id="a1">
              <div><div><div class="prose">Which cloud provider should we target?</div></div></div>
            </div>
          </div>
        </div>
        <div data-perf-target="composer">
          <button data-perf-target="send" aria-label="Send message" disabled></button>
        </div>
      </body></html>`,
      { runScripts: 'outside-only' }
    )
    ;(dom.window.HTMLElement.prototype as any).getBoundingClientRect = function () {
      return { width: 32, height: 32, top: 0, left: 0, right: 32, bottom: 32 }
    }
    dom.window.setTimeout = setTimeout.bind(globalThis) as any
    dom.window.clearTimeout = clearTimeout.bind(globalThis) as any
    dom.window.Date = Date

    const statuses: Array<{ isGenerating: boolean; lastSnippet: string; status?: string }> = []
    dom.window.console.log = (...args: unknown[]) => {
      const msg = String(args[0] || '')
      if (msg.startsWith('__NEXUS_AI_STATUS__:')) {
        statuses.push(JSON.parse(msg.slice('__NEXUS_AI_STATUS__:'.length)))
      }
    }

    dom.window.eval(getAiStatusObserverScript('arena-ai'))
    vi.advanceTimersByTime(1000)

    expect(statuses).toHaveLength(1)
    expect(statuses[0].isGenerating).toBe(false)
    expect(statuses[0].status).toBe('waiting-input')
  })

  it('does not classify a tab as idle solely because a generic composer or form is visible, remaining unknown', () => {
    vi.useFakeTimers()
    const dom = new JSDOM(
      `<!doctype html><html><body>
        <!-- Page with generic form / composer container but no send button, no assistant message, no stop button -->
        <form id="generic-form">
          <textarea id="search-input" placeholder="Search..."></textarea>
        </form>
        <div data-perf-target="composer">
          <!-- Composer is empty or initializing without a send button or active stop button -->
          <div contenteditable="true"></div>
        </div>
      </body></html>`,
      { runScripts: 'outside-only' }
    )
    ;(dom.window.HTMLElement.prototype as any).getBoundingClientRect = function () {
      return { width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40 }
    }
    dom.window.setTimeout = setTimeout.bind(globalThis) as any
    dom.window.clearTimeout = clearTimeout.bind(globalThis) as any
    dom.window.Date = Date

    const statuses: Array<{ isGenerating: boolean; lastSnippet: string; status?: string; hasReliableHooks?: boolean }> = []
    dom.window.console.log = (...args: unknown[]) => {
      const msg = String(args[0] || '')
      if (msg.startsWith('__NEXUS_AI_STATUS__:')) {
        statuses.push(JSON.parse(msg.slice('__NEXUS_AI_STATUS__:'.length)))
      }
    }

    dom.window.eval(getAiStatusObserverScript('arena-ai'))
    vi.advanceTimersByTime(1000)

    // MUST remain unknown because reliable AI hooks (send button, assistant turn, or stop button) are absent
    expect(statuses).toHaveLength(1)
    expect(statuses[0].isGenerating).toBe(false)
    expect(statuses[0].status).toBe('unknown')
    expect(statuses[0].hasReliableHooks).toBe(false)
  })

  it('re-evaluates pending input after initial load when a choice card mounts after the composer', async () => {
    vi.useFakeTimers()
    const dom = new JSDOM(
      `<!doctype html><html><body>
        <div data-perf-target="transcript">
          <div role="log" id="transcript-log">
            <div data-agent-transcript-message="true" data-chat-message-id="a1">
              <div><div><div class="prose">Welcome to the workspace.</div></div></div>
            </div>
          </div>
        </div>
        <div data-perf-target="composer">
          <button data-perf-target="send" aria-label="Send message" disabled></button>
        </div>
      </body></html>`,
      { runScripts: 'outside-only' }
    )
    ;(dom.window.HTMLElement.prototype as any).getBoundingClientRect = function () {
      return { width: 32, height: 32, top: 0, left: 0, right: 32, bottom: 32 }
    }
    dom.window.setTimeout = setTimeout.bind(globalThis) as any
    dom.window.clearTimeout = clearTimeout.bind(globalThis) as any
    dom.window.setInterval = setInterval.bind(globalThis) as any
    dom.window.clearInterval = clearInterval.bind(globalThis) as any
    dom.window.Date = Date

    const statuses: Array<{ isGenerating: boolean; lastSnippet: string; status?: string }> = []
    dom.window.console.log = (...args: unknown[]) => {
      const msg = String(args[0] || '')
      if (msg.startsWith('__NEXUS_AI_STATUS__:')) {
        statuses.push(JSON.parse(msg.slice('__NEXUS_AI_STATUS__:'.length)))
      }
    }

    dom.window.eval(getAiStatusObserverScript('arena-ai'))
    await vi.advanceTimersByTimeAsync(600)

    // Initial evaluation: composer with send button and non-question assistant message -> idle
    expect(statuses).toHaveLength(1)
    expect(statuses[0].status).toBe('idle')

    // 2. Choice card mounts AFTER initial load (asynchronously via SPA tool response)
    const log = dom.window.document.getElementById('transcript-log')!
    const choiceCard = dom.window.document.createElement('div')
    choiceCard.setAttribute('data-agent-transcript-message', 'true')
    choiceCard.innerHTML = `<div><div class="prose">Which framework should we deploy?</div><div role="radiogroup"><button role="radio">React</button><button role="radio">Vue</button></div></div>`
    log.appendChild(choiceCard)

    // Mutation observer & safety interval re-evaluate
    await vi.advanceTimersByTimeAsync(600)

    // Observer re-evaluates and emits waiting-input!
    expect(statuses.length).toBeGreaterThanOrEqual(2)
    const latest = statuses[statuses.length - 1]
    expect(latest.status).toBe('waiting-input')
    expect(latest.lastSnippet).toContain('Please choose an option?')
  })

  it('re-evaluates error evidence after initial load when an error mounts', async () => {
    vi.useFakeTimers()
    const customConfig = {
      'arena-ai': {
        features: {
          errorSelector: '.error-banner'
        }
      }
    }
    const dom = new JSDOM(
      `<!doctype html><html><body>
        <div id="container">
          <div data-perf-target="composer">
            <button data-perf-target="send" aria-label="Send message" disabled></button>
          </div>
        </div>
      </body></html>`,
      { runScripts: 'outside-only' }
    )
    ;(dom.window.HTMLElement.prototype as any).getBoundingClientRect = function () {
      return { width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30 }
    }
    dom.window.setTimeout = setTimeout.bind(globalThis) as any
    dom.window.clearTimeout = clearTimeout.bind(globalThis) as any
    dom.window.setInterval = setInterval.bind(globalThis) as any
    dom.window.clearInterval = clearInterval.bind(globalThis) as any
    dom.window.Date = Date

    const statuses: Array<{ isGenerating: boolean; lastSnippet: string; status?: string; error?: string }> = []
    dom.window.console.log = (...args: unknown[]) => {
      const msg = String(args[0] || '')
      if (msg.startsWith('__NEXUS_AI_STATUS__:')) {
        statuses.push(JSON.parse(msg.slice('__NEXUS_AI_STATUS__:'.length)))
      }
    }

    dom.window.eval(getAiStatusObserverScript('arena-ai', customConfig as any))
    await vi.advanceTimersByTimeAsync(600)
    expect(statuses[0].status).toBe('idle')

    // Error banner mounts asynchronously
    const errorEl = dom.window.document.createElement('div')
    errorEl.className = 'error-banner'
    errorEl.textContent = 'Rate limit exceeded. Please wait 1 minute.'
    dom.window.document.getElementById('container')!.appendChild(errorEl)

    await vi.advanceTimersByTimeAsync(600)
    expect(statuses.length).toBeGreaterThanOrEqual(2)
    const latest = statuses[statuses.length - 1]
    expect(latest.status).toBe('error')
    expect(latest.error).toContain('Rate limit exceeded')
  })

  it('accepts current-generation events after did-navigate while rejecting stale events with the production listener', () => {
    const emitter = new EventEmitter()
    const onStatus = vi.fn()
    let currentGen = 1

    // Attach production attachAiStatusListener with dynamic getViewGeneration
    const detach = attachAiStatusListener(emitter as any, 'tab-test', onStatus, () => currentGen)

    // Generation 1: valid event before navigation
    emitter.emit('console-message', {
      level: 'info',
      message: '__NEXUS_AI_STATUS__:' + JSON.stringify({ isGenerating: true, status: 'working', viewGeneration: 1 })
    })
    expect(onStatus).toHaveBeenCalledTimes(1)
    expect(onStatus).toHaveBeenLastCalledWith(
      'tab-test',
      true,
      '',
      expect.objectContaining({ status: 'working', viewGeneration: 1 })
    )

    // Navigation occurs (did-navigate bumps generation to 2)
    currentGen = 2

    // Stale event from old page/observer (generation 1) arrives AFTER navigation -> MUST BE DROPPED!
    emitter.emit('console-message', {
      level: 'info',
      message: '__NEXUS_AI_STATUS__:' + JSON.stringify({ isGenerating: false, status: 'done', viewGeneration: 1 })
    })
    expect(onStatus).toHaveBeenCalledTimes(1) // Still 1, stale event was rejected!

    // New observer injected in navigated page emits event with current generation (generation 2) -> MUST BE ACCEPTED!
    emitter.emit('console-message', {
      level: 'info',
      message: '__NEXUS_AI_STATUS__:' + JSON.stringify({ isGenerating: false, status: 'idle', viewGeneration: 2 })
    })
    expect(onStatus).toHaveBeenCalledTimes(2)
    expect(onStatus).toHaveBeenLastCalledWith(
      'tab-test',
      false,
      '',
      expect.objectContaining({ status: 'idle', viewGeneration: 2 })
    )

    detach()
  })

  it('wires real Arena tab through navigation -> working -> waiting-input -> done -> idle', async () => {
    vi.useFakeTimers()

    const dom = new JSDOM(
      `<!doctype html><html><body>
        <div data-perf-target="transcript"><div role="log" id="turns"></div></div>
        <div data-perf-target="composer">
          <div contenteditable="true" id="prompt-input"></div>
          <button id="sendBtn" data-perf-target="send" aria-label="Send message" disabled></button>
        </div>
      </body></html>`,
      { runScripts: 'outside-only' }
    )
    ;(dom.window.HTMLElement.prototype as any).getBoundingClientRect = function () {
      return { width: 32, height: 32, top: 0, left: 0, right: 32, bottom: 32 }
    }
    dom.window.setTimeout = setTimeout.bind(globalThis) as any
    dom.window.clearTimeout = clearTimeout.bind(globalThis) as any
    dom.window.setInterval = setInterval.bind(globalThis) as any
    dom.window.clearInterval = clearInterval.bind(globalThis) as any
    dom.window.Date = Date

    const fakeWebContents = new EventEmitter()
    const notifications: any[] = []
    let activeTabId: string | null = 'arena-tab'

    const manager = new AiLifecycleManager({
      sendToMainWindow: () => {},
      showInAppToast: (data) => notifications.push(data),
      getActiveViewId: () => activeTabId
    })

    // Setup listener on WebContents
    attachAiStatusListener(
      fakeWebContents as any,
      'arena-tab',
      (id, _isGenerating, lastSnippet, report) => {
        if (report?.status) {
          manager.setTabAiLifecycle(id, report.status, {
            lastSnippet,
            error: report.error,
            viewGeneration: report.viewGeneration
          })
        }
      },
      () => manager.getTabViewGeneration('arena-tab')
    )

    // Forward console.log from in-page script to WebContents 'console-message'
    dom.window.console.log = (...args: unknown[]) => {
      const msg = String(args[0] || '')
      fakeWebContents.emit('console-message', { level: 'info', message: msg })
    }

    // 1. Navigation occurs: generation bumped from 1 to 2
    const gen = manager.bumpTabViewGeneration('arena-tab')
    expect(gen).toBe(2)
    manager.setTabAiLifecycle('arena-tab', 'unknown', { viewGeneration: gen, skipTimer: true })
    expect(manager.getTabAiStatus('arena-tab')).toBe('unknown')

    // Inject observer script for generation 2 into the page
    dom.window.eval(getAiStatusObserverScript('arena', undefined, gen))
    await vi.advanceTimersByTimeAsync(600)

    // Initial idle state established (send button is laid out in composer)
    expect(manager.getTabAiStatus('arena-tab')).toBe('idle')

    // 2. User submits prompt -> Turn starts (Stop generating button active) -> status becomes 'working'
    const sendBtn = dom.window.document.getElementById('sendBtn') as HTMLButtonElement
    sendBtn.disabled = false
    sendBtn.setAttribute('aria-label', 'Stop generating')
    await vi.advanceTimersByTimeAsync(600)
    expect(manager.getTabAiStatus('arena-tab')).toBe('working')

    // 3. Assistant responds with an interactive choice card (waiting-input)
    sendBtn.setAttribute('aria-label', 'Send message')
    sendBtn.disabled = true
    const turns = dom.window.document.getElementById('turns')!
    const choiceTurn = dom.window.document.createElement('div')
    choiceTurn.setAttribute('data-agent-transcript-message', 'true')
    choiceTurn.innerHTML = `<div><div class="prose">Which cloud region?</div><div role="radiogroup"><button role="radio">us-east-1</button></div></div>`
    turns.appendChild(choiceTurn)

    // Heartbeat (1500ms) + 1000ms fallback debounce detects waiting-input
    await vi.advanceTimersByTimeAsync(2800)
    expect(manager.getTabAiStatus('arena-tab')).toBe('waiting-input')

    // 4. User makes choice -> model resumes working -> finishes with Copy button -> status becomes 'done'
    sendBtn.disabled = false
    sendBtn.setAttribute('aria-label', 'Stop generating')
    await vi.advanceTimersByTimeAsync(600)
    expect(manager.getTabAiStatus('arena-tab')).toBe('working')

    // Finished turn with Copy completion action matching Arena Agent Mode structure
    choiceTurn.innerHTML = `<div><div><div class="prose">Region configured successfully.</div><div class="mt-3"><button aria-label="Copy">Copy</button></div></div></div>`
    sendBtn.setAttribute('aria-label', 'Send message')
    sendBtn.disabled = true

    // Fast 250ms completion debounce fires
    await vi.advanceTimersByTimeAsync(600)
    expect(manager.getTabAiStatus('arena-tab')).toBe('done')

    // 5. Active tab 6000ms linger timer expires -> transitions to 'idle'
    await vi.advanceTimersByTimeAsync(6100)
    expect(manager.getTabAiStatus('arena-tab')).toBe('idle')
  })
})
