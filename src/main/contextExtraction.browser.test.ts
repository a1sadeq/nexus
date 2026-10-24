import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import puppeteer, { type Browser } from 'puppeteer-core'
import {
  buildContextExtractorScript,
  buildSnapshotFromRawPayload,
  type RawExtractionPayload
} from './contextExtraction'
import { projectSnapshotToMarkdown } from '../shared/contextSnapshot'

const chromiumPath = process.env.NEXUS_CHROMIUM_PATH || '/usr/bin/chromium'

describe('Chromium Real-Browser Context Extraction Fixtures', () => {
  let browser: Browser | null = null

  beforeAll(async () => {
    try {
      browser = await puppeteer.launch({
        executablePath: chromiumPath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
      })
    } catch (e) {
      console.warn('Chromium launch failed or path unavailable, skipping browser fixture:', e)
    }
  })

  afterAll(async () => {
    await browser?.close()
  })

  it('Arena Agent Mode fixture in Chromium: extracts exact turns, preserves code whitespace, excludes workspace & draft', async () => {
    if (!browser) return

    const page = await browser.newPage()
    await page.setRequestInterception(true)

    const arenaHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Arena Chat - Prompt Navigation</title></head>
        <body>
          <main>
            <div data-agent-transcript-message="true" data-chat-message-id="arena-turn-1">
              <div data-user-message-layout="true">
                <p>User request: Please optimize the prompt navigation engine.</p>
              </div>
            </div>

            <div data-agent-transcript-message="true" data-chat-message-id="arena-turn-2">
              <details class="thought-summary">
                <summary>Thinking Process</summary>
                <p>Need to inspect scroll offsets and ensure bounding box alignment.</p>
              </details>
              <p>Assistant response: Here is the optimized scroll implementation:</p>
              <pre><code class="language-typescript">export function scrollPrompt(container: HTMLElement, target: HTMLElement): boolean {
  const rect = target.getBoundingClientRect();
  const arr = [10, 20, 30];
  console.log("value: " + arr[1]); // log at 10:45 AM
  container.scrollTo({ top: rect.top, behavior: 'smooth' });
  return true;
}</code></pre>
              <p>For more details, check <a href="https://example.com/docs">the navigation docs</a>.</p>
            </div>

            <aside class="workspace-panel">Workspace11.4MB/128.0MB588/10K filesConnectors</aside>
            <div class="composer" contenteditable="true">Unsent draft message text that must not leak</div>
          </main>
        </body>
      </html>
    `

    page.on('request', (req) => {
      void req.respond({ status: 200, contentType: 'text/html', body: arenaHtml })
    })

    await page.goto('https://arena.ai/agent/session-real-browser')

    // Run extraction inside Chromium
    const script = buildContextExtractorScript()
    const payload = (await page.evaluate(script)) as RawExtractionPayload

    expect(payload.success).toBe(true)
    expect(payload.adapterId).toBe('arena-agent-mode')
    expect(payload.turns.length).toBe(2)

    // User Turn
    const turn1 = payload.turns[0]
    expect(turn1.sourceRole).toBe('user')
    expect(turn1.roleEvidence).toContain('data-user-message-layout')
    expect(turn1.blocks.some((b) => b.type === 'text' && b.text?.includes('Please optimize the prompt navigation'))).toBe(true)

    // Assistant Turn
    const turn2 = payload.turns[1]
    expect(turn2.sourceRole).toBe('assistant')

    // Thought block separation
    const thoughtBlock = turn2.blocks.find((b) => b.type === 'thought')
    expect(thoughtBlock).toBeDefined()
    expect(thoughtBlock?.text).toContain('Need to inspect scroll offsets')

    // Code block exact fidelity: array index [1], quotes, and timestamp
    const codeBlock = turn2.blocks.find((b) => b.type === 'code')
    expect(codeBlock).toBeDefined()
    expect(codeBlock?.language).toBe('typescript')
    expect(codeBlock?.text).toContain('arr[1]')
    expect(codeBlock?.text).toContain('log at 10:45 AM')
    expect(codeBlock?.text).toContain('container.scrollTo')

    // Link block
    const linkBlock = turn2.blocks.find((b) => b.type === 'link')
    expect(linkBlock).toBeDefined()
    expect(linkBlock?.destination).toBe('https://example.com/docs')

    // Exclusion assertions: Workspace and composer must NOT exist in extracted payload
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('Workspace11.4MB')
    expect(serialized).not.toContain('Unsent draft message text')

    // Full snapshot & markdown projection round-trip in real browser environment
    const snapshot = buildSnapshotFromRawPayload({
      payload,
      tabId: 'tab-browser-test',
      providerKey: 'Arena Agent Mode',
      origin: 'https://arena.ai/agent/session-real-browser',
      title: 'Arena Chat - Prompt Navigation',
      contextRevision: 'rev-browser-1'
    })

    const packet = projectSnapshotToMarkdown({
      snapshot,
      options: { mode: 'brief' }
    })

    expect(packet.prompt).toContain('# 🚀 AI AGENT CONTINUATION & SESSION HANDOFF CONTEXT')
    expect(packet.prompt).toContain('Please optimize the prompt navigation engine')
    expect(packet.prompt).toContain('arr[1]')
    expect(packet.prompt).toContain('log at 10:45 AM')
    expect(packet.stats.userTurns).toBe(1)
    expect(packet.stats.assistantTurns).toBe(1)

    await page.close()
  })
})
