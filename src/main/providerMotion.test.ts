import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { buildProviderMotionScript, PROVIDER_MOTION_STYLE } from './providerMotion'
import { isThirdPartyAuthPage } from './loginWall'

function page() {
  return new JSDOM('<!doctype html><html><head></head><body><div id="content">Saved chat</div><video></video></body></html>', { runScripts: 'outside-only' })
}

describe('opt-in provider CSS animation pause', () => {
  it('defaults to off, can be enabled and disabled without touching chat content', () => {
    const dom = page()
    dom.window.eval(buildProviderMotionScript(false, 1))
    expect(dom.window.document.querySelector('style[data-nexus-provider-motion]')).toBeNull()
    dom.window.eval(buildProviderMotionScript(true, 2))
    const style = dom.window.document.querySelector('style[data-nexus-provider-motion]')!
    expect(style.textContent).toBe(PROVIDER_MOTION_STYLE)
    expect(style.textContent).toContain('animation-play-state: paused')
    expect(style.textContent).not.toContain('display:')
    dom.window.eval(buildProviderMotionScript(false, 3))
    expect(dom.window.document.querySelector('style[data-nexus-provider-motion]')).toBeNull()
    expect(dom.window.document.querySelector('#content')?.textContent).toBe('Saved chat')
    expect(dom.window.document.querySelector('video')).not.toBeNull()
    dom.window.close()
  })

  it('is idempotent and ignores stale enable or disable requests', () => {
    const dom = page()
    dom.window.eval(buildProviderMotionScript(true, 3))
    const style = dom.window.document.querySelector('style[data-nexus-provider-motion]')!
    dom.window.eval(buildProviderMotionScript(true, 4))
    expect(dom.window.document.querySelectorAll('style[data-nexus-provider-motion]')).toHaveLength(1)
    expect(dom.window.document.querySelector('style[data-nexus-provider-motion]')).toBe(style)
    dom.window.eval(buildProviderMotionScript(false, 2))
    expect(dom.window.document.querySelector('style[data-nexus-provider-motion]')).toBe(style)
    dom.window.eval(buildProviderMotionScript(false, 5))
    dom.window.eval(buildProviderMotionScript(true, 4))
    expect(dom.window.document.querySelector('style[data-nexus-provider-motion]')).toBeNull()
    dom.window.close()
  })

  it('can be applied to a freshly loaded document independently of the old one', () => {
    const old = page(); const next = page()
    old.window.eval(buildProviderMotionScript(true, 4))
    next.window.eval(buildProviderMotionScript(true, 5))
    expect(next.window.document.querySelector('style[data-nexus-provider-motion]')).not.toBeNull()
    old.window.close(); next.window.close()
  })
})

describe('production provider update integration', () => {
  // The slice is compiled and evaluated with an explicit parameter list, so every free variable of
  // the production function has to be named here. `isThirdPartyAuthPage` is the predicate main
  // imports, passed in as itself rather than stubbed.
  function productionApply() {
    const main = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const a = main.indexOf('let providerMotionSequence = 0')
    const b = main.indexOf('function injectVirtualizationCss(', a)
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a)
    const compiled = ts.transpileModule(main.slice(a, b) + '\nglobalThis.apply = applyProviderMotionMode', {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText
    const dom = page()
    const execute = vi.fn((script: string) => { dom.window.eval(script); return Promise.resolve() })
    const config: Record<string, { features: { pauseCssAnimations: boolean } }> = {
      'arena-ai': { features: { pauseCssAnimations: true } }, gemini: { features: { pauseCssAnimations: false } }
    }
    const context: Record<string, unknown> = {}
    new Function(
      'providerConfig', 'getMergedProviderFeatures', 'buildProviderMotionScript', 'isThirdPartyAuthPage', 'globalThis', compiled
    )(
      config,
      (_key: string, overrides: { features?: object }) => overrides?.features || {},
      buildProviderMotionScript,
      isThirdPartyAuthPage,
      context
    )
    const apply = context.apply as (view: unknown, modelKey: string) => void
    const view = (url = 'https://arena.ai/agent/01a1f14b') => ({
      webContents: { getURL: () => url, isDestroyed: () => false, executeJavaScript: execute }
    })
    return { apply, execute, view, dom }
  }

  it('uses each provider preference and applies a reversible script to its view', () => {
    const { apply, execute, view, dom } = productionApply()
    apply(view(), 'arena-ai')
    expect(dom.window.document.querySelector('style[data-nexus-provider-motion]')).not.toBeNull()
    apply(view(), 'gemini')
    expect(dom.window.document.querySelector('style[data-nexus-provider-motion]')).toBeNull()
    expect(execute).toHaveBeenCalledTimes(2)
    dom.window.close()
  })

  it('leaves an identity provider page untouched', () => {
    const { apply, execute, view, dom } = productionApply()
    apply(view('https://accounts.google.com/v3/signin/accountchooser'), 'arena-ai')
    apply(view('https://login.microsoftonline.com/common/oauth2'), 'arena-ai')
    expect(execute).not.toHaveBeenCalled()
    expect(dom.window.document.querySelector('style[data-nexus-provider-motion]')).toBeNull()
    dom.window.close()
  })
})
