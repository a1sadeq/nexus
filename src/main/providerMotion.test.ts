import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { buildProviderMotionScript, PROVIDER_MOTION_STYLE } from './providerMotion'

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
  it('uses each provider preference and applies a reversible script to its view', async () => {
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
    new Function('providerConfig', 'getMergedProviderFeatures', 'buildProviderMotionScript', 'globalThis', compiled)(
      config, (_key: string, overrides: { features?: object }) => overrides?.features || {}, buildProviderMotionScript, context
    )
    const apply = context.apply as (view: unknown, modelKey: string) => void
    const view = { webContents: { isDestroyed: () => false, executeJavaScript: execute } }
    apply(view, 'arena-ai')
    expect(dom.window.document.querySelector('style[data-nexus-provider-motion]')).not.toBeNull()
    apply(view, 'gemini')
    expect(dom.window.document.querySelector('style[data-nexus-provider-motion]')).toBeNull()
    expect(execute).toHaveBeenCalledTimes(2)
    dom.window.close()
  })
})
