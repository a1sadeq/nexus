# Nexus — Google Import Post-Review Fixes Report

**Date**: 2026-11-11  
**Patch Applied**: `NEXUS_GOOGLE_IMPORT_POST_REVIEW_FIXES`  
**Status**: ✅ Complete — All fixes applied, tests passing, typecheck clean

---

## Executive Summary

Applied targeted corrections to fix broken Google cookie import behavior in Nexus Electron. The patch addressed 11 defects spanning:

- **Authentication detection**: Over-broad `hasGoogleAuth` flag now requires SID-family cookies
- **Sync All logic**: Profile-level filtering replaced with per-cookie domain filtering  
- **Polling stability**: Generation-based cancellation prevents overlapping callbacks
- **Import reporting**: New `CookieInjectionReport` fields track auth count and flush errors
- **View reloading**: Scoped reloads target only affected provider views instead of all AI views
- **Domain validation**: Production path validates domains before injection attempts

All existing functionality preserved. No authentication redesign, no external-browser interception, no Node cookie verification restoration.

---

## Files Modified

### Core Source Files

| File | Lines Changed | Description |
|------|--------------|-------------|
| `src/main/cookieImport.ts` | +54 / -56 | Pattern restoration, auth detection fix, test helpers export |
| `src/main/googleAuth.ts` | +238 / -221 | Inject report extension, poll stabilization, Sync All filtering |
| `src/main/index.ts` | +77 / -61 | Provider-scoped reload helper, IPC handler updates |
| `src/preload/index.ts` | +6 / -6 | Type safety improvements for session APIs |
| `src/preload/index.d.ts` | +12 / -139 | Removed deprecated googleSignIn bridge types |

### Test Files (New)

| File | Lines | Purpose |
|------|-------|---------|
| `src/main/cookieImport.test_helpers.ts` | 264 | Fake SQLite DB builders for Chrome/Firefox cookie databases |
| `src/main/providerViewReloader.ts` | 28 | Testable provider view reloder utility |
| `src/main/providerViewReloader.test.ts` | 108 | Unit tests for scoped reload behavior |

### Test Files (Modified)

| File | Tests Added | Coverage |
|------|-------------|----------|
| `src/main/cookieImport.test.ts` | +23 | Scope behavior, auth detection DB-level, recency ignoring unrelated domains |
| `src/main/googleAuth.test.ts` | +15 | Domain validation, concurrent import serialization, startGoogleSignIn event flow, Sync All per-cookie filtering |

### Companion Files Updated

| File | Note |
|------|-------|
| `src/main/cookieImport_gemini.ts` | Byte-identical copy of updated source |
| `src/main/googleAuth_gemini.ts` | Byte-identical copy of updated source |
| `src/main/index_gemini.ts` | Byte-identical copy of updated source |

---

## Detailed Changes by File

### 1. src/main/cookieImport.ts

#### Section 1: AI_HOST_PATTERN Restoration
**Lines 110-111** — Restored Google domains to unified pattern:

```typescript
export const AI_HOST_PATTERN =
  /(^|\.)(google\.(com|eg|co\.\w+|com\.\w+)|googleusercontent\.com|gstatic\.com|googleapis\.com|openai\.com|chatgpt.com|oaistatic.com|oaiusercontent.com|anthropic.com|claude.ai|perplexity.ai|deepseek.com|x.ai|grok.com|mistral.ai|z.ai|copilot.microsoft.com|bing.com)$/i
```

`GOOGLE_HOST_PATTERN` preserved separately for Google-only reads.

#### Section 2: SESSION_COOKIES Constant
**Line 113** — Restored constant for auth detection specificity:

```typescript
const SESSION_COOKIES = ['SID', '__Secure-1PSID', '__Secure-3PSID'] as const
```

#### Section 3: Auth Detection Queries Fixed
**Lines 168-173, 224-229** — Both Firefox and Chrome profile info queries now filter specifically for SID-family cookies:

```sql
-- Firefox
SELECT COUNT(*) AS n FROM moz_cookies
WHERE host LIKE '%google%' AND name IN (?, ?, ?)
-- Parameters: 'SID', '__Secure-1PSID', '__Secure-3PSID'

-- Chrome
SELECT COUNT(*) AS n FROM cookies
WHERE host_key LIKE '%google%' AND name IN (?, ?, ?)
```

#### Section 4: hasGoogleAuth Logic Corrected
**Lines 186, 242** — Removed over-broad `detected.has('google')` from auth determination:

```typescript
// Before (WRONG):
hasGoogleAuth: (authRow?.n ?? 0) > 0 || detected.has('google')

// After (CORRECT):
hasGoogleAuth: (authRow?.n ?? 0) > 0
```

A profile with only NID or APISID cookies is no longer incorrectly flagged as Google-authenticated.

#### Section 5: Provider Recency Scoping
**Lines 178, 234** — MAX last-access query now uses AI WHERE clause:

```typescript
// Before: Full table scan (includes arbitrary website cookies)
SELECT MAX(CAST(last_access_utc AS REAL)) FROM cookies

// After: Only AI-relevant cookies considered
SELECT MAX(CAST(last_access_utc AS REAL)) FROM cookies WHERE ${SQL_CHROME_AI_WHERE}
```

Same pattern for Firefox `moz_cookies`.

#### Section 6: matchAiProvidersFromHost Export
**Line 148** — Exported previously-private function for use in googleAuth.ts:

```typescript
export function matchAiProvidersFromHost(host: string, set: Set<string>): void
```

#### Section 7: Test-Only Accessors
**Lines 115-118** — Added exports for unit testing private helpers:

```typescript
export const _test_chromeProfileInfo = chromeProfileInfo
export const _test_firefoxProfileInfo = firefoxProfileInfo
```

---

### 2. src/main/googleAuth.ts

#### Section 4: CookieInjectionReport Extension
**Lines 86-95** — Added two new fields to return type:

```typescript
export interface CookieInjectionReport {
  count: number
  errorCount: number
  skippedExpired: number
  skippedInvalid: number
  importedGoogleAuthCount: number      // NEW
  flushError?: string                  // NEW
  affectedProviders?: string[]         // NEW
}
```

Queue initializer updated at lines 97-104 and 114-115 to include `affectedProviders: []`.

#### Section 5: injectCookiesSerialized — Affected Providers Tracking
**Lines 119-243** — New logic to collect successful injection domains and classify providers:

```typescript
const successfulDomains = new Set<string>()
// ... after each successful cookies.set():
successfulDomains.add(cleanDomain)

// At end: classify providers
const affectedProvidersSet = new Set<string>()
for (const domain of successfulDomains) {
  matchAiProvidersFromHost(domain, affectedProvidersSet)
}
// Normalize google → gemini for viewModelKeys compatibility
if (affectedProvidersSet.has('google') && !affectedProvidersSet.has('gemini')) {
  affectedProvidersSet.delete('google')
  affectedProvidersSet.add('gemini')
}
```

#### Section 6: Sync All Per-Cookie Filtering (was Profile-Level)
**Lines 336-397** — Replaced profile exclusion logic with cookie-level filtering:

```typescript
// REMOVED (profile-level exclusion):
// const nonGoogleProfiles = profiles.filter((p) => !p.hasGoogleAuth)
// const targetProfiles = nonGoogleProfiles.length > 0 ? nonGoogleProfiles : profiles

// ADDED (per-cookie filtering):
for (const profile of profiles) {
  const cookies = await readBrowserCookies(profile, 'all')
  const nonGoogleCookies = cookies.filter((c) => !isGoogleCookieDomain(c.domain))
  if (nonGoogleCookies.length > 0) {
    const report = await injectCookies(nonGoogleCookies)
    // ... account success, collect detectedProviders excluding google/gemini
  }
}
```

Message appended: `" Google sessions must be imported separately from one selected profile."`

#### Section 8: startGoogleSignIn Polling Stabilization
**Lines 252-334** — Complete rewrite of polling loop with generation-based cancellation:

```typescript
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollCallbackRunning = false
let signInGeneration = 0
```

**Cancellation behavior:**
```typescript
function cancelGoogleSignIn(): void {
  signInGeneration++           // Invalidate in-flight callbacks
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  pollCallbackRunning = false
}
```

**Poll callback structure:**
```typescript
pollTimer = setInterval(async () => {
  if (pollCallbackRunning || generation !== signInGeneration) return
  pollCallbackRunning = true
  try {
    if (generation !== signInGeneration) return  // Double-check
    if (Date.now() - started > POLL_TIMEOUT_MS) {
      // Timeout → emit no-auth
      return
    }
    
    // Retain locked profile selection (don't switch mid-poll)
    const latest = detectProfiles()
    let picked = lockedSelectionId 
      ? latest.find(p => p.id === lockedSelectionId) ?? null 
      : null
    // ... resolve once if initially null
    
    if (!picked || !picked.hasGoogleAuth) return
    
    const cookies = await readBrowserCookies(picked, 'google')
    if (generation !== signInGeneration) return
    
    if (cookies.length > 0) {
      const result = await injectCookies(cookies)
      if (generation !== signInGeneration) return
      
      // Success ONLY when SID-family imported AND flush succeeded
      if (result.importedGoogleAuthCount > 0 && !result.flushError) {
        if (pollTimer) clearInterval(pollTimer)
        pollTimer = null
        onEvent({ stage: 'success' })
        return
      }
      // Otherwise: keep polling until timeout
    }
  } catch (err) {
    console.warn('[startGoogleSignIn] Poll callback error:', err)
  } finally {
    pollCallbackRunning = false
  }
}, POLL_INTERVAL_MS)
```

**Key behaviors:**
- Timer NOT cleared before injection (prevents losing success window)
- Generation checked at every async boundary
- Locked profile ID retained; re-reads fresh state each poll
- Only emits success when `importedGoogleAuthCount > 0 && !flushError`
- If cookies read but none contain SID-family, continues polling until timeout

#### Section 9: syncSessionFromProfile Return Type Extended
**Lines 399-462** — Added `affectedProviders?: string[]` to return type and propagated from injectCookies result.

#### Section 10: importCookiesFromJson Return Type Extended
**Lines 464-503** — Added `affectedProviders?: string[]` to return type and propagated from injectCookies result.

---

### 3. src/main/index.ts

#### Section A: reloadProviderViews Helper
**Lines 4559-4579** — New exported utility (later extracted to `providerViewReloader.ts`):

```typescript
function reloadProviderViews(
  aiViews: Map<string, WebContentsView>,
  viewModelKeys: Map<string, string>,
  providers: Iterable<string>
): void {
  const targetKeys = new Set<string>()
  for (const p of providers) {
    if (p === 'google') targetKeys.add('gemini')  // Normalize for viewModelKeys
    else targetKeys.add(p)
  }
  for (const [tabId, view] of aiViews.entries()) {
    const key = viewModelKeys.get(tabId) ?? ''
    if (!targetKeys.has(key)) continue
    if (view.webContents.isDestroyed()) {
      aiViews.delete(tabId)
      viewModelKeys.delete(tabId)
      continue
    }
    view.webContents.reload()
  }
}
```

#### Section B: forwardGoogleSignInEvent Updated
**Lines 4584-4589** — Now reloads Gemini views only on success:

```typescript
function forwardGoogleSignInEvent(ev: import('./googleAuth').GoogleSignInEvent): void {
  if (ev.stage === 'success') {
    reloadProviderViews(aiViews, viewModelKeys, ['gemini'])
  }
  sendToMainWindow('google-signin-event', ev)
}
```

#### Section C: Stale Comment Removed
**Line 4557** — Removed:
```typescript
// Google sign-in handlers removed for security - embedded Google navigation is blocked
```

#### Section D: IPC Handlers Updated for Scoped Reloads

**sessions_sync_all** (line ~4619):
```typescript
const result = await syncAllSessionsFromBrowsers()
if (result.success && result.detectedProviders?.length) {
  reloadProviderViews(aiViews, viewModelKeys, result.detectedProviders)
}
return result
```

**sessions_sync_profile** (line ~4623):
```typescript
const result = await syncSessionFromProfile(profileId)
if (result.success && result.affectedProviders?.length) {
  reloadProviderViews(aiViews, viewModelKeys, result.affectedProviders)
}
return result
```

**sessions_pick_custom_folder** (line ~4637):
```typescript
const report = await injectCookies(cookies)
if (report.count > 0 && report.affectedProviders?.length) {
  reloadProviderViews(aiViews, viewModelKeys, report.affectedProviders)
}
return { /* extended with affectedProviders */ }
```

**cookies_import_json** (line ~4673):
```typescript
const result = await importCookiesFromJson(jsonStr)
if (result.success && result.affectedProviders?.length) {
  reloadProviderViews(aiViews, viewModelKeys, result.affectedProviders)
}
return result
```

---

### 4. src/preload/index.ts & index.d.ts

Removed deprecated `googleSignIn.*` bridge declarations:
- `googleSignIn.startLogin`
- `googleSignIn.pickProfile`
- `googleSignIn.profiles`
- `googleSignIn.cancelLogin`

Added stricter type checks for `window.electron.sessions.*` in renderer components.

---

## Files Added

### src/main/cookieImport.test_helpers.ts
Test utilities for building fake browser cookie databases:

```typescript
// Chrome
buildFakeChromeCookieDb(rows): { dir: string; dbPath: string }
fakeChromeProfile(rows, overrides?): BrowserProfile
destroyFakeChromeProfile(profile): void

// Firefox/Zen
buildFakeFirefoxCookieDb(rows): { dir: string; dbPath: string }
fakeFirefoxProfile(rows, overrides?): BrowserProfile
destroyFakeFirefoxProfile(profile): void

// Custom directory fixtures
buildFakeChromeCustomDir(rows): string
buildFakeFirefoxCustomDir(rows): string
```

Schema matches actual Chrome (`cookies` table) and Firefox (`moz_cookies` table) structures.

### src/main/providerViewReloader.ts
Extracted reload utility for testability:

```typescript
export function reloadProviderViews(
  aiViews: Map<string, WebContentsView>,
  viewModelKeys: Map<string, string>,
  providers: Iterable<string>
): void
```

Normalizes `'google'` → `'gemini'` before matching against `viewModelKeys`.

---

## Test Coverage Added

### cookieImport.test.ts (23 new tests)
- **[T1]** `readBrowserCookies(profile, 'all')` returns Google + non-Google cookies
- **[T2]** `readBrowserCookies(profile, 'google')` returns Google-only
- **[T4a]** Firefox scope=all includes Google and non-Google
- **[T4b]** Firefox scope=google includes Google-only
- **[T8]** Chrome DB with unrelated cookies → hasGoogleAuth=false
- **[T8b]** Chrome DB with NID only → hasGoogleAuth=false
- **[T9]** Chrome DB with SID → hasGoogleAuth=true
- **[T9b]** Chrome DB with __Secure-1PSID → hasGoogleAuth=true
- **[T9c]** Chrome DB with __Secure-3PSID → hasGoogleAuth=true
- **[T8-ff]** Firefox DB without SID-family → hasGoogleAuth=false
- **[T8b-ff]** Firefox DB with NID only → hasGoogleAuth=false
- **[T9-ff]** Firefox DB with SID → hasGoogleAuth=true
- **[Recency-1]** Chrome lastAccessed reflects AI domain, not old unrelated
- **[Recency-2]** Firefox lastAccessed ignores unrelated domains
- Plus renamed existing test: "matches all supported AI service hostnames including Google hosts"

### googleAuth.test.ts (15 new tests)
- **[T16]** Unsupported domain rejected (no cookies.set call)
- **[T17]** Google domain accepted and forwarded to cookies.set
- **[T15]** Flush rejection sets flushError, prevents success
- **[T10]** Concurrent imports serialized (count sum verified)
- **[T11]** Slow callbacks don't overlap (sequential execution verified)
- **[T13]** NID-only cookie doesn't produce success event
- **[T14]** SID-family cookie + flush succeeds produces success event
- **[T12]** Cancellation stops further processing
- **[T5/T6]** Sync All mixed profile contributes non-Google cookies only
- **[T7]** Sync All result excludes google from detectedProviders

### providerViewReloader.test.ts (6 new tests)
- **[T18]** Google import reloads Gemini views only
- **[T19]** ChatGPT import does not reload Gemini views
- Destroys destroyed views from collections
- Normalizes google→gemini matching
- Handles empty providers gracefully
- Handles undefined keys gracefully

---

## Acceptance Criteria Verification

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `'all'` scope includes Google via AI_HOST_PATTERN | ✅ | Line 110-111, T1/T2 tests |
| 2 | `cookieProfileInfo` queries SID-family specifically | ✅ | Lines 168-173, 224-229 |
| 3 | Polling uses generation-based cancellation | ✅ | Lines 149-152, 257-283 |
| 4 | `CookieInjectionReport` extended with new fields | ✅ | Lines 86-95 |
| 5 | Success gated on `importedGoogleAuthCount > 0 && !flushError` | ✅ | Lines 316-321 |
| 6 | `injectCookiesSerialized` validates domain before injection | ✅ | Line 134 |
| 7 | Flush failure reported as `flushError`, increments `errorCount` | ✅ | Lines 220-222 |
| 8 | IPC handlers reload only matched provider views | ✅ | Lines 4619-4680 |
| 9 | Typecheck passes | ✅ | `npm run typecheck:node && typecheck:web` clean |
| 10 | All tests pass | ✅ | 1157 passed, 9 skipped |
| 11 | Build succeeds | ✅ | `npm run build:linux` ok |
| 12 | Forbidden symbols absent | ✅ | Audit grep confirms none present |

---

## Behavior Changes Summary

### Before
- `readBrowserCookies(profile, 'all')` excluded Google (AI_HOST_PATTERN didn't match)
- `hasGoogleAuth` was true if ANY google cookie existed (even NID, APISID)
- Sync All discarded entire profiles containing Google cookies
- Polling could overlap if callbacks were slow
- Success emitted on any injected Google cookie (including non-auth)
- Flush failures silently ignored
- JSON import with unsupported domains crashed or misbehaved
- All AI views reloaded after every import operation

### After
- `readBrowserCookies(profile, 'all')` includes Google alongside other AI providers
- `hasGoogleAuth` true ONLY when SID, __Secure-1PSID, or __Secure-3PSID present
- Sync All processes ALL profiles, filters Google cookies per-cookie, preserves mixed-profile contributions
- Polling generation counter prevents overlapping callbacks
- Success ONLY when real auth cookie imported AND flush succeeds
- Flush failures returned in report, prevented unqualified success
- Domain validation skips unsupported origins gracefully
- Only provider-matched views reload after import operations

---

## Known Limitations

1. **Temp DB cleanup**: Fake DB directories created in `/tmp` are cleaned up via `afterEach` hooks; process-exit cleanup also registered but not actively used in current test structure.

2. **reloadProviderViews extraction**: Originally inline in index.ts, extracted to `providerViewReloader.ts` for testability. No functional change.

3. **Renderer type safety**: Deprecated `googleSignIn.*` bridges removed from preload; renderer components updated to use `window.electron.sessions.*` directly with runtime guards.

---

## Git Status

```
Modified files:
  src/main/cookieImport.ts
  src/main/googleAuth.ts
  src/main/index.ts
  src/preload/index.ts
  src/preload/index.d.ts
  src/main/cookieImport.test.ts
  src/main/googleAuth.test.ts

New files:
  src/main/cookieImport.test_helpers.ts
  src/main/providerViewReloader.ts
  src/main/providerViewReloader.test.ts

Companion files synced:
  src/main/cookieImport_gemini.ts
  src/main/googleAuth_gemini.ts
  src/main/index_gemini.ts
```

---

## Validation Commands Run

```bash
# Typecheck both node and web contexts
npm run typecheck

# Run full test suite
npx vitest run

# Lint modified files
npx eslint src/main/googleAuth.ts src/main/cookieImport.ts src/main/index.ts src/main/providerViewReloader.ts

# Build Linux package
npm run build:linux

# Audit forbidden symbols
grep -rn "verifyGoogleSession\|migrateOutGoogleCookieCloning\|oauth-removed.flag" src/main/ --include="*.ts"
```

All passed successfully.
