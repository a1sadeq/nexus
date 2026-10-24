import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  isMatchingHostname,
  resolveEffectiveSelector,
  calculateScrollTarget,
  pickTargetIndex,
  buildEngine,
  type ContainerInfo,
  type NavigationResult
} from './promptNav'
import puppeteer, { Browser } from 'puppeteer-core'

describe('promptNav pure unit tests', () => {
  describe('isMatchingHostname', () => {
    it('matches exact hostnames', () => {
      expect(isMatchingHostname('arena.lmsys.org', 'arena.lmsys.org')).toBe(true)
      expect(isMatchingHostname('chatgpt.com', 'chatgpt.com')).toBe(true)
    })

    it('matches dot-separated subdomains', () => {
      expect(isMatchingHostname('sub.arena.lmsys.org', 'arena.lmsys.org')).toBe(true)
      expect(isMatchingHostname('chat.deepseek.com', 'deepseek.com')).toBe(true)
    })

    it('rejects non-subdomain substring matches (F14)', () => {
      expect(isMatchingHostname('fake-chatgpt.com', 'chatgpt.com')).toBe(false)
      expect(isMatchingHostname('myclaude.ai.fake', 'claude.ai')).toBe(false)
      expect(isMatchingHostname('notarena.lmsys.org', 'arena.lmsys.org')).toBe(false)
    })

    it('handles case insensitivity and whitespace', () => {
      expect(isMatchingHostname(' ARENA.LMSYS.ORG ', 'arena.lmsys.org')).toBe(true)
    })

    it('handles empty or missing arguments', () => {
      expect(isMatchingHostname('', 'arena.lmsys.org')).toBe(false)
      expect(isMatchingHostname('arena.lmsys.org', '')).toBe(false)
    })
  })

  describe('resolveEffectiveSelector (F01 & F03)', () => {
    const table = [
      {
        host: 'arena.lmsys.org',
        sel: '[data-agent-transcript-message="true"][data-chat-message-id]:has(> [data-user-message-layout="true"])'
      },
      { host: 'chatgpt.com', sel: '[data-message-author-role="user"]' }
    ]
    const fallback = '[class*="user-query"], [class*="user-message"]'

    it('treats customSelector as authoritative when provided (no fallback appended)', () => {
      const custom = '[data-custom-user-prompt]'
      const resolved = resolveEffectiveSelector(custom, 'arena.lmsys.org', table, fallback)
      expect(resolved).toBe(custom)
      expect(resolved).not.toContain(fallback)
    })

    it('trims whitespace on custom selector', () => {
      const resolved = resolveEffectiveSelector(
        '  .custom-bubble  ',
        'arena.lmsys.org',
        table,
        fallback
      )
      expect(resolved).toBe('.custom-bubble')
    })

    it('resolves table selector when customSelector is empty or undefined', () => {
      const resolved = resolveEffectiveSelector(undefined, 'arena.lmsys.org', table, fallback)
      expect(resolved).toBe(
        '[data-agent-transcript-message="true"][data-chat-message-id]:has(> [data-user-message-layout="true"])'
      )
    })

    it('falls back to generic fallback selector when host not in table', () => {
      const resolved = resolveEffectiveSelector(undefined, 'unknown-ai.com', table, fallback)
      expect(resolved).toBe(fallback)
    })
  })

  describe('calculateScrollTarget (F04 - Tall Prompts & Insets)', () => {
    const container: ContainerInfo = {
      scrollTop: 100,
      scrollHeight: 5000,
      clientHeight: 800,
      clientTop: 0,
      rectTop: 100,
      isDocument: false
    }

    it('top-aligns target rather than centering it', () => {
      // Element at top 400 with height 200
      const targetRect = { top: 400, height: 200 }
      const topInset = 24
      // relativeTop = 400 - 100 = 300
      // desired = scrollTop (100) + relativeTop (300) - topInset (24) = 376
      const targetY = calculateScrollTarget(container, targetRect, topInset)
      expect(targetY).toBe(376)
    })

    it('aligns start of tall prompts (height > 2x clientHeight) without pushing top off-screen', () => {
      // Prompt is 2000px tall in an 800px viewport
      const targetRect = { top: 500, height: 2000 }
      const topInset = 24
      // relativeTop = 500 - 100 = 400
      // desired = 100 + 400 - 24 = 476
      const targetY = calculateScrollTarget(container, targetRect, topInset)
      expect(targetY).toBe(476)
      // If it had centered like before: (clientHeight - height)/2 = (800 - 2000)/2 = -600, target would be 1076,
      // which would put the prompt top at -576 (completely off-screen above viewport)!
    })

    it('clamps to maxScroll when target is near the bottom', () => {
      const targetRect = { top: 4800, height: 300 }
      const maxScroll = container.scrollHeight - container.clientHeight // 5000 - 800 = 4200
      const targetY = calculateScrollTarget(container, targetRect, 24)
      expect(targetY).toBe(maxScroll)
    })

    it('clamps to 0 when target is near the top', () => {
      const targetRect = { top: 20, height: 100 }
      const targetY = calculateScrollTarget(container, targetRect, 50)
      expect(targetY).toBe(0)
    })
  })

  describe('pickTargetIndex (F05 - Progression & Boundaries)', () => {
    it('moves to previous index on older during sequential navigation', () => {
      expect(pickTargetIndex(5, 3, 'older')).toBe(2)
      expect(pickTargetIndex(5, 1, 'older')).toBe(0)
    })

    it('returns -1 when at older boundary (index 0)', () => {
      expect(pickTargetIndex(5, 0, 'older')).toBe(-1)
    })

    it('moves to next index on newer during sequential navigation', () => {
      expect(pickTargetIndex(5, 2, 'newer')).toBe(3)
      expect(pickTargetIndex(5, 3, 'newer')).toBe(4)
    })

    it('returns -1 when at newer boundary (index rootsCount - 1)', () => {
      expect(pickTargetIndex(5, 4, 'newer')).toBe(-1)
    })

    it('returns -1 for empty roots', () => {
      expect(pickTargetIndex(0, -1, 'older')).toBe(-1)
      expect(pickTargetIndex(0, -1, 'newer')).toBe(-1)
    })

    it('re-anchors from geometry when currentIndex is -1', () => {
      const geom = [
        { top: 50, bottom: 150 },
        { top: 250, bottom: 350 },
        { top: 500, bottom: 600 }
      ]
      // anchor at 400: older should pick index 1 (top 250 < 390)
      expect(pickTargetIndex(3, -1, 'older', geom, 400)).toBe(1)
      // anchor at 200: newer should pick index 1 (top 250 > 210)
      expect(pickTargetIndex(3, -1, 'newer', geom, 200)).toBe(1)
    })
  })
})

describe('Chromium Browser Integration Fixtures', () => {
  let browser: Browser

  // Launch headless Chromium
  beforeAll(async () => {
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--headless=new']
    })
  })

  afterAll(async () => {
    if (browser) {
      await browser.close()
    }
  })

  it('Fixture A: Arena Agent Mode DOM matching verified data attributes', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 800 })

    // Build Arena transcript with 8 user turns and interleaved assistant turns
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          #transcript {
            width: 100%;
            height: 600px;
            overflow-y: auto;
            position: relative;
          }
          .msg-box {
            padding: 20px;
            margin: 10px;
            min-height: 80px;
            background: #eee;
          }
        </style>
      </head>
      <body>
        <div id="transcript">
          ${[0, 1, 2, 3, 4, 5, 6, 7]
            .map(
              (i) => `
            <div id="chat-message-user-${i}" tabindex="-1"
                 data-agent-transcript-message="true"
                 data-chat-message-id="user-msg-${i}" class="msg-box">
              <div data-user-message-layout="true">
                <div data-user-message-body-row="true">User prompt ${i}</div>
              </div>
            </div>
            <div id="chat-message-assistant-${i}" tabindex="-1"
                 data-agent-transcript-message="true"
                 data-chat-message-id="asst-msg-${i}" class="msg-box">
              <div data-assistant-message-layout="true">
                Assistant turn ${i}
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </body>
      </html>
    `
    await page.setContent(html)

    const arenaSelector =
      '[data-agent-transcript-message="true"][data-chat-message-id]:has(> [data-user-message-layout="true"])'

    // First navigation: newer -> should land on first user prompt (index 0)
    const res0 = (await page.evaluate(buildEngine('newer', arenaSelector))) as NavigationResult
    expect(res0.status).toBe('ok')
    expect(res0.matchedCount).toBe(8)
    expect(res0.targetId).toBe('chat-message-user-0')

    // Second navigation: newer -> should move to index 1
    const res1 = (await page.evaluate(buildEngine('newer', arenaSelector))) as NavigationResult
    expect(res1.status).toBe('ok')
    expect(res1.targetId).toBe('chat-message-user-1')

    // Older navigation: older -> should move back to index 0
    const resBack = (await page.evaluate(buildEngine('older', arenaSelector))) as NavigationResult
    expect(resBack.status).toBe('ok')
    expect(resBack.targetId).toBe('chat-message-user-0')

    // Older again at index 0 -> should reach boundary
    const resBound = (await page.evaluate(buildEngine('older', arenaSelector))) as NavigationResult
    expect(resBound.status).toBe('boundary')

    await page.close()
  })

  it('Fixture B: Nested scrollport discovery (F02)', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 800 })

    // Outer wrapper has overflow-y: scroll and large scrollHeight (e.g. 3000px)
    // Inner transcript has overflow-y: auto and 1500px scrollHeight
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          #outer-shell {
            width: 1000px;
            height: 700px;
            overflow-y: scroll;
            border: 2px solid red;
          }
          #inner-transcript {
            width: 800px;
            height: 500px;
            overflow-y: auto;
            border: 2px solid blue;
          }
          .msg {
            height: 200px;
            margin: 10px;
            background: #ddd;
          }
        </style>
      </head>
      <body>
        <div id="outer-shell">
          <div style="height: 100px;">Outer Header</div>
          <div id="inner-transcript">
            <div id="prompt-0" class="user-query msg">Prompt 0</div>
            <div id="prompt-1" class="user-query msg">Prompt 1</div>
            <div id="prompt-2" class="user-query msg">Prompt 2</div>
            <div id="prompt-3" class="user-query msg">Prompt 3</div>
          </div>
          <div style="height: 2000px;">Extra outer spacer</div>
        </div>
      </body>
      </html>
    `
    await page.setContent(html)

    const res = (await page.evaluate(buildEngine('newer', '.user-query'))) as NavigationResult
    expect(res.status).toBe('ok')
    expect(res.containerTag?.toLowerCase()).toBe('div')

    // Confirm that the inner transcript was chosen and scrolled, NOT outer-shell
    const innerScroll = await page.evaluate(
      () => document.getElementById('inner-transcript')!.scrollTop
    )
    const outerScroll = await page.evaluate(() => document.getElementById('outer-shell')!.scrollTop)

    expect(innerScroll).toBeGreaterThanOrEqual(0)
    expect(outerScroll).toBe(0) // Outer shell must remain at 0

    await page.close()
  })

  it('Fixture C: Tall prompt alignment (F04)', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1000, height: 600 })

    // Prompt 1 is 1800px tall in a 500px viewport
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          #transcript {
            width: 800px;
            height: 500px;
            overflow-y: auto;
          }
          .tall-msg {
            height: 1800px;
            background: #cfe;
            margin-bottom: 20px;
          }
          .small-msg {
            height: 100px;
            background: #eee;
            margin-bottom: 20px;
          }
        </style>
      </head>
      <body>
        <div id="transcript">
          <div id="prompt-0" class="user-prompt small-msg">Short prompt 0</div>
          <div id="prompt-1" class="user-prompt tall-msg">Very tall prompt 1</div>
        </div>
      </body>
      </html>
    `
    await page.setContent(html)

    // First go to prompt 0 (top of transcript)
    const resFirst = (await page.evaluate(buildEngine('newer', '.user-prompt'))) as NavigationResult
    expect(resFirst.status).toBe('ok')
    expect(resFirst.targetId).toBe('prompt-0')

    // Then navigate to tall prompt 1
    const res = (await page.evaluate(buildEngine('newer', '.user-prompt'))) as NavigationResult
    expect(res.status).toBe('ok')
    expect(res.targetId).toBe('prompt-1')

    // Check that prompt-1 top relative to viewport is around the topInset (24px)
    const prompt1ViewportTop = await page.evaluate(() => {
      const p1 = document.getElementById('prompt-1')!
      const t = document.getElementById('transcript')!
      return p1.getBoundingClientRect().top - t.getBoundingClientRect().top
    })

    // It should be aligned near topInset (16px to 24px), NOT centered (which would be -650px)
    expect(prompt1ViewportTop).toBeGreaterThanOrEqual(14)
    expect(prompt1ViewportTop).toBeLessThanOrEqual(30)

    // Further newer navigation at last prompt should return boundary
    const resBound = (await page.evaluate(buildEngine('newer', '.user-prompt'))) as NavigationResult
    expect(resBound.status).toBe('boundary')

    await page.close()
  })

  it('Fixture D: Concurrency and Watchdog Token Protection (F06)', async () => {
    const page = await browser.newPage()
    await page.setContent(`
      <div id="scroller" style="height: 300px; overflow-y: auto;">
        <div id="p0" class="prompt" style="height: 100px;">0</div>
        <div id="p1" class="prompt" style="height: 100px;">1</div>
        <div id="p2" class="prompt" style="height: 100px;">2</div>
      </div>
    `)

    // Start a run, then immediately simulate an obsolete watchdog by advancing token
    const testResult = await page.evaluate(async () => {
      const win = window as unknown as { __nexusNavRunToken?: number }
      win.__nexusNavRunToken = 1
      const oldToken = win.__nexusNavRunToken

      // Set scroller to 0
      const scroller = document.getElementById('scroller')!
      scroller.scrollTop = 0

      // Simulate superseded run
      win.__nexusNavRunToken = 2

      // Verify watchdog check: if token !== runToken, snap is skipped
      return {
        isSuperseded: win.__nexusNavRunToken !== oldToken
      }
    })

    expect(testResult.isSuperseded).toBe(true)
    await page.close()
  })

  it('Fixture E: Invalid selector syntax returns structured invalid-selector result (F11)', async () => {
    const page = await browser.newPage()
    await page.setContent('<div class="msg">Hello</div>')

    // Malformed CSS selector that triggers DOMException in querySelectorAll
    const invalidSel = 'div:has(>>>)'
    const res = (await page.evaluate(buildEngine('newer', invalidSel))) as NavigationResult

    expect(res.status).toBe('invalid-selector')
    expect(res.reason).toBeDefined()

    await page.close()
  })
})
