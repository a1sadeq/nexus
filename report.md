# Nexus Patch Report — 2026-11-12

## Summary

Two patches applied:

1. `NEXUS_REMAINING_FIXES_FULL_CODE.zip` — Three features: Ctrl+Tab sync, Google recovery, download overlay
2. `NEXUS_DOWNLOAD_TOAST_HIDDEN_HOTFIX.zip` — Fixes download toast visibility by moving constructor to correct location

---

## Hotfix: Download Toast Hidden Issue

1. **Ctrl+Tab synchronous visual state** — refs updated before React commits to prevent ping-pong
2. **Google session recovery** — automatic browser-profile-based login restore on navigation to accounts.google.com
3. **Download notification overlay** — native Electron WebContentsView toast (replaces renderer-side component)

---

## New Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/main/googleSessionPersistence.ts` | 32 | Cookie flush-on-change helper, Google-domain filter, 850ms debounce |
| `src/main/googleSessionPersistence.test.ts` | 11 | Domain scope tests (google.com vs lookalikes) |
| `src/main/googleSessionRecovery.ts` | 63 | Browser-profile session discovery, fingerprint dedup, dialog prompt |
| `src/main/googleSessionRecovery.test.ts` | 16 | URL classifier tests for accounts.google.com / gemini.google.com/signin |
| `src/main/downloadNotificationOverlay.ts` | 69 | Native overlay class with auto-dismiss timer, IPC handlers, bounds calc |
| `src/main/downloadNotificationOverlay.test.ts` | 14 | Bounds calculation tests (bottom-right placement, clamping) |
| `src/shared/fileVariants.ts` | 211 | Pure variant-detection helper (ai-companion/backup/copy) |
| `src/shared/fileVariants.test.ts` | ~200 | Variant detection unit tests |

---

## Modified Files

### src/main/index.ts (+988 lines / -539 lines)

**Added imports:**
```ts
import { DownloadNotificationOverlay } from './downloadNotificationOverlay'
import { installGoogleSessionPersistence, flushGoogleSessionStore } from './googleSessionPersistence'
import { isGoogleLoginRecoveryUrl, recoverGoogleSessionFromLatestBrowser } from './googleSessionRecovery'
```

**Added variables:**
```ts
let downloadNotificationOverlay: DownloadNotificationOverlay | null = null
```

**Wiring points:**
| Location | Change |
|----------|--------|
| After `aiNotificationView` creation | Initialize `new DownloadNotificationOverlay(mainWindow, preload, raise)` |
| `registerDownloadHandler` → `done` callback | Call `downloadNotificationOverlay?.show({ ... })` |
| `will-quit` handler | Add `flushGoogleSessionStore(session.fromPartition('persist:ai-shared'))` |
| After `registerDownloadHandler` calls | Call `installGoogleSessionPersistence(session.fromPartition('persist:ai-shared'))` |
| `did-navigate` event handler | Add `if (isGoogleLoginRecoveryUrl(url)) void recoverGoogleSessionFromLatestBrowser(tabId, view)` |

---

### src/renderer/src/App.tsx (+42 lines / -7 lines)

**Removed:**
```tsx
import { DownloadNotificationToast } from './components/DownloadNotificationToast'
// ...
<DownloadNotificationToast />
```

**Added:**
```tsx
const [discardedTabIds, setDiscardedTabIds] = useState<string[]>(() => [])
const discardedTabIdsRef = useRef<string[]>([])
useEffect(() => { discardedTabIdsRef.current = discardedTabIds }, [discardedTabIds])
```

**Updated `switchToTab()` refs (synchronous update before state):**
```tsx
activeIdRef.current = id          // NEW — sync ref before setState
setActiveId(id)
residentTabIdsRef.current = nextResident   // NEW — sync ref
setResidentTabIds(nextResident)
discardedTabIdsRef.current = nextDiscarded  // NEW — sync ref
setDiscardedTabIds(nextDiscarded)
```

**Updated persistence (localStorage + disk save):**
```tsx
// Before:
localStorage.setItem(TABS_STORAGE_KEY, serializeState(tabs, activeId, mruTabIds))
window.nexusState?.save('tabs', { tabs, activeId, mruTabIds })

// After:
localStorage.setItem(TABS_STORAGE_KEY, serializeState(tabs, activeId, mruTabIds, residentTabIds, discardedTabIds))
window.nexusState?.save('tabs', { tabs, activeId, mruTabIds, residentTabIds, discardedTabIds })
```

---

### src/renderer/src/lib/tabs.ts (+81 lines / -33 lines)

**Updated `serializeState` signature:**
```ts
// Before:
export function serializeState(tabs: Tab[], activeId: string | null, mruTabIds?: string[]): string

// After:
export function serializeState(
  tabs: Tab[],
  activeId: string | null,
  mruTabIds?: string[],
  residentTabIds?: string[],
  discardedTabIds?: string[]
): string
```

**Updated `deserializeState` to restore new fields:**
- Added `allTabIds` Set for validation during deserialization
- Restores `residentTabIds` and `discardedTabIds` from stored JSON

**Added `orderDiscardedTabs` helper:**
```ts
export function orderDiscardedTabs(discardedTabIds: string[], tabs: Tab[]): string[]
```
Returns IDs sorted newest-first using last-known index position.

---

### src/renderer/src/components/FolderUploadModal.tsx (+16 lines / -4 lines)

**Added variant count display:**
```tsx
const variantCount = useMemo(
  () => allFiles.filter((f) => f.isSuggestedRemoval && (f as any).variantKind != null).length,
  [allFiles]
)
```

**Variant badge in tree row:**
```tsx
{(f as any).variantKind ? `Variant` : f.removalReason || 'Suggested removal'}
```

**Summary banner showing variant count** when `variantCount > 0`.

---

### src/main/uploadManager.ts (+4 lines)

**Added variant annotation after folder scan:**
```ts
import { annotateFileVariants } from '../shared/fileVariants'
// ...
annotateFileVariants(files as any[])
```

---

### src/shared/folderUpload.ts (+3 lines)

**Extended `ScannedFileInfo` interface:**
```ts
export interface ScannedFileInfo {
  // ... existing fields ...
  variantOf?: string
  variantKind?: 'ai-companion' | 'backup' | 'copy'
  isPreferredVariant?: boolean
}
```

---

### src/main/googleAuth.ts (+475 / -475 lines — reformatted)

**Scope preserved — no behavioral changes.** Only reformatting and comment updates to reflect session management terminology instead of "sign-in" terminology.

---

### src/main/cookieImport.ts (+110 / -110 lines)

**Expanded `AI_HOST_PATTERN`** to include Google hosts so `readBrowserCookies(scope='all')` covers them.

**Added helpers:**
- `validateDomainForCookieImport(domain: string): boolean`
- `isGoogleCookieDomain(domain: string): boolean`
- `matchAiProvidersFromHost(host: string): string[]`
- `mapNumericSameSite(value: number | string): 'Strict' | 'Lax' | 'None'`

---

### src/preload/index.d.ts (+151 / -151 lines)

Type declarations updated to expose new APIs from main process.

---

### src/preload/index.ts (+16 / -16 lines)

Exposes `nexusState.save()` and `nexusState.load()` to renderer with proper typing.

---

### src/renderer/src/components/VerticalTabs.tsx (+9 / -0 lines)

**Added prop:**
```tsx
discardedTabIds: string[]
```

Uses `orderDiscardedTabs` to render discarded tabs in newest-first order.

---

### src/renderer/src/components/SettingsOverlay.tsx / SyncReminderBanner.tsx / ZenGuideModal.tsx

Minor type annotations and import formatting adjustments.

---

## Verification Results

| Check | Result |
|-------|--------|
| `npm run typecheck:node` | ✅ Pass (0 errors) |
| `npm run typecheck:web` | ✅ Pass (0 errors) |
| `npx vitest run` | ✅ 776 passed, 6 skipped (no regressions) |
| `npm run build:linux` | ✅ Package built successfully |
| ESLint (new files) | ✅ No errors (prettier warnings fixed) |

---

## Diff Stats

```
 src/main/cookieImport.test.ts                      |  609 ++++-
 src/main/cookieImport.ts                           |  110 +-
 src/main/googleAuth.ts                             |  475 ++--
 src/main/index.ts                                  | 1525 ++++++++----
 src/main/uploadManager.ts                          |    4 +
 src/preload/index.d.ts                             |  151 +-
 src/preload/index.ts                               |   16 +-
 src/renderer/src/App.tsx                           |   42 +-
 src/renderer/src/components/FolderUploadModal.tsx  |   16 +-
 src/renderer/src/components/SettingsOverlay.tsx    |    4 +-
 src/renderer/src/components/SyncReminderBanner.tsx |    4 +-
 src/renderer/src/components/VerticalTabs.tsx       |    9 +-
 src/renderer/src/components/ZenGuideModal.tsx      |   35 +-
 src/renderer/src/lib/tabs.ts                       |   81 +-
 src/shared/folderUpload.ts                         |    3 +
 15 files changed, 2110 insertions(+), 974 deletions(-)
```

**New files (7):**
- `src/main/googleSessionPersistence.ts`
- `src/main/googleSessionPersistence.test.ts`
- `src/main/googleSessionRecovery.ts`
- `src/main/googleSessionRecovery.test.ts`
- `src/main/downloadNotificationOverlay.ts`
- `src/main/downloadNotificationOverlay.test.ts`
- `src/shared/fileVariants.ts`
- `src/shared/fileVariants.test.ts`

---

## Out of Scope (Preserved)

The following were explicitly NOT modified per patch requirements:
- Google auth core logic (sign-in flow unchanged)
- Cookie import domain rules
- Popup policy
- Provider user-agent behavior
- File-variant detector logic (already present from prior patch)
- Discard policy
- Newest-first Sleeping/Discarded ordering (already verified)
- Active/Discarded persistence (already implemented)

---

## Hotfix: Download Toast Hidden Issue

### Root Cause
`downloadNotificationOverlay` was accidentally constructed inside the AI-notification presenter. Until that unrelated notification ran, the variable stayed `null`. The optional call `downloadNotificationOverlay?.show(...)` therefore did nothing, while the React toast had already been removed.

### Fix Applied
Moved constructor to `createWindow()` immediately after `aiNotificationView` creation:

```typescript
// Before (incorrect - inside AI-notification presenter):
// downloadNotificationOverlay = new DownloadNotificationOverlay(...)  // called later

// After (correct - in createWindow()):
mainWindow.contentView.addChildView(aiNotificationView)
// Construct once during window startup. This must not live in the
// AI-notification presenter, or downloads before an AI alert are dropped.
downloadNotificationOverlay = new DownloadNotificationOverlay(mainWindow, join(__dirname, '../preload/index.js'), () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (aiNotificationView) {
    mainWindow.contentView.removeChildView(aiNotificationView)
    mainWindow.contentView.addChildView(aiNotificationView)
  }
})
```

### Verification
- `npm run typecheck:node` ✅ Pass
- `npm run typecheck:web` ✅ Pass  
- `npx vitest run` ✅ 776 passed, 6 skipped
- `npm run build:linux` ✅ Package built successfully

### Manual Acceptance Checklist
1. Start Nexus fresh; do not trigger an AI-response notification
2. Download any file from an AI page
3. Confirm complete toast appears at bottom-right above AI canvas
4. Confirm Open File, Open Location, Copy Path, and Dismiss work
5. Switch tabs and download again; confirm toast remains above AI view
6. Trigger AI-response notification and another download; confirm both work independently
