import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { EventEmitter } from 'events'
import { getAiStatusObserverScript, attachAiStatusListener } from './aiStatusObserver'
import { AiLifecycleManager } from './aiLifecycleManager'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('Live Arena tab end-to-end lifecycle verification', () => {
  it('executes real Arena tab transitions through navigation, working, waiting-input, done, and idle', async () => {
    // Create real DOM layout resembling Arena Agent mode
    const dom = new JSDOM(
      `<!doctype html>
      <html>
        <head><title>Chatbot Arena</title></head>
        <body>
          <div data-sidebar="content">
            <div data-perf-target="sidebar_session"><a data-active="true" href="/agent/1"><span class="icon"></span></a></div>
          </div>
          <div data-perf-target="transcript">
            <div role="log" id="transcript-log">
              <!-- Transcript messages mount here -->
            </div>
          </div>
          <div data-perf-target="composer">
            <div class="ProseMirror" contenteditable="true" id="prompt-input"></div>
            <button id="sendBtn" data-perf-target="send" aria-label="Send message" disabled></button>
          </div>
        </body>
      </html>`,
      { runScripts: 'outside-only' }
    )

    ;(dom.window.HTMLElement.prototype as any).getBoundingClientRect = function () {
      return { width: 400, height: 48, top: 0, left: 0, right: 400, bottom: 48 }
    }

    const fakeWebContents = new EventEmitter()
    const history: Array<{ status: string; snippet?: string; gen: number }> = []
    const notifications: Array<{ status: string; snippet?: string }> = []

    const manager = new AiLifecycleManager({
      sendToMainWindow: (_channel, payload) => {
        if (payload && payload.status) {
          history.push({ status: payload.status, snippet: payload.lastSnippet, gen: payload.viewGeneration })
        }
      },
      showInAppToast: (data) => {
        notifications.push({ status: data.status, snippet: data.snippet })
      },
      getActiveViewId: () => 'arena-live-tab'
    })

    // Wire production listener
    attachAiStatusListener(
      fakeWebContents as any,
      'arena-live-tab',
      (tabId, _isGenerating, lastSnippet, report) => {
        if (report?.status) {
          manager.setTabAiLifecycle(tabId, report.status, {
            lastSnippet,
            error: report.error,
            viewGeneration: report.viewGeneration
          })
        }
      },
      () => manager.getTabViewGeneration('arena-live-tab')
    )

    dom.window.console.log = (...args: unknown[]) => {
      const msg = String(args[0] || '')
      fakeWebContents.emit('console-message', { level: 'info', message: msg })
    }

    // 1. Navigation: Tab created with Gen 1 -> did-navigate to Arena bumps to Gen 2
    manager.initTabViewGeneration('arena-live-tab', 1)
    const nextGen = manager.bumpTabViewGeneration('arena-live-tab')
    expect(nextGen).toBe(2)
    manager.setTabAiLifecycle('arena-live-tab', 'unknown', { viewGeneration: nextGen, skipTimer: true })
    expect(manager.getTabAiStatus('arena-live-tab')).toBe('unknown')

    // Stale Gen 1 event from before navigation arrives -> must be dropped
    fakeWebContents.emit('console-message', {
      level: 'info',
      message: '__NEXUS_AI_STATUS__:' + JSON.stringify({ isGenerating: false, status: 'done', viewGeneration: 1 })
    })
    expect(manager.getTabAiStatus('arena-live-tab')).toBe('unknown')

    // Inject production observer script with viewGeneration 2
    dom.window.eval(getAiStatusObserverScript('arena', undefined, nextGen))
    await sleep(200)
    // Send button in composer is laid out -> transitions to idle
    expect(manager.getTabAiStatus('arena-live-tab')).toBe('idle')

    // 2. User submits prompt -> Stop button active -> transitions to working
    const sendBtn = dom.window.document.getElementById('sendBtn') as HTMLButtonElement
    sendBtn.disabled = false
    sendBtn.setAttribute('aria-label', 'Stop generating')
    await sleep(200)
    expect(manager.getTabAiStatus('arena-live-tab')).toBe('working')

    // 3. Choice card mounts -> waiting-input
    sendBtn.setAttribute('aria-label', 'Send message')
    sendBtn.disabled = true
    const log = dom.window.document.getElementById('transcript-log')!
    const choiceCard = dom.window.document.createElement('div')
    choiceCard.setAttribute('data-agent-transcript-message', 'true')
    choiceCard.setAttribute('data-chat-message-id', 'a1')
    choiceCard.innerHTML = `<div><div class="prose">Which cloud provider should we deploy to?</div><div role="radiogroup"><button role="radio">AWS</button><button role="radio">GCP</button></div></div>`
    log.appendChild(choiceCard)
    await sleep(2800)
    expect(manager.getTabAiStatus('arena-live-tab')).toBe('waiting-input')
    expect(manager.getTabAiLifecycle('arena-live-tab')?.lastSnippet).toContain('Please choose an option?')

    // 4. User makes choice -> working resumes -> completion action mounts -> done
    sendBtn.disabled = false
    sendBtn.setAttribute('aria-label', 'Stop generating')
    await sleep(200)
    expect(manager.getTabAiStatus('arena-live-tab')).toBe('working')

    choiceCard.innerHTML = `<div><div><div class="prose">Deployment to AWS completed successfully.</div><div class="mt-3"><button aria-label="Copy">Copy</button></div></div></div>`
    sendBtn.setAttribute('aria-label', 'Send message')
    sendBtn.disabled = true
    await sleep(600)
    expect(manager.getTabAiStatus('arena-live-tab')).toBe('done')
    expect(manager.getTabAiLifecycle('arena-live-tab')?.lastSnippet).toContain('Deployment to AWS completed successfully.')

    // 5. Active tab 6000ms linger timer expires -> transitions to idle
    await sleep(6100)
    expect(manager.getTabAiStatus('arena-live-tab')).toBe('idle')
  }, 15000)
})
