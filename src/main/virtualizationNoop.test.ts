import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

describe('production off-screen rendering injector', () => {
  it('does not rewrite unchanged CSS but updates a changed selector', async () => {
    const main = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const a = main.indexOf('function injectVirtualizationCss(')
    const b = main.indexOf('\nfunction ', a + 1)
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a)
    const js = ts.transpileModule(main.slice(a, b) + '\nglobalThis.inject = injectVirtualizationCss', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const dom = new JSDOM('<!doctype html><head></head><body></body>', { runScripts: 'outside-only' })
    let selector = '[data-agent-transcript-message="true"]'
    const ctx: Record<string, unknown> = {}
    new Function('providerConfig', 'getMergedProviderFeatures', 'globalThis', js)({}, () => ({ virtualizationSelector: selector }), ctx)
    const inject = ctx.inject as (view: unknown, key: string) => void
    const execute = vi.fn((script: string) => { dom.window.eval(script); return Promise.resolve() })
    const view = { webContents: { isDestroyed: () => false, executeJavaScript: execute } }
    inject(view, 'arena-ai')
    const style = dom.window.document.getElementById('__nexus_virtualization')!
    const mutation = new dom.window.MutationObserver(() => {})
    mutation.observe(style, { childList: true, characterData: true, subtree: true })
    inject(view, 'arena-ai')
    expect(mutation.takeRecords()).toHaveLength(0)
    selector = '[data-other-turn]'
    inject(view, 'arena-ai')
    expect(style.textContent).toContain('[data-other-turn]')
    expect(mutation.takeRecords().length).toBeGreaterThan(0)
    mutation.disconnect(); dom.window.close()
  })
})
