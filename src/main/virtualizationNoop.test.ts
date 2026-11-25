import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { isThirdPartyAuthPage } from './loginWall'

describe('production off-screen rendering injector', () => {
  // The slice is compiled and evaluated with an explicit parameter list, so every free variable of
  // the production function has to be named here. `isThirdPartyAuthPage` is the predicate main
  // imports, passed in as itself rather than stubbed.
  function productionInject(holder: { selector: string }) {
    const main = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const a = main.indexOf('function injectVirtualizationCss(')
    const b = main.indexOf('\nfunction ', a + 1)
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a)
    const js = ts.transpileModule(main.slice(a, b) + '\nglobalThis.inject = injectVirtualizationCss', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const dom = new JSDOM('<!doctype html><head></head><body></body>', { runScripts: 'outside-only' })
    const ctx: Record<string, unknown> = {}
    new Function('providerConfig', 'getMergedProviderFeatures', 'isThirdPartyAuthPage', 'globalThis', js)(
      {}, () => ({ virtualizationSelector: holder.selector }), isThirdPartyAuthPage, ctx
    )
    const execute = vi.fn((script: string) => { dom.window.eval(script); return Promise.resolve() })
    const inject = ctx.inject as (view: unknown, key: string) => void
    const view = (url = 'https://arena.ai/agent/01a1f14b') => ({
      webContents: { getURL: () => url, isDestroyed: () => false, executeJavaScript: execute }
    })
    return { inject, execute, view, dom }
  }

  it('does not rewrite unchanged CSS but updates a changed selector', () => {
    const holder = { selector: '[data-agent-transcript-message="true"]' }
    const { inject, view, dom } = productionInject(holder)
    inject(view(), 'arena-ai')
    const style = dom.window.document.getElementById('__nexus_virtualization')!
    const mutation = new dom.window.MutationObserver(() => {})
    mutation.observe(style, { childList: true, characterData: true, subtree: true })
    inject(view(), 'arena-ai')
    expect(mutation.takeRecords()).toHaveLength(0)
    holder.selector = '[data-other-turn]'
    inject(view(), 'arena-ai')
    expect(style.textContent).toContain('[data-other-turn]')
    expect(mutation.takeRecords().length).toBeGreaterThan(0)
    mutation.disconnect(); dom.window.close()
  })

  it('does not touch an identity provider page', () => {
    const holder = { selector: '[data-agent-transcript-message="true"]' }
    const { inject, execute, view, dom } = productionInject(holder)
    inject(view('https://accounts.google.com/v3/signin/accountchooser'), 'arena-ai')
    inject(view('https://login.microsoftonline.com/common/oauth2'), 'arena-ai')
    expect(execute).not.toHaveBeenCalled()
    expect(dom.window.document.getElementById('__nexus_virtualization')).toBeNull()
    dom.window.close()
  })
})
