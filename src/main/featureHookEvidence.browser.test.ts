import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import puppeteer, { type Browser } from 'puppeteer-core'
import { buildFeatureHookEvidenceScript, type collectFeatureHookEvidence } from './featureHookEvidence'

type Evidence = ReturnType<typeof collectFeatureHookEvidence>
// Opt in with NEXUS_CHROMIUM_PATH. Never silently treat jsdom as browser validation.
describe.skipIf(!process.env.NEXUS_CHROMIUM_PATH)('Chromium read-only evidence fixtures', () => {
  let browser: Browser
  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath: process.env.NEXUS_CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  })
  afterAll(async () => { await browser?.close() })
  async function capture(html: string, selectors: Record<string, unknown> = {}) {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', request => { void request.respond({ status: 200, contentType: 'text/html', body: html }) })
    await page.goto('https://arena.ai/agent/fixture?secret=PRIVATE_URL')
    const before = await page.content()
    const evidence = await page.evaluate(buildFeatureHookEvidenceScript(selectors)) as Evidence
    const after = await page.content()
    await page.close()
    return { evidence, before, after }
  }
  it('preserves the page and finds hidden file inputs and semantic user roles', async () => {
    const { evidence, before, after } = await capture('<input type="file" hidden><div data-message-author-role="user">PRIVATE_MESSAGE</div><textarea>PRIVATE_DRAFT</textarea>')
    expect(after).toBe(before)
    expect(evidence.candidates.attachmentSelector).toHaveLength(1)
    expect(JSON.stringify(evidence)).toContain('data-message-author-role')
    expect(JSON.stringify(evidence)).not.toContain('PRIVATE_MESSAGE')
    expect(JSON.stringify(evidence)).not.toContain('PRIVATE_DRAFT')
    expect(JSON.stringify(evidence)).not.toContain('PRIVATE_URL')
  })
  it('accounts for nested clipping and horizontal browser viewport bounds', async () => {
    const { evidence } = await capture('<div style="height:40px;overflow:hidden"><div style="height:300px"></div><button aria-label="Send">Send</button></div><button aria-label="Stop" style="position:absolute;left:3000px">Stop</button>')
    const send = evidence.candidates.sendButtonSelector[0] as { hasLayout: boolean; inViewport: boolean }
    const stop = evidence.candidates.stopGenerationSelector[0] as { hasLayout: boolean; inViewport: boolean }
    expect(send.hasLayout).toBe(true)
    expect(send.inViewport).toBe(false)
    expect(stop.hasLayout).toBe(true)
    expect(stop.inViewport).toBe(false)
  })
  it('reports CSS syntax failures and true match counts without clicking buttons', async () => {
    const { evidence, before, after } = await capture('<button type="submit" onclick="document.body.remove()">Send</button>', { sendButtonSelector: 'button[type="submit"]', composerSelector: '[' })
    expect(evidence.validations.sendButtonSelector.count).toBe(1)
    expect(evidence.validations.composerSelector.error).toBe('invalid-selector')
    expect(after).toBe(before)
    expect(JSON.stringify(evidence).length).toBeLessThanOrEqual(64000)
  })
})
