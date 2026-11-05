import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, it, expect } from 'vitest'
import { getMergedProviderFeatures, type ProviderConfigMap } from '../shared/providerConfig'

const main = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
function getGeneratedScripts(config: ProviderConfigMap, modelKey = 'arena-ai') {
  const compile = (name: string) => {
    const start = main.indexOf(`function ${name}(`)
    const end = main.indexOf('\nfunction ', start + 1)
    if (start < 0 || end < 0) throw new Error('Unable to locate production function ' + name)
    const code = ts.transpileModule('export ' + main.slice(start, end), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText
    const exports: Record<string, (...args: any[]) => any> = {}
    new Function('exports', 'providerConfig', 'getMergedProviderFeatures', 'PAGE_HELPERS', code)(
      exports, config, getMergedProviderFeatures, 'const splitList = (x) => [x];'
    )
    return exports[name]
  }
  const runtime = compile('buildWebviewRuntimeJs')(modelKey) as string
  let update = ''
  compile('updateWebviewTitlePoller')({ webContents: { isDestroyed: () => false,
    executeJavaScript: (script: string) => { update = script; return Promise.resolve() } } }, modelKey)
  return { runtime, update }
}

describe('production title polling configuration', () => {
  it('retains the global title selector and interval during live reconfiguration', () => {
    const { runtime, update } = getGeneratedScripts({ ALL: { features: { chatTitleSelector: '#global-title', chatTitlePollingIntervalMs: 9876 } } })
    for (const script of [runtime, update]) {
      expect(script).toContain('const titleSel = "#global-title"')
      expect(script).toContain('setInterval(updateTitle, 9876)')
    }
  })
  it('honors provider-specific overrides over the global config', () => {
    const { runtime, update } = getGeneratedScripts({ ALL: { features: { chatTitleSelector: '#global', chatTitlePollingIntervalMs: 9876 } }, 'arena-ai': { features: { chatTitleSelector: '#arena', chatTitlePollingIntervalMs: 2300 } } })
    for (const script of [runtime, update]) {
      expect(script).toContain('const titleSel = "#arena"')
      expect(script).toContain('setInterval(updateTitle, 2300)')
    }
  })
  it('keeps global zero (polling disabled) on both paths', () => {
    const { runtime, update } = getGeneratedScripts({ global: { features: { chatTitlePollingIntervalMs: 0 } } })
    for (const script of [runtime, update]) expect(script).toContain('if (titleSel && false)')
  })
})

describe('production page-title filter configuration', () => {
  it('honors global and provider-specific generic-title filters', () => {
    const a = main.indexOf("  view.webContents.on('page-title-updated',")
    const b = main.indexOf("\n  view.webContents.on('dom-ready',", a)
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a)
    const helperStart = main.indexOf('function shouldIgnoreProviderTitle(')
    const helperEnd = main.indexOf('\nfunction ensureAiView(', helperStart)
    const js = ts.transpileModule(main.slice(helperStart, helperEnd) + '\n' + main.slice(a, b), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    let listener: ((event: unknown, title: string) => void) | undefined
    const sent: unknown[][] = []
    const config: ProviderConfigMap = { ALL: { features: { defaultChatTitles: ['Generic Shell'] } } }
    const view = { webContents: { on: (_name: string, callback: (event: unknown, title: string) => void) => { listener = callback } } }
    new Function('view', 'tabId', 'viewTitles', 'viewModelKeys', 'providerConfig', 'getMergedProviderFeatures', 'sendToMainWindow', 'activeViewId', 'arenaTitleSync', js)(
      view, 'tab-1', new Map(), new Map([['tab-1', 'arena-ai']]), config, getMergedProviderFeatures, (...args: unknown[]) => sent.push(args), 'tab-1', { invalidate: () => {} }
    )
    listener!({}, 'Generic Shell')
    expect(sent).toHaveLength(0)
    listener!({}, 'A saved chat')
    expect(sent).toEqual([['ai-title-updated', 'tab-1', 'A saved chat']])
    config['arena-ai'] = { features: { defaultChatTitles: ['Provider Generic'] } }
    listener!({}, 'Provider Generic')
    expect(sent).toHaveLength(1)
  })
})
