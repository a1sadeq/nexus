import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { isThirdPartyAuthPage } from './loginWall'

const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')
function getScript(kind: 'runtime' | 'update', interval: number, url = 'https://arena.ai/chat') {
  const name = kind === 'runtime' ? 'buildWebviewRuntimeJs' : 'updateWebviewTitlePoller'
  const start = main.indexOf(`function ${name}(`)
  const end = main.indexOf('\nfunction ', start + 1)
  const source = 'export ' + main.slice(start, end)
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const api: Record<string, (...args: any[]) => any> = {}
  const features = { chatTitleSelector: '.title', chatTitlePollingIntervalMs: interval, enableSlashFocus: false, enableFocusRetention: false }
  // The production function now asks webIdentity.ts whether the page is one of Google's own sign-in
  // surfaces before injecting anything. The real predicate is handed in rather than a stub, so this
  // harness exercises the guard that ships.
  new Function(
    'exports',
    'providerConfig',
    'getMergedProviderFeatures',
    'PAGE_HELPERS',
    'isThirdPartyAuthPage',
    compiled
  )(api, {}, () => features, "const splitList = (s) => s.split(',');", isThirdPartyAuthPage)
  if (kind === 'runtime') return api[name]('arena-ai') as string
  let script = ''
  api[name]({ webContents: { isDestroyed: () => false, getURL: () => url, executeJavaScript: (value: string) => { script = value; return Promise.resolve() } } }, 'arena-ai')
  return script
}
function page() {
  let queries = 0, nextId = 1
  const intervals = new Map<number, { fn: () => void; ms: number }>()
  const listeners = new Set<() => void>()
  const document = {
    visibilityState: 'hidden', title: 'Old title',
    querySelector: () => { queries++; return { innerText: 'Chat title', textContent: 'Chat title' } },
    getElementById: () => ({ textContent: '' }),
    addEventListener: (_name: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_name: string, fn: () => void) => listeners.delete(fn)
  }
  const context = vm.createContext({
    document,
    window: { __nexusShiftScrollInjected: true, __slashFocusInjected: true, __focusRetentionInjected: true },
    setInterval: (fn: () => void, ms: number) => { const id = nextId++; intervals.set(id, { fn, ms }); return id },
    clearInterval: (id: number) => intervals.delete(id), console
  })
  return { document, context, intervals, listeners, queries: () => queries }
}
for (const kind of ['runtime', 'update'] as const) {
  describe(`injected ${kind} title path`, () => {
    it('does not scan hidden DOM and refreshes on visibility restoration', () => {
      const p = page(); vm.runInContext(getScript(kind, 1500), p.context)
      expect(p.queries()).toBe(0); expect(p.intervals.size).toBe(0)
      p.document.visibilityState = 'visible'; p.listeners.forEach(fn => fn())
      expect(p.document.title).toBe('Chat title'); expect(p.queries()).toBe(1); expect(p.intervals.size).toBe(1)
      p.document.visibilityState = 'hidden'; p.listeners.forEach(fn => fn())
      expect(p.intervals.size).toBe(0); p.intervals.forEach(({ fn }) => fn())
      expect(p.queries()).toBe(1)
    })
    it('bounds pathological poll rates and does not accumulate timers/listeners', () => {
      const p = page(); const script = getScript(kind, 1)
      p.document.visibilityState = 'visible'
      vm.runInContext(script, p.context); vm.runInContext(script, p.context)
      expect([...p.intervals.values()].map(v => v.ms)).toEqual([500])
      expect(p.listeners.size).toBe(1)
    })
    it('preserves zero/off and removes previous visibility listeners', () => {
      const p = page(); vm.runInContext(getScript(kind, 1500), p.context)
      vm.runInContext(getScript(kind, 0), p.context)
      expect(p.intervals.size).toBe(0); expect(p.listeners.size).toBe(0)
    })
  })
}

describe('nothing is injected into an identity provider\u2019s page', () => {
  it('produces no title poller on a Google sign-in page', () => {
    // The title poller used to be installed on every page, including a Google account chooser opened
    // from a tab — one of the scripts whose interval reads as a page that keeps refreshing.
    expect(getScript('update', 1500, 'https://accounts.google.com/v3/signin/identifier')).toBe('')
  })
  it('produces none on another provider\u2019s login page either', () => {
    expect(getScript('update', 1500, 'https://auth.openai.com/log-in')).toBe('')
    expect(getScript('update', 1500, 'https://github.com/login')).toBe('')
  })
  it('still produces one for the provider page itself', () => {
    expect(getScript('update', 1500, 'https://arena.ai/chat')).toContain('__nexusTitleInterval')
  })
})
