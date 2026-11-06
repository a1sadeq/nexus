# Task 4: Tests and Verification Plan

**Findings Addressed**: M7 (17-case matrix & mock harness), L5 (canary & restore drill).

---

## 1. Automated Test Suite Matrix (§11)

| Case ID | Target Test File | Assertion / Invariant | Covered Finding |
| :--- | :--- | :--- | :--- |
| **T-A1** | `src/main/__tests__/bootstrapOrder.test.ts` | `app.name = 'nexus'` and `setPath('userData')` execute strictly before `requestSingleInstanceLock`. | TASK-1, L2 |
| **T-A2** | `src/main/__tests__/bootstrapOrder.test.ts` | Missing `nexus/` directory in fresh `appData` does not throw an Error (`mkdirSync` guard). | M8 |
| **T-A3** | `src/main/__tests__/bootstrapOrder.test.ts` | `setPath('sessionData')` is attempted and does not crash on any Electron version. | M8 |
| **T-A4** | `src/main/__tests__/consolidation.test.ts` | Unique files (e.g. `shortcuts.json`) migrate; conflicts resolve to newer mtime with loser quarantined. | H3, M5 |
| **T-A5** | `src/main/__tests__/consolidation.test.ts` | Legacy `Partitions/` and dead `SingletonLock` are archived without merging over live cookie jar. | M5 |
| **T-A6** | `src/main/__tests__/consolidation.test.ts` | Re-running consolidation is an idempotent no-op; error on one entry does not crash startup. | M5 |
| **T-A7** | `src/main/__tests__/writeBarrier.test.ts` | `save_tabs` before `get_tabs` from same session throws Write Barrier rejection; succeeds after `get_tabs`. | H1 |
| **T-A8** | `src/main/__tests__/writeBarrier.test.ts` | Untrusted sender ID (e.g. webview or iframe) is rejected with an Error. | M6 |
| **T-A9** | `src/main/__tests__/atomicWrite.test.ts` | Leading-edge write is immediate; trailing writes coalesced (400ms); `before-quit` flushes queue. | B3, M1 |
| **T-A10** | `src/main/__tests__/atomicWrite.test.ts` | `.bak` rotates to `.bak2` across consecutive writes; corrupt main file recovers from `.bak`. | M2 |
| **T-A11** | `src/renderer/src/lib/__tests__/hydration.test.tsx` | Disk state overrides populated `localStorage`; defaults written only after hydration finishes. | TASK-2, M3 |
| **T-A12** | `src/renderer/src/lib/__tests__/hydration.test.tsx` | IPC timeout renders `localStorage` fallback in read-only mode and emits zero disk writes. | M3, L4 |
| **T-A13** | `src/renderer/src/lib/__tests__/promotion.test.tsx` | Missing `interface-settings.json` + populated renderer `localStorage` triggers one-time promotion save. | B2 |
| **T-A14** | `src/renderer/src/lib/__tests__/hydration.test.tsx` | Theme is read synchronously before first paint; zero FOUC frames detected. | M4 |
| **T-A15** | `src/shared/__tests__/serialization.test.ts` | Unknown tab fields survive round-trip; `javascript:` URLs rejected; tab cap of 64 enforced. | M10 |
| **T-A16** | `src/main/__tests__/secondInstance.test.ts` | Second instance execution signals first instance and exits without creating dual windows. | TASK-1 |
| **T-A17** | `scripts/appImageCanary.sh` | Packaged build executed with temporary `HOME`: `~/.config/Nexus` is never created; history count = 65. | TASK-1, L5 |

---

## 2. Order-Preserving Bootstrap Mock Harness (Fix 6, M7)

```typescript
// src/main/__tests__/bootstrapOrder.test.ts
import { describe, it, expect, vi } from 'vitest'

const callSequence: string[] = []

vi.mock('electron', () => ({
  app: {
    set name(v: string) { callSequence.push(`name:${v}`) },
    get name() { return 'nexus' },
    getPath: vi.fn((p: string) => (p === 'appData' ? '/tmp/mock-appdata' : `/tmp/mock-appdata/${p}`)),
    setPath: vi.fn((p: string) => callSequence.push(`setPath:${p}`)),
    requestSingleInstanceLock: vi.fn(() => { callSequence.push('lock'); return true }),
    on: vi.fn(),
    whenReady: vi.fn(async () => {})
  }
}))

describe('Bootstrap Order Verification', () => {
  it('pins userData and app.name strictly before acquiring the singleton lock', async () => {
    await import('../bootstrap')
    expect(callSequence[0]).toBe('name:nexus')
    expect(callSequence[1]).toBe('setPath:userData')
    expect(callSequence.indexOf('lock')).toBeGreaterThan(callSequence.indexOf('setPath:userData'))
  })
})
```

---

## 3. Manual Live Verification Checklist
1. **Directory Cleanliness**:
   - Run `ls -la ~/.config/Nexus` -> confirm "No such file or directory".
   - Run `ls -la ~/.config/nexus` -> confirm `SingletonLock`, `tabs.json`, `history.json`, `theme.json`, `models.json`, `providers.json`, `interface-settings.json`.
2. **`npm run dev` Mirroring**:
   - Run `npm run dev`.
   - Verify all 9 tabs load immediately.
   - Open History drawer -> confirm all 65 conversations are present.
   - Verify webview logins remain active without sign-in prompts.
3. **Emergency Restore Drill**:
   - Intentionally delete `tabs.json` while keeping `tabs.json.bak`.
   - Launch app -> confirm tabs successfully recover from `.bak`.
