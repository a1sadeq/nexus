import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')
function getScript(kind: 'runtime' | 'update', interval: number) {
  const name = kind === 'runtime' ? 'buildWebviewRuntimeJs' : 'updateWebviewTitlePoller'
  const start = main.indexOf(`function ${name}(`)
  const end = main.indexOf('\nfunction ', start + 1)
  const source = 'export ' + main.slice(start, end)
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const api: Record<string, (...args: any[]) => any> = {}
  const features = { chatTitleSelector: '.title', chatTitlePollingIntervalMs: interval, enableSlashFocus: false, enableFocusRetention: false }
  new Function('exports', 'providerConfig', 'getMergedProviderFeatures', 'PAGE_HELPERS', compiled)(
    api, {}, () => features, "const splitList = (s) => s.split(',');"
  )
  if (kind === 'runtime') return api[name]('arena-ai') as string
  let script = ''
  api[name]({ webContents: { isDestroyed: () => false, executeJavaScript: (value: string) => { script = value; return Promise.resolve() } } }, 'arena-ai')
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
      expect(p.queries()).toBe(0)
      p.document.visibilityState = 'visible'; p.listeners.forEach(fn => fn())
      expect(p.document.title).toBe('Chat title'); expect(p.queries()).toBe(1)
      p.document.visibilityState = 'hidden'; p.intervals.forEach(({ fn }) => fn())
      expect(p.queries()).toBe(1)
    })
    it('bounds pathological poll rates and does not accumulate timers/listeners', () => {
      const p = page(); const script = getScript(kind, 1)
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
