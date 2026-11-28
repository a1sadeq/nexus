import './bootstrap'
import { DownloadNotificationOverlay } from './downloadNotificationOverlay'
import {
  installGoogleSessionPersistence,
  flushGoogleSessionStore
} from './googleSessionPersistence'
import {
  recoverGoogleSessionFromLatestBrowser,
  reloadGuard
} from './googleSessionRecovery'
import { spawn } from 'child_process'
import { AutoUpdateService, type UpdateEngine } from './autoUpdateService'
import { supportsAutomaticUpdates } from './autoUpdatePlatform'
import { NavigationIntentTracker, sameSiteUrl } from './navigationIntent'
import { createNavTrace, describeLoadError, describeLoadFailure } from './navTrace'
import {
  shouldDefend,
  tapNavigationSurface,
  type NavigationSurface
} from './navigationTap'
import type { UpdateStatus } from '../shared/updateStatus'
import {
  app,
  shell,
  BrowserWindow,
  screen,
  clipboard,
  ipcMain,
  session,
  WebContentsView,
  protocol,
  webContents as electronWebContents,
  Tray,
  Menu,
  globalShortcut,
  dialog,
  Notification,
  nativeTheme,
  powerMonitor
} from 'electron'
import {
  DEFAULT_THEME_APPEARANCE,
  isValidThemeAppearance,
  resolveEffectiveColorScheme,
  applyColorSchemeEmulation,
  type ThemeAppearance
} from './nativeThemeAppearance'
import { join, basename, extname } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, copyFileSync } from 'fs'
import { buildEngine } from './promptNav'
import {
  buildFeatureHookEvidenceScript,
  type collectFeatureHookEvidence
} from './featureHookEvidence'
import { executeHookCapture, hookContextId } from './featureHookCapture'
import { parseFeatureHookImport } from '../shared/featureHookImport'
import { TabDiscardManager, type DiscardableView, isUsableRestoreUrl } from './tabDiscardManager'
import { closeWebContents } from './webContentsLifecycle'
import { chromeCompatibleUserAgent, linuxDisplaySwitches, windowChrome } from './platformConfig'
import { PreviewCaptureLoop } from './previewCaptureLoop'
import { buildProviderMotionScript } from './providerMotion'
import { ActiveTitleSync, buildActiveTitleReadScript } from './activeTitleSync'
import {
  getCustomThemeEntry,
  saveCustomThemeEntry,
  removeCustomThemeEntry
} from './customThemesStore'
import { PROVIDER_THEMES, mergeOverrides, getStructuralVars, ambientAuraCss } from './providerThemes'
import {
  type ProviderOverrides,
  getMergedProviderFeatures,
  DEFAULT_BUILTIN_PROVIDER_CONFIG,
  migrateLegacyArenaFeatures
} from '../shared/providerConfig'
import { splitSelectorList } from '../shared/selectorUtils'
import { cleanConversationTitle, isDefaultConversationTitle } from '../shared/titleUtils'
import { consolidateLegacyConfigDir } from './migrations/consolidateLegacyConfigDir'
import { registerStateIpc, trustWindow } from './stateIpc'
import { atomicWriteJson } from './atomicWrite'
import { scheduleStartupAndExitPruning, getCacheStats, pruneAppCaches } from './cachePruningManager'
import {
  captureDiagnosticReport,
  saveDiagnosticsToFile,
  type ViewContextInfo
} from './diagnosticsManager'
import {
  injectAiStatusObserver,
  attachAiStatusListener,
  isSnippetAwaitingInput
} from './aiStatusObserver'
import {
  type AiLifecycleStatus,
  type TabAiLifecycleState,
  type AiLifecycleStatusUpdate,
  isProtectedLifecycleStatus,
  isNotifiableCompletion,
  shouldDeduplicateCompletion,
  ACTIVE_TAB_DONE_LINGER_MS,
  VISITED_DONE_LINGER_MS
} from '../shared/aiLifecycle'
import { AiToastManager } from './aiToastManager'
import { formatDuration, formatNotificationContent, modelLabel } from '../shared/notificationContent'
import { createNotificationRecorder } from './notificationDiagnostics'
import {
  applyNotificationPreferenceChange,
  loadNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences
} from './notificationPreferences'

// Page-side helpers embedded into every injected script. Built from the tested
// shared source via toString() — self-contained, no closures.
const PAGE_HELPERS = `
  const splitList = ${splitSelectorList.toString()};
  const visibleEl = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
`
import { nextThemeSwap } from './themeSwap'
import { skillsEngine, type SkillDef } from './skillsEngine'
import {
  syncAllSessionsFromBrowsers,
  syncSessionFromProfile,
  hasGoogleSessionInNexus,
  importCookiesFromJson,
  injectCookies,
  listProfiles,
  startGoogleSignIn,
  cancelGoogleSignIn
} from './googleAuth'
import { closeInAppSignInWindow, openInAppSignInWindow } from './googleSignInWindow'
import { NATIVE_ELECTRON_UA } from './electronIdentity'
import {
  configureProviderHosts,
  configureUserAgents,
  desiredIdentityFor,
  forgetNativeIdentity,
  hasNativeIdentity,
  identityReason,
  markChromeIdentity,
  markNativeIdentity,
  resolveIdentityForRequest,
  syncIdentity
} from './webIdentity'
import { applyUserAgentOverCdp } from './identitySwitch'
import { GoogleAccountStore, partitionForAccount } from './googleAccounts'
import {
  ContainerStore,
  DEFAULT_CONTAINER_ID,
  containerForShortcutDigit,
  containerPartition
} from './containers'
import {
  clearGoogleSessionCookies,
  reconnectAccount,
  reconnectTargetFor
} from './accountReconnect'
import { isThirdPartyAuthPage } from './loginWall'
import {
  armWatchdog,
  createWatchdogState,
  disarmWatchdog,
  isWatchdogOverdue
} from './overlayWatchdog'
import { join as joinPath } from 'path'
import { reloadProviderViews } from './providerViewReloader'
import { readCookiesFromCustomDirectory } from './cookieImport'
import {
  handleFolderUpload,
  handleFileUpload,
  bundleAndInjectSelectedFiles,
  generateBundleTextAsync,
  partitionCodebaseFiles,
  uploadChunksSequentially,
  attachChunksAsOneMessage,
  handleFilesUpload,
  recoverAbandonedPicker,
  splitSelectionByDelivery
} from './uploadManager'
import { cleanupAllUploadTempDirs, cleanupStaleUploadTempDirs } from './uploadAttachAll'
import { forceViewRepaint } from './viewRepaint'
import { classifySurfaceReturn } from './surfaceReturn'
import { repairViewSurface, SurfaceRepairPolicy } from './viewSurface'
import { decideResumeSurfaceAction } from './surfaceResume'
import { VideoJobManager } from './videoJob'
import { sweepStaleJobDirs } from './videoPrepare'
import { locateMediaTools } from './videoProbe'
import { OfficeJobManager } from './officeJob'
import { prepareOfficeDocument } from './officePrepare'
import { prepareOfficeSelection } from './officeBatch'
import type { OfficeConsent } from '../shared/officePreview'
import { sweepStaleConversionDirs } from './officeConvert'
import {
  assessVideoCapability,
  emptyCapabilityStore,
  upsertObservation,
  validateObservation,
  type CapabilityStore
} from '../shared/videoCapability'
import type { VideoPace } from '../shared/videoPlan'
import type { ConfirmFolderUploadPayload, BundleChunk } from '../shared/folderUpload'
import { type CompressionOptions } from '../shared/contextCompressor'
import { projectSnapshotToMarkdown } from '../shared/contextSnapshot'
import {
  buildContextExtractorScript,
  buildSnapshotFromRawPayload,
  type RawExtractionPayload
} from './contextExtraction'

// HW Acceleration is enabled for smooth UX; we offset its 300MB cost via network
// blockers and DOM virtualization on AI tabs.
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// Single-instance: a second launch toggles the existing window instead of
// spawning a duplicate app with broken tab/sidebar state.
// Note: userData and app.name are established synchronously by ./bootstrap above!
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    toggleMainWindow()
  })
}

// Consolidate legacy ~/.config/Nexus safely into ~/.config/nexus (archive-based, zero data loss)
consolidateLegacyConfigDir()

// Register universal file-backed State IPC with the Session Write Barrier
registerStateIpc((key, payload) => {
  if (key === 'pinned' && Array.isArray(payload)) {
    pinnedTabIds.clear()
    for (const id of payload) {
      if (typeof id === 'string') pinnedTabIds.add(id)
    }
    isPinnedInitialized = true
  }
})

let mainWindow: BrowserWindow | null = null

function sendToMainWindow(channel: string, ...args: any[]) {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.webContents &&
    !mainWindow.webContents.isDestroyed()
  ) {
    mainWindow.webContents.send(channel, ...args)
  }
}
const aiViews = new Map<string, Electron.WebContentsView>()
/** One navigation in flight per tab+URL — see navigationIntent.ts for why. */
const navigationIntent = new NavigationIntentTracker()

/**
 * The navigation trace — always recording, optionally printing.
 *
 * Every previous round of "Ctrl+L changes the title but not the page" was diagnosed by reading the
 * console and guessing which line caused which. A load can be aborted by a repair re-attach, a stale
 * activation, a discard, or a second loadURL, and all of them look like `ERR_ABORTED`. Every one of
 * those places now writes here, in order, so the answer is a list and not a guess.
 *
 * `NEXUS_NAV_TRACE=0` turns the printing off (recording continues, the Diagnostics panel needs it);
 * `NEXUS_NAV_TRACE=1` forces it on in a packaged build. In development (`npm run dev`) it is on by
 * default, which is the whole point: the failure is visible while it happens.
 */
const navTrace = createNavTrace({
  verbose: () => {
    const flag = process.env['NEXUS_NAV_TRACE']
    if (flag === '0' || flag === 'off' || flag === 'false') return false
    if (flag === '1' || flag === 'on' || flag === 'true') return true
    return !app.isPackaged
  },
  sink: (line) => console.log(line)
})

/** Record one navigation event. Kept tiny so it can be called from hot paths and catch blocks. */
function traceNav(
  tabId: string,
  kind: Parameters<typeof navTrace.record>[1],
  message: string,
  data?: Record<string, unknown>
): void {
  try {
    navTrace.record(tabId, kind, message, data)
  } catch {
    // A trace must never be the reason a navigation fails.
  }
}

/**
 * A tab's view is about to be attached, detached, hidden or shown. All four can abort a load in flight,
 * which is exactly the kind of thing that used to be invisible: the log said `ERR_ABORTED` and nothing
 * said who did it. Every caller now names itself.
 */
function traceViewOp(tabId: string, op: string, detail?: Record<string, unknown>): void {
  traceNav(tabId, 'view', op, detail)
}

/** Which tab owns a webContents. Used by handlers that only receive the contents (identity repair). */
function tabIdForContents(contents: Electron.WebContents): string {
  try {
    for (const [id, view] of aiViews) {
      if (view.webContents === contents) return id
      if (view.webContents?.id && view.webContents.id === contents.id) return id
    }
  } catch {
    /* the map is being mutated; the trace is not worth a throw */
  }
  return ''
}
/**
 * Repeated repaint requests for a view that is supposed to be on screen mean the cheap repaint is not
 * restoring the surface — the state that used to need a tab close/reopen. See viewSurface.ts.
 */
const surfaceRepair = new SurfaceRepairPolicy()

/**
 * Is this view actually a child of the window right now?
 *
 * `null` means "cannot say" — an older build without `contentView.children`, or a window that is tearing
 * down. Callers treat that as attached: the repair that matters is for a view that is definitely gone,
 * not one that might be.
 */
function isViewAttached(view: Electron.WebContentsView): boolean | null {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return null
    const children = (mainWindow.contentView as unknown as { children?: unknown[] }).children
    if (!Array.isArray(children)) return null
    return children.includes(view)
  } catch {
    return null
  }
}

/** When the active view's surface was last refreshed because the window came back. */
let lastResumeRefreshAt = 0

/**
 * Ask the view itself whether it is really on screen, and put it right if it is not.
 *
 * Everything the app has done about the blank AI view so far has been *assumption*: it sets the view
 * visible and believes it, forces a repaint and believes that too. The build-44 diagnostics show where
 * that ends — the trace is full of `setVisible {visible=true}` and `repaint forced`, and the user is
 * still looking at an empty window. So the app now checks, with the only three facts Electron can give:
 *
 *   `contentView.children.includes(view)` — is the view in the window at all?
 *   `view.getVisible()`                  — does the view think it is showing?
 *   `view.getBounds()`                   — is it where the layout says it should be?
 *
 * Anything that disagrees is fixed on the spot, and every check is traced, so the next diagnostics
 * answers "which of the three was wrong" instead of "the app thought it was fine".
 */
/**
 * How many times this tab's view had to be put back into the window. A tab that needs it repeatedly is
 * not being presented by the window for a reason worth seeing in Diagnostics.
 */
const attachCounts = new Map<string, number>()

function verifyViewPresentation(
  tabId: string,
  view: Electron.WebContentsView,
  reason: string
): { attached: boolean | null; visible: boolean | null; fixed: string[] } {
  const fixed: string[] = []
  let attached: boolean | null = null
  let visible: boolean | null = null

  attached = isViewAttached(view)
  if (attached === false && mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.contentView.addChildView(view)
      attachCounts.set(tabId, (attachCounts.get(tabId) ?? 0) + 1)
      fixed.push('re-attached (it was not in the window)')
      attached = true
    } catch (error) {
      fixed.push(`re-attach failed: ${(error as Error)?.message ?? error}`)
    }
  }

  try {
    visible = view.getVisible?.() ?? null
  } catch {
    visible = null
  }
  if (visible === false) {
    try {
      view.setVisible(true)
      fixed.push('shown again (it was hidden)')
      visible = true
    } catch (error) {
      fixed.push(`show failed: ${(error as Error)?.message ?? error}`)
    }
  }

  const wanted = lastRealBounds.get(tabId)
  if (wanted && wanted.width > 0 && wanted.height > 0) {
    try {
      const actual = view.getBounds()
      if (
        actual.x !== wanted.x ||
        actual.y !== wanted.y ||
        actual.width !== wanted.width ||
        actual.height !== wanted.height
      ) {
        view.setBounds(wanted)
        fixed.push(
          `bounds restored ${actual.width}x${actual.height} → ${wanted.width}x${wanted.height}`
        )
      }
    } catch {
      /* bounds are checked again by the caller's repaint */
    }
  }

  traceViewOp(tabId, 'presentation check', {
    reason,
    attached,
    visible,
    fixed: fixed.length ? fixed.join('; ') : 'none',
    requested: Boolean(wanted)
  })
  return { attached, visible, fixed }
}

/**
 * Ask the page whether it believes it is on screen.
 *
 * The one remaining explanation for "the app says the view is visible and nothing is drawn" is that the
 * page's contents are still in Chromium's *hidden* state: a hidden renderer stops producing frames, and
 * every provider UI paints on requestAnimationFrame, so nothing appears however often the surface is
 * invalidated. That is also why closing an overlay — a hide → show transition the page actually has time
 * to see — fixes the view when a dozen forced repaints did not.
 */
function readPageVisibility(view: Electron.WebContentsView): Promise<string> {
  return new Promise((resolve) => {
    try {
      if (!view || view.webContents.isDestroyed()) return resolve('unknown')
      const result = view.webContents.executeJavaScript('document.visibilityState', true)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        void (result as Promise<unknown>)
          .then((state) => resolve(typeof state === 'string' ? state : 'unknown'))
          .catch(() => resolve('unknown'))
      } else {
        resolve('unknown')
      }
    } catch {
      resolve('unknown')
    }
  })
}

/**
 * A gate for {@link forceViewRepaint}'s flip: resolve once the page has actually seen itself hidden.
 *
 * Polling the page is the only way to know the transition was real. Without it, hide+show inside one turn
 * is a flip the page never observes, which is how every build up to 44 managed to log a visibility flip
 * and leave the user with a blank window.
 */
function pageVisibilityGate(view: Electron.WebContentsView): { waitForPageHidden: (deadlineMs: number) => Promise<boolean> } {
  return {
    waitForPageHidden: async (deadlineMs: number) => {
      const startedAt = Date.now()
      // One turn first: the hide has to be delivered to the renderer before it can report anything.
      while (Date.now() - startedAt < deadlineMs) {
        await new Promise<void>((resolve) => setTimeout(resolve, 30))
        const state = await readPageVisibility(view)
        if (state === 'hidden') return true
        if (state === 'unknown') return false
      }
      return false
    }
  }
}

/**
 * Ask the page whether it believes it is on screen, after a flip has completed.
 *
 * `allowFlip` is what stops this becoming a loop: one extra flip, then the trace reports what the page
 * said and stops.
 */
function probeSurfaceState(
  tabId: string,
  view: Electron.WebContentsView,
  reason: string,
  allowFlip = true
): void {
  if (!view || view.webContents.isDestroyed()) return
  void readPageVisibility(view).then((pageState) => {
    traceViewOp(tabId, 'surface probe — what the page thinks', { pageState, reason })
    if (
      pageState === 'hidden' &&
      allowFlip &&
      tabId === activeViewId &&
      activeViewVisible &&
      !overlaysOpen
    ) {
      traceViewOp(tabId, 'page still reports hidden — flipping visibility again', { reason })
      forceViewRepaint(view, {
        bounds: lastRealBounds.get(tabId) ?? null,
        reason: `${reason} / page reported hidden`,
        force: true,
        flipVisibility: true,
        flipGate: pageVisibilityGate(view),
        flipShouldRestore: () => tabId === activeViewId && activeViewVisible && !overlaysOpen,
        log: (message) => console.log(`[viewRepaint] ${message}`)
      })
      setTimeout(() => probeSurfaceState(tabId, view, `${reason} / second probe`, false), 900)
      return
    }
    // Nothing above is left to try once the second probe has run. If the page says it is visible and the
    // window, the view and the layout all say the view is presented, then the blank is below the app —
    // in the compositor — and no amount of repainting changes that. Say so in the trace, once, instead of
    // leaving the next diagnostics to be read as "the app tried nothing".
    if (!allowFlip && pageState === 'visible') {
      traceViewOp(tabId, 'surface probe — page reports visible; the view is presented, so nothing on the app side is left to fix', {
        reason
      })
    }
  })
}

/**
 * How hard a view should be made to present itself.
 *
 *   `'suspect'` — the default. Verify, then repaint without touching visibility unless the check found
 *                 something wrong (or the page says it is stuck hidden). This is the tab-switch and
 *                 overlay-close path, and it must not cost the user a single visible frame.
 *   `'always'`  — a surface that is already known to be lost (the escalation: repeated repaints for a
 *                 view that is on screen have not worked). Verify, then hide/show with a gate.
 *   `'cheap'`   — verify and repaint only, never hide.
 *
 * Build 45 flipped on *every* present, which fixed the blank and made every tab switch wait for the page
 * to acknowledge a hide — the small blank/loading pause the user reported on tabs that were not even
 * loading. The flip was never the part that found the bug: the build-45 trace's catch is
 * `presentation check … fixed=shown again (it was hidden)`, i.e. a view that something had left hidden
 * while the app believed it was on screen. So the check stays on every path, and the expensive flip now
 * has to be earned.
 */
type PresentMode = 'suspect' | 'always' | 'cheap'

function ensureActiveViewPresented(reason: string, mode: PresentMode = 'suspect'): void {
  const tabId = activeViewId
  const view = tabId ? aiViews.get(tabId) : null
  if (!tabId || !view || view.webContents.isDestroyed()) return
  if (!activeViewVisible || overlaysOpen) return
  const report = verifyViewPresentation(tabId, view, reason)
  surfaceRepair.forget(tabId)

  const fixedSomething = report.fixed.length > 0
  const shouldFlip = mode === 'always' || (mode === 'suspect' && fixedSomething)
  const bounds = lastRealBounds.get(tabId) ?? null
  const usableBounds = bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null

  if (!shouldFlip) {
    // The common case: the view is in the window, visible and where it should be. Ask for a repaint and
    // let the page keep painting — going anywhere near visibility here is what made tab switches slow.
    const outcome = forceViewRepaint(view, {
      bounds: usableBounds,
      reason,
      force: true,
      log: (message) => console.log(`[viewRepaint] ${message}`)
    })
    traceViewOp(tabId, 'presented — verified, repainted (no flip needed)', {
      outcome,
      reason,
      fixed: fixedSomething ? report.fixed.join('; ') : 'none'
    })
    // One deferred question, off the critical path: is the page actually awake? If it is still reporting
    // itself hidden a third of a second after being shown, the flip is worth its flash; if it says
    // visible — which is what every probe in the build-45 trace said — this costs nothing at all.
    if (mode !== 'cheap') {
      setTimeout(() => probeSurfaceState(tabId, view, `${reason} / settle probe`, true), 300)
    }
    return
  }

  // A flip: the page has to see itself hidden before the view is shown again, or Chromium never builds a
  // new frame. While the page is still loading there is nothing to wait for — it will paint when the load
  // lands — so the hold stays short rather than holding a loading tab off screen.
  let loading = false
  try {
    loading = view.webContents.isLoading()
  } catch {
    loading = false
  }
  const outcome = forceViewRepaint(view, {
    bounds: usableBounds,
    reason,
    force: true,
    flipVisibility: true,
    flipGate: loading ? undefined : pageVisibilityGate(view),
    maxFlipHiddenMs: 400,
    // A flip that waits for the page can outlive a tab switch; never show a view that is no longer the
    // one on screen.
    flipShouldRestore: () => tabId === activeViewId && activeViewVisible && !overlaysOpen,
    log: (message) => console.log(`[viewRepaint] ${message}`)
  })
  traceViewOp(tabId, 'presented — verified, then flipped', {
    outcome,
    reason,
    mode,
    fixed: fixedSomething ? report.fixed.join('; ') : 'none',
    loading
  })
  // The gate shows the view again asynchronously, so the probe has to wait for it.
  setTimeout(() => probeSurfaceState(tabId, view, `${reason} / after flip`, true), 520)
}
/** One pending deferred surface repair per tab — a repair never runs mid-navigation. */
const repairDeferrals = new Map<string, NodeJS.Timeout>()
/**
 * Whether each tab's native view is *actually presented* right now.
 *
 * The build-32 diagnostics showed `repaint (reconcile-presentation) {comingBackFromHidden=false}` one
 * millisecond after an overlay had hidden the view, because "was it hidden?" was being inferred from the
 * view's *bounds*. An overlay hides a view with `setVisible(false)` and leaves the geometry alone, so the
 * one transition that reliably loses the frame was the one case that never asked for a strong repaint —
 * the dark page the user sees after a notification, a toast or any popup. The flag is recorded where the
 * visibility is actually set instead of being guessed from geometry.
 */
const presentedVisible = new Map<string, boolean>()
/**
 * When an overlay last closed.
 *
 * Escalating to a detach/re-attach inside this window is what turned "hidden for two seconds" into
 * "blank until the tab is switched": the repair happened while the compositor was still bringing the
 * surface back, and a detached view has no frame at all. Coming back from an overlay is a known
 * transition, not a failing repaint, so it gets the strong-but-safe path and no escalation.
 */
let lastOverlayCloseAt = 0
/**
 * Tabs that `activate_tab` has just shown again over a surface that was not on screen.
 *
 * `activate_tab` sets visibility itself and — correctly — records it, so the `reconcileViewPresentation`
 * that runs two lines later used to see `presentedVisible === true` and take the cheap repaint path for a
 * tab that had just come back from the background. That is the tab switch to a discarded surface: the
 * page area stays window-coloured until the user hides and shows it again by hand (Settings open/close,
 * another tab switch, restarting the app). The state is captured here, before activation overwrites it,
 * and consumed by the reconcile that follows.
 */
const shownFromHidden = new Set<string>()

/** Record what the view was actually told to do, so "was it hidden?" is a fact and not a guess. */
function markViewVisibility(tabId: string, visible: boolean): void {
  if (!tabId) return
  presentedVisible.set(tabId, visible)
}

/** True when this tab's view was hidden the last time its visibility was set. */
function viewWasHidden(tabId: string, view?: Electron.WebContentsView | null): boolean {
  const recorded = presentedVisible.get(tabId)
  if (recorded !== undefined) return recorded === false
  try {
    const live = (view as unknown as { getVisible?: () => boolean } | null)?.getVisible?.()
    if (typeof live === 'boolean') return live === false
  } catch {
    /* older builds expose no getter; absence of evidence is not evidence of a hidden view */
  }
  return false
}

/**
 * Keep the app's own native overlays on top.
 *
 * A `WebContentsView` is a child of the window, so `addChildView` stacks it *above* whatever was added
 * before it — including the in-app notification toast. Every surface repair and every tab activation
 * that re-attaches a tab view therefore put the toast behind a full-window page, which is why a
 * notification "disappeared" the moment anything touched the layout. Re-raising is two cheap calls.
 */
function raiseNativeOverlays(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  // Only a toast that is on screen needs putting back on top, and only then is removing-then-adding it
  // worth it: the pair is itself a detach, and a detach is the one thing that can leave a native view
  // frameless. A hidden toast is re-stacked by its own resume()/show() path, which raises it anyway.
  const toastOnScreen = Boolean(aiToastManager?.getIsVisible?.())
  try {
    if (toastOnScreen && aiNotificationView && !aiNotificationView.webContents.isDestroyed()) {
      mainWindow.contentView.removeChildView(aiNotificationView)
      mainWindow.contentView.addChildView(aiNotificationView)
    }
  } catch {
    /* the window may be mid-teardown, or the manager is not constructed yet; the next raise catches up */
  }
  try {
    downloadNotificationOverlay?.raiseToFront()
  } catch {
    /* same */
  }
}
let activeViewId: string | null = null
let activeViewVisible = true
const viewTitles = new Map<string, string>()
const viewModelKeys = new Map<string, string>()
let providerConfig: import('../shared/providerConfig').ProviderConfigMap = {}

let aiNotificationView: Electron.WebContentsView | null = null
let powerResumeHookRegistered = false
// Video preparation jobs (plan 01). Frames live in temp dirs owned by the manager.
const videoJobs = new VideoJobManager()
let videoPrepController: AbortController | null = null
// Office preparation (plan 02): prepared text parts and the optional PDF live here until the
// user presses Send; nothing is uploaded by preparing or previewing.
const officeJobs = new OfficeJobManager()
let officePrepController: AbortController | null = null
let downloadNotificationOverlay: DownloadNotificationOverlay | null = null
let isAiNotificationVisible = false
let currentNotificationData: {
  id: string
  tabId: string
  tabTitle: string
  model: string
  status: 'done' | 'waiting-input'
  snippet?: string
} | null = null

const lastDesktopNotifications = new Map<string, number>()
// When each tab last entered 'working', so a notification can say how long the turn took.
// Absent means "not measured", which is different from zero and is reported as absent.
const aiWorkingSince = new Map<string, number>()
const notificationRecorder = createNotificationRecorder()
let notificationPreferencesCache: NotificationPreferences | null = null

function notificationPreferencesPath(): string {
  return join(app.getPath('userData'), 'notifications.json')
}

function notificationPreferences(): NotificationPreferences {
  if (!notificationPreferencesCache) {
    notificationPreferencesCache = loadNotificationPreferences(notificationPreferencesPath())
  }
  return notificationPreferencesCache
}

function updateNotificationPreferences(change: unknown): NotificationPreferences {
  const next = applyNotificationPreferenceChange(notificationPreferences(), change)
  notificationPreferencesCache = next
  saveNotificationPreferences(notificationPreferencesPath(), next)
  return next
}
// Keep recent native notification objects alive for click delivery. The OS may
// retain them after the close event, so release on click/failure or expiry.
const nativeNotificationTimers = new Map<Notification, NodeJS.Timeout>()
const NATIVE_NOTIFICATION_RETENTION_MS = 15 * 60 * 1000
const MAX_RETAINED_NATIVE_NOTIFICATIONS = 64
let warnedNotificationsUnsupported = false
let lastNotifiedTabId: string | null = null

function releaseNativeNotification(notification: Notification): void {
  const timer = nativeNotificationTimers.get(notification)
  if (timer) clearTimeout(timer)
  nativeNotificationTimers.delete(notification)
}

function retainNativeNotification(notification: Notification): void {
  while (nativeNotificationTimers.size >= MAX_RETAINED_NATIVE_NOTIFICATIONS) {
    const oldest = nativeNotificationTimers.keys().next().value
    if (!oldest) break
    releaseNativeNotification(oldest)
  }
  const timer = setTimeout(
    () => releaseNativeNotification(notification),
    NATIVE_NOTIFICATION_RETENTION_MS
  )
  timer.unref?.()
  nativeNotificationTimers.set(notification, timer)
}

function nativeNotificationClickHandler(notification: Notification, tabId: string): () => void {
  // Capture only the tab identifier, not the title or message snippet.
  return () => {
    releaseNativeNotification(notification)
    if (
      !aiViews.has(tabId) &&
      !tabDiscardManager.hasView(tabId) &&
      !tabDiscardManager.isTabEvicted(tabId)
    )
      return
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      sendToMainWindow('notification_switch_to_tab', tabId)
    }
  }
}

function buildNotificationHtml(data: {
  id: string
  tabId: string
  tabTitle: string
  model: string
  status: 'done' | 'waiting-input'
  snippet?: string
  durationMs?: number
}): string {
  const isWaitingInput = data.status === 'waiting-input'
  const accentColor = isWaitingInput ? '#ef4444' : '#10b981'
  const glowColor = isWaitingInput ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.3)'
  const statusLabel = isWaitingInput ? 'Needs Input' : 'Response Ready'
  // The same facts the desktop notification reports, so the two never disagree.
  const factLabel = [modelLabel(data.model), formatDuration(data.durationMs)]
    .filter((part) => part.length > 0)
    .join(' · ')
  const escapeHtmlText = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const safeTitle = escapeHtmlText(data.tabTitle)
  const rawSnippet =
    data.snippet ||
    (isWaitingInput ? 'Waiting for your choice or confirmation' : 'Generation completed.')
  const safeSnippet = rawSnippet
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const safeTabIdAttr = data.tabId.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; user-select: none; }
    body { background: transparent; overflow: hidden; padding: 6px 8px; }
    .toast {
      position: relative;
      background: linear-gradient(135deg, rgba(14, 18, 30, 0.96) 0%, rgba(8, 12, 22, 0.98) 100%);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid ${isWaitingInput ? 'rgba(239, 68, 68, 0.6)' : 'rgba(16, 185, 129, 0.45)'};
      border-radius: 12px;
      padding: 12px 14px 10px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.75), 0 0 24px ${glowColor}, inset 0 1px 0 rgba(255, 255, 255, 0.15);
      color: #f1f5f9;
      display: flex;
      flex-direction: column;
      gap: 6px;
      cursor: pointer;
      animation: toastEnter 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
    }
    .toast.exiting {
      animation: toastExit 0.18s cubic-bezier(0.4, 0, 1, 1) forwards;
    }
    @keyframes toastEnter {
      from { opacity: 0; transform: translateY(-8px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes toastExit {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to { opacity: 0; transform: translateY(-6px) scale(0.98); }
    }
    @media (prefers-reduced-motion: reduce) {
      .toast { animation: none !important; transition: opacity 0.15s ease !important; }
      .toast.exiting { opacity: 0 !important; }
      .status-dot { animation: none !important; }
      .progress-fill { animation: none !important; }
    }
    .toast:hover {
      transform: translateY(-2px);
      box-shadow: 0 20px 42px rgba(0, 0, 0, 0.85), 0 0 32px ${glowColor};
    }
    .toast:hover .progress-fill {
      animation-play-state: paused;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .title-box {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      flex: 1;
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 9999px;
      background: ${accentColor};
      box-shadow: 0 0 8px ${accentColor};
      flex-shrink: 0;
      ${isWaitingInput ? 'animation: pulse 1.5s infinite;' : ''}
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.3); opacity: 0.7; }
    }
    .tab-title {
      font-size: 12.5px;
      font-weight: 700;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      letter-spacing: -0.2px;
    }
    .badge {
      font-size: 9.5px;
      font-weight: 700;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      text-transform: uppercase;
      padding: 2px 7px;
      border-radius: 9999px;
      background: ${isWaitingInput ? 'rgba(239, 68, 68, 0.22)' : 'rgba(16, 185, 129, 0.2)'};
      color: ${isWaitingInput ? '#fca5a5' : '#6ee7b7'};
      border: 1px solid ${isWaitingInput ? 'rgba(239, 68, 68, 0.5)' : 'rgba(16, 185, 129, 0.4)'};
      flex-shrink: 0;
      letter-spacing: 0.3px;
    }
    .close-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #94a3b8;
      cursor: pointer;
      padding: 2px 6px;
      font-size: 11px;
      border-radius: 6px;
      line-height: 1;
      transition: all 0.15s ease;
    }
    .close-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff;
    }
    .facts {
      font-size: 10px;
      font-weight: 600;
      color: #94a3b8;
      letter-spacing: 0.02em;
      margin-left: auto;
      margin-right: 8px;
      white-space: nowrap;
    }
    .snippet {
      font-size: 11px;
      color: #cbd5e1;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      opacity: 0.88;
      margin-top: 1px;
    }
    .actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 4px;
      padding-top: 5px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .switch-cta {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 600;
      color: ${accentColor};
    }
    .switch-btn {
      background: ${isWaitingInput ? 'rgba(239, 68, 68, 0.28)' : 'rgba(16, 185, 129, 0.22)'};
      border: 1px solid ${accentColor};
      color: #ffffff;
      font-size: 10.5px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 6px;
      cursor: pointer;
      box-shadow: 0 0 10px ${glowColor};
      transition: all 0.15s ease;
    }
    .switch-btn:hover {
      background: ${accentColor};
      color: #0b0f19;
    }
    .progress-track {
      position: absolute;
      bottom: 0;
      left: 12px;
      right: 12px;
      height: 2px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 2px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: ${accentColor};
      width: 100%;
      animation: shrinkProgress 6.8s linear forwards;
    }
    @keyframes shrinkProgress {
      from { width: 100%; }
      to { width: 0%; }
    }
  </style>
</head>
<body>
  <div class="toast" id="toastCard" data-tab-id="${safeTabIdAttr}">
    <div class="header">
      <div class="title-box">
        <span class="status-dot"></span>
        <span class="tab-title">${safeTitle}</span>
      </div>
      <span class="badge">${statusLabel}</span>
      ${factLabel ? `<span class="facts">${escapeHtmlText(factLabel)}</span>` : ''}
      <button type="button" class="close-btn" id="closeBtn" title="Dismiss">✕</button>
    </div>
    <div class="snippet">${safeSnippet}</div>
    <div class="actions">
      <span class="switch-cta">
        <span>Click to switch</span>
        <span>→</span>
      </span>
      <button type="button" class="switch-btn" id="switchBtn">View Tab</button>
    </div>
    <div class="progress-track">
      <div class="progress-fill"></div>
    </div>
  </div>
  <script>
    const card = document.getElementById('toastCard');
    const tabId = card?.getAttribute('data-tab-id') || '';
    const switchTab = () => {
      if (tabId) {
        window.electron?.ipcRenderer?.send('notification_click_switch_tab', tabId);
      }
    };
    card?.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'closeBtn') return;
      switchTab();
    });
    document.getElementById('switchBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      switchTab();
    });
    document.getElementById('closeBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      card?.classList.add('exiting');
      window.electron?.ipcRenderer?.send('dismiss_in_app_toast');
    });
  </script>
</body>
</html>`
}

interface DesktopNotificationInput {
  id?: string
  tabId: string
  tabTitle: string
  model: string
  status: 'done' | 'waiting-input'
  snippet?: string
}

/**
 * Show a native notification. Returns whether the OS took it, because the caller uses that to
 * decide whether an in-app toast is still needed — silence should never be the only outcome.
 */
function triggerDesktopNotification(data: DesktopNotificationInput): boolean {
  const preferences = notificationPreferences()
  const record = (outcome: Parameters<typeof notificationRecorder.record>[0]['outcome']): false => {
    notificationRecorder.record({
      tabId: data.tabId,
      status: data.status,
      detail: preferences.detail,
      outcome
    })
    return false
  }

  if (!preferences.desktopEnabled) return record('disabled')

  if (!Notification.isSupported()) {
    notificationRecorder.setEnvironment({ nativeSupported: false, platform: process.platform })
    if (!warnedNotificationsUnsupported) {
      warnedNotificationsUnsupported = true
      console.warn('[Notification] Native notifications are unsupported in this environment.')
    }
    return record('unsupported')
  }
  notificationRecorder.setEnvironment({ nativeSupported: true, platform: process.platform })

  let notif: Notification | null = null
  try {
    const now = Date.now()
    const lastTime = lastDesktopNotifications.get(data.tabId) || 0
    if (now - lastTime < 2000) return record('throttled')
    lastDesktopNotifications.set(data.tabId, now)

    const iconCandidates = [
      join(__dirname, '../../resources/icon.png'),
      join(app.getAppPath(), 'resources/icon.png'),
      join(app.getAppPath(), 'build/icon.png')
    ]
    const iconPath = iconCandidates.find((candidate) => existsSync(candidate))

    const startedAt = aiWorkingSince.get(data.tabId)
    const { title, body, urgency } = formatNotificationContent(
      {
        tabTitle: data.tabTitle,
        model: data.model,
        status: data.status,
        snippet: data.snippet,
        durationMs: startedAt === undefined ? undefined : Math.max(0, now - startedAt)
      },
      { detail: preferences.detail }
    )

    notif = new Notification({
      title,
      body,
      urgency,
      silent: false,
      icon: iconPath
    })

    const nativeNotification = notif
    retainNativeNotification(nativeNotification)
    nativeNotification.on('failed', (_event, error) => {
      releaseNativeNotification(nativeNotification)
      const message =
        typeof error === 'string' ? error : String((error as Error | undefined)?.message ?? '')
      if (message) notificationRecorder.setFailure(message)
      notificationRecorder.record({
        tabId: data.tabId,
        status: data.status,
        detail: preferences.detail,
        outcome: 'failed'
      })
      console.warn('[Notification] Native notification failed; check OS notification permissions.')
    })
    nativeNotification.on('click', nativeNotificationClickHandler(nativeNotification, data.tabId))

    nativeNotification.show()
    notificationRecorder.record({
      tabId: data.tabId,
      status: data.status,
      detail: preferences.detail,
      outcome: 'shown'
    })
    return true
  } catch (e) {
    if (notif) releaseNativeNotification(notif)
    notificationRecorder.setFailure(e instanceof Error ? e.message : 'unknown failure')
    notificationRecorder.record({
      tabId: data.tabId,
      status: data.status,
      detail: preferences.detail,
      outcome: 'failed'
    })
    console.error('[Notification] Failed to trigger desktop notification:', e)
    return false
  }
}


const aiToastManager = new AiToastManager(
  () => {
    if (!aiNotificationView || aiNotificationView.webContents.isDestroyed()) return null
    return {
      isDestroyed: () => !aiNotificationView || aiNotificationView.webContents.isDestroyed(),
      loadHtml: (html: string) => {
        aiNotificationView?.webContents.loadURL(
          'data:text/html;charset=utf-8,' + encodeURIComponent(html)
        )
      },
      setVisible: (visible: boolean) => {
        try {
          aiNotificationView?.setVisible(visible)
        } catch {}
      },
      setBounds: (bounds) => {
        try {
          aiNotificationView?.setBounds(bounds)
        } catch {}
      },
      startExitAnimation: () => {
        try {
          aiNotificationView?.webContents
            .executeJavaScript("document.getElementById('toastCard')?.classList.add('exiting');")
            .catch(() => {})
        } catch {}
      }
    }
  },
  () => {
    const winBounds =
      mainWindow && !mainWindow.isDestroyed()
        ? mainWindow.getContentBounds()
        : { width: 1200, height: 800 }
    return {
      x: Math.max(0, winBounds.width - 395),
      y: 44,
      width: 380,
      height: 125
    }
  },
  (data) => buildNotificationHtml(data)
)

function showInAppToast(data: DesktopNotificationInput & { id: string }) {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const preferences = notificationPreferences()
  // Check if Nexus mainWindow has OS focus and is visible and not minimized
  const isAppActiveAndVisible = Boolean(
    mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()
  )
  const isSameActiveTab = Boolean(
    isAppActiveAndVisible && activeViewId === data.tabId && activeViewVisible && !overlaysOpen
  )

  if (isSameActiveTab) {
    // The user is looking at the tab that produced this: a second alert is noise.
    notificationRecorder.record({
      tabId: data.tabId,
      status: data.status,
      detail: preferences.detail,
      outcome: 'active-tab',
      reason: 'the tab that finished was the one you were looking at'
    })
    dismissInAppToast(true)
    return
  }

  lastNotifiedTabId = data.tabId

  const nativeShown = triggerDesktopNotification(data)

  // The HUD is shown when Nexus is in front on another tab, and — importantly — whenever the
  // OS could not show anything, so a platform without a notification daemon is not silent.
  if (!isAppActiveAndVisible && nativeShown) return
  if (!aiNotificationView) {
    if (!nativeShown) {
      console.warn('[Notification] No native notification and the in-app toast is unavailable.')
    }
    return
  }

  try {
    // Existing children are reordered to the top without remove/re-attach.
    mainWindow.contentView.addChildView(aiNotificationView)
  } catch {}

  const startedAt = aiWorkingSince.get(data.tabId)
  aiToastManager.show({
    ...data,
    durationMs: startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt)
  })
  currentNotificationData = aiToastManager.getCurrentData()
  isAiNotificationVisible = aiToastManager.getIsVisible()
  // An overlay covers the page, and a native view cannot be drawn above it — but "cannot be seen yet"
  // is not "do not tell me". The toast is armed now and suspended; closing the panel resumes it with
  // the time it had left (see `resume()` in aiToastManager.ts).
  if (overlaysOpen) aiToastManager.suspend()
  downloadNotificationOverlay?.raiseToFront()
  // Stacking a new native child over the page makes the compositor rebuild the window's surface order,
  // and the page underneath can come back with no frame — "the AI view went blank when a notification
  // came". Asking the page for one frame at that exact moment is cheap; discovering it later is not.
  const activeView = activeViewId ? aiViews.get(activeViewId) : null
  if (activeView?.webContents && !activeView.webContents.isDestroyed()) {
    forceViewRepaint(activeView, {
      bounds: activeViewId ? lastRealBounds.get(activeViewId) ?? null : null,
      reason: 'a notification was stacked over the page',
      log: (message) => console.log(`[viewRepaint] ${message}`)
    })
  }
}

function dismissInAppToast(immediate = false) {
  aiToastManager.dismiss(immediate)
  currentNotificationData = aiToastManager.getCurrentData()
  isAiNotificationVisible = aiToastManager.getIsVisible()
}
// Match the actual OS and bundled Chromium version; do not impersonate Linux on Windows.
// Strip Electron/product tokens by constructing a regular Chrome-compatible UA.
// The unmodified string is kept too: Google's sign-in refuses a Chromium claiming to be plain Chrome
// and accepts Electron's own identity, so the sign-in window presents NATIVE_ELECTRON_UA instead.
const AI_UA = chromeCompatibleUserAgent(process.platform, process.arch, process.versions.chrome)
app.userAgentFallback = AI_UA
// The identity registry needs both strings and neither module may import the other, so they are handed
// over here, once, before any window or view exists.
configureUserAgents({ ai: AI_UA, native: NATIVE_ELECTRON_UA })

// The hosts that keep the Chrome-shaped identity even though Google owns them: the AI products
// themselves. Every other company host — google.com, accounts.google.com, the consent pages — presents
// the honest Electron identity, because those are the pages that refuse a browser which contradicts
// itself, and a sign-in flow hops between all of them.
configureProviderHosts([
  ...Object.values(PROVIDER_THEMES).flatMap((theme) => (theme && theme.hosts) || []),
  'gemini.google.com',
  'aistudio.google.com',
  'notebooklm.google.com',
  'labs.google.com'
])

// Every webContents in the app — windows, views and popups alike — is watched here rather than at each
// creation site. The identity is a pure function of the URL (webIdentity.ts), so this is a sync, not a
// policy of its own: a page that navigates to a Google property takes the honest identity before it
// loads, a page that navigates to a provider gets the Chrome-shaped one back, and a destroyed page is
// forgotten so ids cannot pile up. The sign-in window keeps its identity until it closes.
app.on('web-contents-created', (_event, contents) => {
  const settle = (url: string) => {
    if (contents.isDestroyed()) return
    const before = hasNativeIdentity(contents.id)
    const after = syncIdentity(contents, url)
    if (before !== (after === 'native')) {
      console.log(
        `[identity] ${after === 'native' ? 'native' : 'Chrome-shaped'} identity — ${identityReason(url)}`
      )
    }
  }
  contents.on('did-navigate', (_e, url) => settle(url))
  contents.on('did-navigate-in-page', (_e, url) => settle(url))
  // A server-side redirect is otherwise invisible in the navigation trace, and a sign-in is a redirect
  // chain: `provider/oauth/…` → `accounts.google.com`. Naming each hop turns "the page reloaded itself"
  // into a journey that can be followed, and says which identity the hop was supposed to present.
  contents.on('will-redirect', (_e, url, _isInPlace, isMainFrame) => {
    if (!isMainFrame) return
    traceNav(tabIdForContents(contents), 'event', 'will-redirect — the server sent the page on', {
      url,
      identity: desiredIdentityFor(url),
      current: contents.isDestroyed() ? '(gone)' : contents.getURL() || '(none)'
    })
  })
  contents.on('destroyed', () => forgetNativeIdentity(contents.id))

  // A page that had to be switched mid-flight — a provider's "Sign in with Google" popup, or a tab
  // navigated to accounts.google.com — can in principle commit with the header already switched and
  // `navigator.userAgent` not yet switched. Google refuses exactly that state, so it is verified after
  // each load and repaired by loading the same URL again with the identity stated up front.
  //
  // Bounded, hard: at most two repairs for a page's whole life. An identity mismatch that survives
  // two reloads is not a mismatch this can fix, and a page that reloads itself forever is worse than a
  // page that is wrong — that is the failure the user reported as "it just keeps refreshing".
  let repairs = 0
  let repairedThisLoad = false
  contents.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) repairedThisLoad = false
  })
  contents.on('did-finish-load', () => {
    if (repairedThisLoad || repairs >= 2) return
    // Never start the identity reload while a navigation is in flight for the tab that owns this
    // page: that reload aborts the load the user just asked for and the tab stays on the previous
    // document. The identity is re-checked on the next load anyway.
    const ownerTab = tabIdForContents(contents)
    if (ownerTab && navigationIntent.pendingUrl(ownerTab)) {
      traceNav(ownerTab, 'note', 'identity repair skipped — a navigation is in flight', {
        url: contents.getURL()
      })
      return
    }
    const url = contents.getURL()
    if (!url || !/^https?:/i.test(url)) return
    if (desiredIdentityFor(url) !== 'native' || !hasNativeIdentity(contents.id)) return
    repairedThisLoad = true
    contents
      .executeJavaScript('navigator.userAgent', true)
      .then((ua: unknown) => {
        if (typeof ua !== 'string' || /Electron\//i.test(ua)) return
        if (contents.isDestroyed()) return
        repairs += 1
        console.warn(
          `[identity] ${url} loaded with a user agent that disagrees with its header — reloading once (repair ${repairs} of 2)`
        )
        // This reload is a real navigation: it aborts anything else loading in that tab. It says so in
        // the trace, because an anonymous loadURL here looked like a page reloading itself.
        traceNav(tabIdForContents(contents), 'load', 'identity repair reload', { url, repairs, userAgent: 'native' })
        void contents.loadURL(url, { userAgent: NATIVE_ELECTRON_UA })
      })
      .catch(() => {})
  })
})

/**
 * Everything the AI partition needs to behave: telemetry blocked, the Chrome-shaped user agent (with
 * the sign-in window's own identity left alone), framing headers stripped, Google sessions kept alive.
 *
 * It used to be written out for `persist:ai-shared` once. Containers each load on their account's own
 * partition, so this has to be installable per partition — and installable exactly once, because
 * `onBeforeSendHeaders` replaces the previous listener rather than adding to it.
 */
/**
 * Which partition a webContents lives in. Electron has no reverse lookup, and a popup has to inherit
 * its opener's session or the cookies it sets never reach the tab.
 */
const webContentsPartitions = new Map<number, string>()

/** Main-frame navigations per tab, used only to report a loop that survives every guard. */
/**
 * Who owns the keyboard, the shell or the AI view?
 *
 * The build-28 report was "the keyboard keeps getting unfocused, I have to click Nexus before shortcuts
 * work — but with the Diagnostics panel open it was fine". The trace says why: every `did-stop-loading`
 * on the active tab called `view.webContents.focus()`. A page that reloads itself every couple of
 * seconds (chat.deepseek.com does, and it is not the only one) therefore took the keyboard from the
 * shell twice a second. Ctrl+L still *reached* the app — the view forwards accelerators — but the
 * overlay it opened could not receive a keystroke, because the shell renderer did not have focus. With
 * the Diagnostics overlay open the same handler bails out on `overlaysOpen`, which is exactly why the
 * keyboard behaved while the user was reading the logs.
 *
 * So the keyboard is now remembered, not assumed: a load finishing never moves it, and only an explicit
 * request (tab activation, the URL bar, a click into the page) gives it to the view.
 */
type KeyboardOwner = 'shell' | 'view'
let keyboardOwner: KeyboardOwner = 'view'
let keyboardBeforeOverlay: KeyboardOwner = 'view'

function setKeyboardOwner(owner: KeyboardOwner, reason: string, tabId?: string): void {
  const previous = keyboardOwner
  keyboardOwner = owner
  if (previous === owner) return
  try {
    traceNav(tabId || activeViewId || '', 'view', `keyboard → ${owner} (${reason})`, {})
  } catch {
    /* the trace is not worth a throw on a focus path */
  }
}

/** Give the AI view the keyboard. Only call this when the user asked for it. */
function giveKeyboardToView(view: Electron.WebContentsView | null | undefined, reason: string, tabId?: string): void {
  try {
    if (!view || !view.webContents || view.webContents.isDestroyed()) return
    if (overlaysOpen) return
    setKeyboardOwner('view', reason, tabId)
    view.webContents.focus()
  } catch {
    /* the contents went away between the check and the call */
  }
}

/** Give the shell the keyboard, so overlays (Ctrl+L, menus) can be typed into. */
function giveKeyboardToShell(reason: string): void {
  setKeyboardOwner('shell', reason)
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (!mainWindow.webContents || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.focus()
  } catch {
    /* nothing here is worth a throw: focus is best-effort by nature */
  }
}

/** True when a page-initiated load must be allowed to keep the keyboard it already has. */
function keyboardStaysWithView(view: Electron.WebContentsView, tabId: string): boolean {
  try {
    if (keyboardOwner !== 'view') return false
    if (activeViewId !== tabId || !activeViewVisible) return false
    return view.webContents.isFocused()
  } catch {
    return false
  }
}

/**
 * How many times we will take a frame back from a navigation that is not the user's. The old page
 * getting restored after a restart is a one-shot event, so five is generous; the budget exists only so
 * a page that insists cannot turn the app into a load loop.
 */
const NAV_DEFENCE_BUDGET = 5

/**
 * Take a frame back, from outside the navigation event.
 *
 * Every step here touches native navigation state, and doing that from inside `did-start-navigation` is
 * what closed the app in build 29. One `setTimeout` is the whole fix: the handler schedules, this runs on
 * the next turn of the loop, and Electron is happy to be asked then.
 */
function scheduleDefence(view: Electron.WebContentsView, tabId: string, wantedUrl: string): void {
  // One `setTimeout`, nothing else. Every call that touched navigation state from inside
  // `did-start-navigation` has hurt: build 28's `loadURL` aborted its own request, and build 29's
  // `stop()` closed the app. Questions are asked from outside the event.
  setTimeout(() => {
    if (view.webContents.isDestroyed()) return
    if (navWanted.get(tabId)?.url !== wantedUrl) return
    try {
      traceNav(tabId, 'load', 're-issue — this load cancels the intruder', { url: wantedUrl })
      view.webContents.loadURL(wantedUrl).catch(() => {})
    } catch {
      /* the request loop still owns the give-up decision */
    }
  }, 70)
}

/**
 * Tabs that have already been caught re-navigating themselves during a load.
 *
 * For those the history is cleared *before* the next navigation starts — at a quiet moment, with nothing
 * in flight, which is the only moment it is safe to touch. A page that restores itself with
 * `history.back()` then has nowhere to go, so the bounce never happens instead of being undone.
 * Everything else keeps its back/forward entries, which is why this is a set and not a blanket rule.
 */
const navBouncedTabs = new Set<string>()

/** Per tab: how many times we have re-issued the user's URL, when, and for which URL. */
const navDefences = new Map<string, { used: number; at: number; url: string }>()

/** Per tab: the URL the view was on when the user's load started — the page we are leaving. */
const navLeaveFrom = new Map<string, string>()

/**
 * The URL the user actually asked for, per tab, and the request token that asked for it.
 *
 * The defence below cannot use the navigation-intent tracker for this: every `did-fail-load` clears it,
 * including the `ERR_ABORTED` that *is* the abort being judged — which is why the build-27 trace showed
 * `pending=(none)` on our own load. Only a newer `navigate_tab` moves this map, so "is this still what
 * the user wants" has an answer that events cannot rewrite.
 */
const navWanted = new Map<string, { url: string; token: number; at: number }>()

const navigationCounters = new Map<string, { count: number; since: number }>()

function partitionOfOpener(contents: Electron.WebContents | undefined | null): string {
  if (!contents) return 'persist:ai-shared'
  const opener = (contents as unknown as { opener?: Electron.WebContents | null }).opener
  const openerId = opener?.id
  if (typeof openerId === 'number') {
    const known = webContentsPartitions.get(openerId)
    if (known) return known
  }
  const own = webContentsPartitions.get(contents.id)
  return own ?? 'persist:ai-shared'
}

const aiPolicyInstalled = new Set<string>()

/**
 * The part of the AI session policy the identity depends on, for a partition that is only used for
 * signing in: the request hook (so the header can never disagree with the page) and the cookie flush
 * (so the session survives a quit). Deliberately *not* the header stripping — that exists so provider
 * pages can be embedded and styled, and a brand-new account's partition should behave exactly like a
 * browser tab on Google's pages, not like an embedded provider view.
 */
const identityHookInstalled = new Set<string>()
function installIdentityHeaderHookOnce(partition: string): void {
  if (identityHookInstalled.has(partition)) return
  identityHookInstalled.add(partition)
  installIdentityHeaderHook(session.fromPartition(partition))
}

function installSignInSessionPolicy(partition: string): void {
  // Not recorded in aiPolicyInstalled: a sign-in partition that later becomes a tab partition must
  // still be able to take the full policy. Only the hook and the cookie flush are installed here.
  try {
    installIdentityHeaderHookOnce(partition)
    installGoogleSessionPersistence(session.fromPartition(partition))
  } catch (err) {
    console.error('[identity] Sign-in session policy failed for partition', partition, err)
  }
}

function installAiSessionPolicy(partition: string): void {
  if (aiPolicyInstalled.has(partition)) return
  aiPolicyInstalled.add(partition)
  // Each step is guarded on its own: a container partition is created lazily, in the middle of a tab
  // being opened, and one API refusing must not leave the user with a tab and no view.
  try {
    installAiSessionPolicySteps(partition)
  } catch (err) {
    console.error('[containers] Session policy failed for partition', partition, err)
  }
}

/**
 * Put a page on the identity its next document needs, mid-navigation, without cancelling anything.
 *
 * Returns true only when the page really is presenting `identity` now. `false` means "it is not, and I
 * did not touch it" — the caller then picks the header from what the page actually presents, because a
 * header that disagrees with `navigator.userAgent` is the state Google refuses, while a navigation that
 * disappears is the state the user reports as "the page just reloads".
 */
function switchPageIdentityMidRequest(
  contents: Electron.WebContents | null | undefined,
  identity: 'ai' | 'native'
): boolean {
  if (!contents) return false
  try {
    if (contents.isDestroyed()) return false
  } catch {
    return false
  }
  // Nothing to do: the page already presents this identity.
  if (hasNativeIdentity(contents.id) === (identity === 'native')) return true
  const userAgent = identity === 'native' ? NATIVE_ELECTRON_UA : AI_UA
  // Never `setUserAgent` here. Chromium discards a navigation that is still in flight when a page's user
  // agent changes, and every request this hook sees is made during a navigation — that abort is what
  // ended every Google sign-in one hop after the provider's server redirect (identitySwitch.ts has the
  // whole account of it). The DevTools override changes the page without touching navigation state.
  if (!applyUserAgentOverCdp(contents, userAgent, (message) => console.warn(`[identity] ${message}`))) {
    return false
  }
  const marked = identity === 'native' ? markNativeIdentity(contents) : markChromeIdentity(contents)
  if (!marked) return false
  traceNav(tabIdForContents(contents), 'note', 'identity switched without cancelling the navigation', {
    identity,
    url: (() => {
      try {
        return contents.getURL() || '(none)'
      } catch {
        return '(gone)'
      }
    })()
  })
  return true
}

/**
   * The one place a request's user agent is decided, shared by every policy above so a partition can be
   * given the identity without the rest of the AI treatment.
   */
function installIdentityHeaderHook(ses: Electron.Session): void {
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders }
    const extra = details as unknown as { webContentsId?: number; resourceType?: string }
    // One decision, in webIdentity.ts, and the same one the navigation watcher makes: Google's own
    // properties get the honest Electron identity, an AI provider's page keeps the Chrome-shaped one,
    // and every request of a document inherits that document's identity.
    const decision = resolveIdentityForRequest({
      url: details.url,
      isMainFrame: extra.resourceType === 'mainFrame',
      webContentsId: extra.webContentsId
    })
    let identity: 'ai' | 'native' = decision.identity
    if (decision.adopt || decision.release) {
      const contents =
        extra.webContentsId === undefined || extra.webContentsId < 0
          ? null
          : electronWebContents.fromId(extra.webContentsId)
      if (!switchPageIdentityMidRequest(contents, decision.identity)) {
        // The page could not be switched (no debugger, or a DevTools session holds one). The header
        // follows the page as it is; the app-wide watcher switches it once this navigation commits.
        identity = hasNativeIdentity(extra.webContentsId) ? 'native' : 'ai'
      }
    }
    const userAgent = identity === 'native' ? NATIVE_ELECTRON_UA : AI_UA

    for (const key of Object.keys(requestHeaders)) {
      if (key.toLowerCase() === 'user-agent') {
        requestHeaders[key] = userAgent
      }
    }

    callback({ requestHeaders })
  })
}

function installAiSessionPolicySteps(partition: string): void {
  const ses = session.fromPartition(partition)

  // Task B3: Network Telemetry Blocker
  ses.webRequest.onBeforeRequest(
    {
      urls: [
        '*://sentry.io/*',
        '*://*.sentry.io/*',
        '*://google-analytics.com/*',
        '*://*.google-analytics.com/*',
        '*://posthog.com/*',
        '*://*.posthog.com/*'
      ]
    },
    (_details, callback) => {
      callback({ cancel: true })
    }
  )

  installIdentityHeaderHookOnce(partition)

  ses.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders }
    const headersToRemove = [
      'x-frame-options',
      'X-Frame-Options',
      'content-security-policy',
      'Content-Security-Policy',
      'cross-origin-opener-policy',
      'Cross-Origin-Opener-Policy',
      'cross-origin-embedder-policy',
      'Cross-Origin-Embedder-Policy'
    ]
    for (const header of headersToRemove) {
      if (responseHeaders[header]) delete responseHeaders[header]
    }
    callback({ cancel: false, responseHeaders })
  })

  installGoogleSessionPersistence(ses)
  registerDownloadHandler(ses)
}

// Preserve the existing site-isolation policy; let V8 select its normal heap limit.
app.commandLine.appendSwitch('disable-site-isolation-trials')
// Strictly bound Chromium disk cache & media cache to prevent memory-mapped RSS bloat
app.commandLine.appendSwitch('disk-cache-size', '104857600')
app.commandLine.appendSwitch('media-cache-size', '52428800')
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512')
app.commandLine.appendSwitch('process-per-site')

// Authoritative in-memory pinned tab cache. Eliminates synchronous per-candidate
// disk reads during discard scans and ensures 100% synchronization with UI state.
export let isPinnedInitialized = false
export const pinnedTabIds = new Set<string>()

export function getFinalUserDataDir(): string {
  return join(app.getPath('appData'), 'nexus')
}

export function getPinnedFilePath(): string {
  return join(getFinalUserDataDir(), 'pinned.json')
}

export function loadInitialPinnedState(): void {
  try {
    const pinnedPath = getPinnedFilePath()
    if (existsSync(pinnedPath)) {
      const raw = JSON.parse(readFileSync(pinnedPath, 'utf-8'))
      if (Array.isArray(raw)) {
        pinnedTabIds.clear()
        for (const id of raw) {
          if (typeof id === 'string') pinnedTabIds.add(id)
        }
      }
    }
  } catch (err) {
    console.warn('[pinned-sync] Failed to read initial pinned.json:', err)
  } finally {
    isPinnedInitialized = true
  }
}
loadInitialPinnedState()

const activeAiLifecycles = new Map<string, TabAiLifecycleState>()
const aiLifecycleTimers = new Map<string, NodeJS.Timeout>()
export const tabViewGenerations = new Map<string, number>()

export function getTabViewGeneration(tabId: string): number {
  return tabViewGenerations.get(tabId) ?? 1
}

export function bumpTabViewGeneration(tabId: string): number {
  const next = (tabViewGenerations.get(tabId) ?? 0) + 1
  tabViewGenerations.set(tabId, next)
  return next
}

const lastCompletionNotifications = new Map<
  string,
  { status: string; revision: number; time: number }
>()

function triggerCompletionNotification(
  tabId: string,
  status: 'done' | 'waiting-input',
  snippet?: string
) {
  const now = Date.now()
  const prev = lastCompletionNotifications.get(tabId)
  const currentRev = activeAiLifecycles.get(tabId)?.revision ?? 0
  if (shouldDeduplicateCompletion(prev, status, currentRev, now)) return
  lastCompletionNotifications.set(tabId, { status, revision: currentRev, time: now })

  const tabTitle = viewTitles.get(tabId) || 'AI Session'
  const modelKey = viewModelKeys.get(tabId) || 'gemini'
  showInAppToast({
    id: `${tabId}-${now}-${Math.random().toString(36).slice(2, 6)}`,
    tabId,
    tabTitle,
    model: modelKey,
    status,
    snippet
  })
}

export function getTabAiStatus(tabId: string): AiLifecycleStatus {
  return activeAiLifecycles.get(tabId)?.status ?? 'unknown'
}

export function setTabAiLifecycle(
  tabId: string,
  nextStatus: AiLifecycleStatus,
  options?: {
    lastSnippet?: string
    error?: string
    viewGeneration?: number
    skipTimer?: boolean
  }
): void {
  const currentViewGen = tabViewGenerations.get(tabId) ?? 1
  if (options?.viewGeneration !== undefined && options.viewGeneration < currentViewGen) {
    // Drop stale updates from an older view/navigation epoch
    return
  }

  const existing = activeAiLifecycles.get(tabId)
  const viewGen = options?.viewGeneration ?? existing?.viewGeneration ?? currentViewGen
  const nextRev = (existing?.revision ?? 0) + 1
  const prevStatus = existing?.status ?? 'unknown'
  const now = Date.now()

  // Clear existing linger timer if any
  const existingTimer = aiLifecycleTimers.get(tabId)
  if (existingTimer) {
    clearTimeout(existingTimer)
    aiLifecycleTimers.delete(tabId)
  }

  const isActive = tabId === activeViewId
  const isBackground = !isActive

  let enteredIdleAt = existing?.enteredIdleAt
  if (nextStatus === 'idle') {
    if (!enteredIdleAt) enteredIdleAt = now
  } else {
    enteredIdleAt = undefined
  }

  // Remember when a turn started so the notification can report how long it took. Cleared on
  // any status that ends the turn, so a stale start can never inflate a later duration.
  if (nextStatus === 'working' && prevStatus !== 'working') aiWorkingSince.set(tabId, now)
  if (nextStatus !== 'working') aiWorkingSince.delete(tabId)

  const nextState: TabAiLifecycleState = {
    tabId,
    status: nextStatus,
    revision: nextRev,
    viewGeneration: viewGen,
    lastSnippet: options?.lastSnippet !== undefined ? options.lastSnippet : existing?.lastSnippet,
    error: options?.error !== undefined ? options.error : existing?.error,
    updatedAt: now,
    enteredIdleAt,
    isBackgroundCompletion: nextStatus === 'done' ? isBackground : false
  }
  activeAiLifecycles.set(tabId, nextState)

  // Handle linger timers for 'done'
  if (nextStatus === 'done' && !options?.skipTimer) {
    if (isActive) {
      // Active tab: 6s visible confirmation linger before transitioning to idle
      const timer = setTimeout(() => {
        const cur = activeAiLifecycles.get(tabId)
        const latestGen = tabViewGenerations.get(tabId) ?? 1
        if (
          cur &&
          cur.revision === nextRev &&
          cur.viewGeneration === viewGen &&
          latestGen === viewGen &&
          cur.status === 'done'
        ) {
          setTabAiLifecycle(tabId, 'idle', { viewGeneration: viewGen })
        }
      }, ACTIVE_TAB_DONE_LINGER_MS)
      aiLifecycleTimers.set(tabId, timer)
    }
  }

  // Inform TabDiscardManager: true if idle, false otherwise
  tabDiscardManager.onAiStatusChanged(tabId, nextStatus === 'idle')

  // Publish to mainWindow: modern typed event
  const updatePayload: AiLifecycleStatusUpdate = {
    tabId,
    status: nextStatus,
    revision: nextRev,
    viewGeneration: viewGen,
    lastSnippet: nextState.lastSnippet,
    error: nextState.error,
    timestamp: now
  }
  sendToMainWindow('ai-lifecycle-status', updatePayload)

  // Finding 2: Stop sending legacy completion events for initial unknown, idle, error,
  // or other non-completion transitions. Generate notifications only for genuine,
  // deduplicated completion or input-required transitions.
  // Looser than `isGenuineCompletionTransition`: a turn seen as `unknown -> done` (fast, or
  // missed between polls) is a real completion and used to be announced to nobody.
  const isGenuineCompletion = isNotifiableCompletion(prevStatus, nextStatus)

  if (isGenuineCompletion) {
    triggerCompletionNotification(tabId, nextStatus, nextState.lastSnippet)
    sendToMainWindow('ai-live-status', tabId, false, nextState.lastSnippet || '')
  } else if (nextStatus === 'working' && prevStatus !== 'working') {
    sendToMainWindow('ai-live-status', tabId, true, '')
  }
}

export const tabDiscardManager = new TabDiscardManager({
  getUserDataDir: () => getFinalUserDataDir(),
  isPinned: (tabId: string) => pinnedTabIds.has(tabId),
  isBusy: (tabId: string) => {
    const lifecycle = activeAiLifecycles.get(tabId)
    // Only 'idle' is eligible for discard; unknown, working, waiting-input, done, error are all protected!
    return isProtectedLifecycleStatus(lifecycle?.status)
  },
  retentionGraceMs: 15 * 60 * 1000,
  onTeardown: async (tabId, view, contents) => {
    surfaceRepair.forget(tabId)
    const pendingRepair = repairDeferrals.get(tabId)
    if (pendingRepair) {
      clearTimeout(pendingRepair)
      repairDeferrals.delete(tabId)
    }
    await closeWebContents(contents)
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.contentView.removeChildView(view as unknown as Electron.WebContentsView)
      } catch {}
    }

    aiViews.delete(tabId)
    viewModelKeys.delete(tabId)
    viewTabColors.delete(tabId)
    lastRealBounds.delete(tabId)
    presentedVisible.delete(tabId)
    viewTitles.delete(tabId)
    const timer = aiLifecycleTimers.get(tabId)
    if (timer) {
      clearTimeout(timer)
      aiLifecycleTimers.delete(tabId)
    }
    activeAiLifecycles.delete(tabId)
    tabViewGenerations.delete(tabId)

    // Cleanup orphaned thumbnails
    const safeId = tabId.replace(/[^a-zA-Z0-9._-]/g, '')
    const thumbFilename = lastThumbnailFiles.get(safeId)
    if (thumbFilename) {
      try {
        const fs = require('fs')
        fs.unlink(join(app.getPath('userData'), 'thumbnails', thumbFilename), () => {})
      } catch {}
      lastThumbnailFiles.delete(safeId)
    }

    console.log('[evict]', tabId)
  }
})

// IPC endpoints for tab discard policy & status
ipcMain.handle('get_tab_discard_policy', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { success: false, reason: 'untrusted_sender' }
  }
  const { policy, revision } = tabDiscardManager.getPolicy()
  return { success: true, policy, revision }
})

ipcMain.handle('set_tab_discard_policy', (event, partial: unknown, expectedRevision?: number) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { success: false, reason: 'untrusted_sender' }
  }
  return tabDiscardManager.setPolicy(partial, expectedRevision)
})

ipcMain.handle('get_tab_discard_status', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { success: false, reason: 'untrusted_sender' }
  }
  return { success: true, status: tabDiscardManager.getStatus() }
})

ipcMain.handle('get_cache_stats', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { success: false, reason: 'untrusted_sender' }
  }
  return { success: true, stats: getCacheStats(getFinalUserDataDir()) }
})

ipcMain.handle('purge_cache', async (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { success: false, reason: 'untrusted_sender' }
  }
  return pruneAppCaches(getFinalUserDataDir())
})

ipcMain.handle('capture_diagnostics', async (event, samplingMs?: number) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { success: false, reason: 'untrusted_sender' }
  }
  const views = new Map<string, ViewContextInfo>()
  for (const [tabId, view] of aiViews.entries()) {
    views.set(tabId, {
      tabId,
      modelKey: viewModelKeys.get(tabId) || '',
      title: viewTitles.get(tabId) || '',
      url: !view.webContents.isDestroyed() ? view.webContents.getURL() : '',
      webContents: view.webContents
    })
  }

  const report = await captureDiagnosticReport(
    {
      userDataDir: getFinalUserDataDir(),
      mainWindowWebContents: mainWindow?.webContents,
      activeViewId,
      views,
      isPinned: (tabId) => pinnedTabIds.has(tabId),
      isEvicted: (tabId) => tabDiscardManager.isTabEvicted(tabId),
      tabDiscardPolicy: tabDiscardManager.getPolicy().policy
    },
    typeof samplingMs === 'number' ? samplingMs : 2000
  )

  // The navigation trace travels with the report: an export that explains the CPU but not the
  // navigation is the export that made us guess last time.
  return {
    success: true,
    report: {
      ...report,
      navigationTrace: {
        verbose: navTrace.isVerbose(),
        events: navTrace.events(200),
        text: navTrace.formatAll(200)
      }
    }
  }
})

/**
 * The navigation trace, for the Diagnostics panel.
 *
 * Same data the console prints in development, so the panel and `npm run dev` describe the same story:
 * a request, the load it started, every view operation in between, the abort, and who gave up.
 */
ipcMain.handle(
  'nav_trace_get',
  (event, options?: { tabId?: string; limit?: number; includeText?: boolean }) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return { success: false, reason: 'untrusted_sender' }
    }
    const limit = typeof options?.limit === 'number' && options.limit > 0 ? Math.min(options.limit, 2000) : 400
    const tabId = typeof options?.tabId === 'string' ? options.tabId : ''
    const events = tabId ? navTrace.forTab(tabId, limit) : navTrace.events(limit)

    const tabs = Array.from(aiViews.entries()).map(([id, view]) => {
      let url = ''
      let loading = false
      try {
        url = view.webContents.getURL() || ''
        loading = view.webContents.isLoading()
      } catch {
        url = ''
      }
      const lastEvent = navTrace.forTab(id, 1)[0]
      return {
        tabId: id,
        url,
        modelKey: viewModelKeys.get(id) || '',
        title: viewTitles.get(id) || '',
        active: id === activeViewId,
        loading,
        evicted: (() => {
          try {
            return tabDiscardManager.isTabEvicted(id)
          } catch {
            return false
          }
        })(),
        pendingNavigation: navigationIntent.pendingUrl(id) || '',
        listeners: (() => {
          try {
            return {
              stopLoading: view.webContents.listenerCount('did-stop-loading'),
              failLoad: view.webContents.listenerCount('did-fail-load'),
              startNavigation: view.webContents.listenerCount('did-start-navigation')
            }
          } catch {
            return null
          }
        })(),
        lastEvent: lastEvent
          ? { seq: lastEvent.seq, kind: lastEvent.kind, message: lastEvent.message, t: lastEvent.t }
          : null
      }
    })

    return {
      success: true,
      verbose: navTrace.isVerbose(),
      lastSeq: navTrace.lastSeq(),
      tabId,
      events,
      tabs,
      ...(options?.includeText
        ? {
            text:
              (tabId ? navTrace.formatForTab(tabId, limit, viewTitles.get(tabId) || tabId) : navTrace.formatAll(limit)) +
              '\n\n' +
              tabs
                .map(
                  (t) =>
                    `${t.active ? '*' : ' '} ${t.tabId} ${t.modelKey || '?'} loading=${t.loading} evicted=${t.evicted} pending=${t.pendingNavigation || '—'} ${t.url || '(empty)'}`
                )
                .join('\n')
          }
        : {})
    }
  }
)

/**
 * A note from the renderer, into the same trace.
 *
 * The renderer decides two things main cannot see: which URL the address bar asked for, and whether a
 * URL the page reported about itself is written onto the tab (`shouldAcceptReportedUrl`). Both are part
 * of "why did this tab not move", so they belong in the same list as the loads and the aborts.
 */
ipcMain.on(
  'nav_trace_note',
  (event, tabId: string, message: string, data?: Record<string, unknown>) => {
    if (!isValidMainWindowSender(event)) return
    traceNav(String(tabId || ''), 'request', `renderer: ${String(message || '')}`, data)
  }
)

ipcMain.handle('nav_trace_set_verbose', (event, verbose: boolean) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { success: false, reason: 'untrusted_sender' }
  }
  navTrace.setVerbose(Boolean(verbose))
  // Printing is per session on purpose: the next launch decides again from NEXUS_NAV_TRACE/dev mode,
  // so nobody is left with a noisy console and no idea how it got that way.
  traceNav('', 'note', `verbose tracing ${navTrace.isVerbose() ? 'on' : 'off'}`)
  return { success: true, verbose: navTrace.isVerbose() }
})

ipcMain.handle('nav_trace_clear', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { success: false, reason: 'untrusted_sender' }
  }
  navTrace.clear()
  return { success: true }
})

ipcMain.handle('export_diagnostics_file', async (event, report) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { success: false, reason: 'untrusted_sender' }
  }
  return saveDiagnosticsToFile(report)
})

// Explicit, trusted-shell-only video diagnostics. No URLs, media data or tokens.
ipcMain.handle('get_media_diagnostics', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { success: false, reason: 'untrusted_sender' }
  }
  return {
    success: true,
    platform: process.platform,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    gpuFeatureStatus: app.getGPUFeatureStatus()
  }
})

// Opt-in diagnostics; no polling timer, URLs, prompts, cookies, or page text.
ipcMain.handle('get_resource_diagnostics', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { success: false, reason: 'untrusted_sender' }
  }
  const owned = new Map<number, { kind: string; tabId?: string; provider?: string }>([
    [mainWindow.webContents.id, { kind: 'shell' }]
  ])
  for (const [tabId, view] of aiViews) {
    try {
      const contents = view?.webContents
      if (contents && !contents.isDestroyed()) {
        owned.set(contents.id, { kind: 'ai-view', tabId, provider: viewModelKeys.get(tabId) })
      }
    } catch {
      /* stale native wrapper: manager status retains ownership */
    }
  }
  const contents = electronWebContents.getAllWebContents().flatMap((wc) => {
    try {
      if (wc.isDestroyed()) return []
      return [
        {
          id: wc.id,
          pid: wc.getOSProcessId(),
          type: wc.getType(),
          owner: owned.get(wc.id) || { kind: 'popup-or-other' }
        }
      ]
    } catch {
      return []
    }
  })
  return {
    success: true,
    capturedAt: new Date().toISOString(),
    electron: process.versions.electron,
    discard: tabDiscardManager.getStatus(),
    preview: previewLoop.getStatus(),
    contents,
    processes: app.getAppMetrics()
  }
})

// IPC endpoints for in-app notification toasts & app focus detection
ipcMain.handle('notification_diagnostics', () => {
  const snapshot = notificationRecorder.snapshot()
  return { ...snapshot, preferences: notificationPreferences(), summary: notificationRecorder.summary() }
})

ipcMain.handle('notification_preferences', () => notificationPreferences())

ipcMain.on('set_notification_preferences', (event, change) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return
  updateNotificationPreferences(change)
})

ipcMain.handle('is_app_focused', () => {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.isVisible() &&
    !mainWindow.isMinimized() &&
    mainWindow.isFocused()
  )
})

ipcMain.on('show_in_app_toast', (event, data) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return
  showInAppToast(data)
})

ipcMain.on('dismiss_in_app_toast', (event) => {
  const isAllowed =
    (aiNotificationView && event.sender === aiNotificationView.webContents) ||
    (mainWindow && event.sender === mainWindow.webContents)
  if (!isAllowed) return
  dismissInAppToast(false)
})

ipcMain.on('notification_click_switch_tab', (event, tabId) => {
  const isAllowed =
    (aiNotificationView && event.sender === aiNotificationView.webContents) ||
    (mainWindow && event.sender === mainWindow.webContents)
  if (!isAllowed || typeof tabId !== 'string') return
  dismissInAppToast(true)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    sendToMainWindow('notification_switch_to_tab', tabId)
  }
})

ipcMain.on('set_tab_discard_time', (_event, minutes) => {
  if (typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 0) {
    tabDiscardManager.setPolicy({ tabDiscardMinutes: minutes })
  }
})

ipcMain.on('set_max_active_tabs', (_event, max) => {
  if (typeof max === 'number' && Number.isInteger(max) && max >= 0) {
    tabDiscardManager.setPolicy({ maxActiveTabs: max })
  }
})

ipcMain.on('show_toast', (_event, msg: string) => {
  if (!activeViewId) return
  const view = aiViews.get(activeViewId)
  if (!view) return

  const code = `
    (function() {
      let t = document.getElementById('__nexusTabToast');
      if (!t) {
        t = document.createElement('div');
        t.id = '__nexusTabToast';
        t.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);background:rgba(20,20,20,.92);color:#fff;font:14px/1.5 system-ui,sans-serif;padding:8px 24px;border-radius:999px;z-index:2147483647;pointer-events:none;opacity:0;transition:all .3s cubic-bezier(0.16, 1, 0.3, 1);white-space:nowrap;box-shadow:0 8px 32px rgba(0,0,0,.4);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.1);margin-top:-10px;';
        document.documentElement.appendChild(t);
      }
      t.textContent = ${JSON.stringify(msg)};
      requestAnimationFrame(() => {
        t.style.opacity = '1';
        t.style.marginTop = '0px';
      });
      clearTimeout(t._t);
      t._t = setTimeout(() => {
        t.style.opacity = '0';
        t.style.marginTop = '-10px';
      }, 3000);
    })();
  `
  view.webContents.executeJavaScript(code).catch(() => {})
})

let tray: Tray | null = null
let isQuitting = false
let autoUpdateService: AutoUpdateService | null = null

function updateSupport(): boolean {
  let packageType = ''
  try {
    packageType = readFileSync(
      join(process.resourcesPath, 'app.asar.unpacked', 'package.json'),
      'utf-8'
    )
  } catch {}
  const pkg = packageType ? JSON.parse(packageType) : undefined
  return supportsAutomaticUpdates({
    packaged: app.isPackaged,
    platform: process.platform,
    appImage: process.env.APPIMAGE || undefined,
    portableExecutable: process.env.PORTABLE_EXECUTABLE_FILE || undefined,
    packageType: pkg?.build?.linux?.target?.[0]?.target
  })
}

function unsupportedUpdateStatus(): UpdateStatus {
  return {
    phase: 'unsupported',
    currentVersion: app.getVersion(),
    message: 'Automatic updates are not supported on this installation.'
  }
}

function startAutoUpdates() {
  if (autoUpdateService || !updateSupport()) return
  try {
    const electronUpdater = require('electron-updater')
    const { autoUpdater } = electronUpdater
    // Use configured engine settings where available
    autoUpdater.autoDownload = true
    // A downloaded update applies on any ordinary quit as well as on the timer, so "Later" is never the
    // same as losing it — and a friend who closes Nexus for the night still wakes up on the new build.
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    const publish = (state: UpdateStatus) => {
      sendToMainWindow('nexus-update-status', state)
    }
    autoUpdateService = new AutoUpdateService({
      engine: autoUpdater as UpdateEngine,
      version: app.getVersion(),
      publish,
      notifyRestart: () => {
        if (Notification.isSupported()) {
          new Notification({
            title: 'Nexus update',
            body: 'Nexus is restarting to install an update. Unsaved input may be lost.'
          }).show()
        }
      },
      notifyReady: (state) => {
        if (!Notification.isSupported()) return
        const what = state.targetVersion ? `Nexus ${state.targetVersion}` : 'An update'
        new Notification({
          title: 'Nexus update ready',
          body: `${what} is downloaded. Restart from Settings to install it now, or leave it — it installs when you quit.`
        }).show()
      },
      prepareInstall: async () => {
        // Bound shutdown preparation: fail open if cookie flush hangs.
        await Promise.race([
          flushGoogleSessionStore(session.fromPartition('persist:ai-shared')).catch(() => {}),
          new Promise<void>((resolve) => setTimeout(resolve, 3000))
        ])
        isQuitting = true
      },
      installFailed: () => {
        isQuitting = false
      }
    })
    autoUpdateService.start()
    // The quarter-hour cadence is the floor, not the schedule. These two are the moments a person is
    // actually in front of the app again — and nudge() throttles them, so alt-tabbing costs nothing.
    try {
      powerMonitor.on('resume', () => autoUpdateService?.nudge('the machine woke up'))
    } catch (error) {
      console.warn('[auto-update] power resume hook unavailable:', error)
    }
    try {
      app.on('browser-window-focus', () => autoUpdateService?.nudge('a window gained focus'))
    } catch (error) {
      console.warn('[auto-update] focus hook unavailable:', error)
    }
  } catch (error) {
    console.error('[auto-update] Could not initialize updater:', error)
  }
}
export let currentUiZoom = 1.0
let currentWebviewZoom = 1.0
let currentGlobalHotkey: string | null = null

function toggleMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide()
    } else {
      const bounds = getTargetWindowBounds()
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      }
      mainWindow.setBounds(bounds)
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  } else {
    createWindow()
  }
}

function updateGlobalHotkey(hotkey: string | null) {
  if (currentGlobalHotkey) {
    globalShortcut.unregister(currentGlobalHotkey)
    currentGlobalHotkey = null
  }
  if (!hotkey || hotkey === 'none') return true

  const registered = globalShortcut.register(hotkey, () => {
    toggleMainWindow()
  })

  if (registered) {
    currentGlobalHotkey = hotkey
    console.log(`[Nexus] Global hotkey registered: ${hotkey}`)
    return true
  }
  console.error(`[Nexus] Failed to register global hotkey: ${hotkey}`)
  return false
}

ipcMain.handle('get_global_hotkey', () => currentGlobalHotkey)

ipcMain.handle('set_global_hotkey', (_event, newHotkey: string) => {
  const configPath = join(app.getPath('userData'), 'config.json')
  let cfg: any = {}
  try {
    cfg = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {}
  cfg.hotkey = newHotkey
  try {
    writeFileSync(configPath, JSON.stringify(cfg, null, 2))
  } catch {}

  return updateGlobalHotkey(newHotkey)
})

ipcMain.on('open_active_devtools', () => {
  if (activeViewId) {
    const view = aiViews.get(activeViewId)
    if (view) view.webContents.openDevTools({ mode: 'detach' })
  }
})

ipcMain.on('trigger_active_upload_folder', async (event) => {
  if (!isValidMainWindowSender(event)) return
  recoverAbandonedPicker(mainWindow)
  if (activeViewId && mainWindow && !mainWindow.isDestroyed()) {
    const view = aiViews.get(activeViewId)
    if (view && !view.webContents.isDestroyed()) {
      await handleFolderUpload(view, mainWindow)
    }
  }
})

ipcMain.on('confirm_folder_upload', async (event, payload: ConfirmFolderUploadPayload) => {
  if (!isValidMainWindowSender(event)) return
  if (
    activeViewId &&
    mainWindow &&
    !mainWindow.isDestroyed() &&
    Array.isArray(payload?.selectedPaths) &&
    payload.selectedPaths.length > 0
  ) {
    const view = aiViews.get(activeViewId)
    if (view && !view.webContents.isDestroyed()) {
      const modelKey = viewModelKeys.get(activeViewId) || ''
      const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
      await bundleAndInjectSelectedFiles(
        view,
        payload.folderPath,
        payload.selectedPaths,
        feats.attachmentSelector
      ).catch((err) => {
        console.error('Folder upload confirm failed:', err)
      })
    }
  }
})

ipcMain.handle('preview_folder_bundle', async (event, payload: ConfirmFolderUploadPayload) => {
  if (!isValidMainWindowSender(event))
    return { text: '', fileCount: 0, byteSize: 0, filesIncluded: [], omittedFromTextBundle: [] }
  if (!payload || !Array.isArray(payload.selectedPaths) || payload.selectedPaths.length === 0) {
    return { text: '', fileCount: 0, byteSize: 0, filesIncluded: [], omittedFromTextBundle: [] }
  }
  // Non-text selections are never decoded as text; they are attached as originals instead.
  const { textPaths, originals } = splitSelectionByDelivery(payload.folderPath, payload.selectedPaths)
  const preview = await generateBundleTextAsync(payload.folderPath, textPaths)
  return { ...preview, omittedFromTextBundle: originals.map((item) => item.relativePath) }
})

ipcMain.handle(
  'save_folder_bundle_to_disk',
  async (event, payload: ConfirmFolderUploadPayload & { useDialog?: boolean }) => {
    if (!isValidMainWindowSender(event)) return { success: false, error: 'Unauthorized sender' }
    if (!payload || !Array.isArray(payload.selectedPaths) || payload.selectedPaths.length === 0) {
      return { success: false, error: 'No files selected to bundle.' }
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Main window is not available.' }
    }
    const folderName = path.basename(payload.folderPath).replace(/[^a-zA-Z0-9_-]/g, '_')
    const targetDir = activeProjectDir || join(app.getPath('downloads'), 'nexus')

    try {
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true })
      }

      let filePath: string
      if (payload.useDialog) {
        const { canceled, filePath: dialogPath } = await dialog.showSaveDialog(mainWindow, {
          title: 'Save Codebase Bundle',
          defaultPath: join(targetDir, `${folderName}_codebase_bundle.txt`),
          filters: [
            { name: 'Text Bundle (*.txt)', extensions: ['txt'] },
            { name: 'All Files (*.*)', extensions: ['*'] }
          ]
        })
        if (canceled || !dialogPath) {
          return { success: false, canceled: true }
        }
        filePath = dialogPath
      } else {
        // Auto-download directly to nexus downloads folder
        filePath = join(targetDir, `${folderName}_codebase_bundle_${Date.now()}.txt`)
      }

      const { textPaths } = splitSelectionByDelivery(payload.folderPath, payload.selectedPaths)
      const { text, fileCount, byteSize } = await generateBundleTextAsync(
        payload.folderPath,
        textPaths
      )
      fs.writeFileSync(filePath, text, 'utf-8')
      clipboard.writeText(filePath)
      return { success: true, savedPath: filePath, fileCount, byteSize, copiedToClipboard: true }
    } catch (err: any) {
      console.error('Failed to save codebase bundle to disk:', err)
      return { success: false, error: err?.message || 'Failed to write bundle file.' }
    }
  }
)

ipcMain.handle(
  'partition_folder_bundle',
  async (
    event,
    payload: {
      folderPath: string
      selectedPaths: string[]
      maxChunkBytes?: number
      enableCompression?: boolean
    }
  ) => {
    if (!isValidMainWindowSender(event)) return null
    if (!payload || !Array.isArray(payload.selectedPaths) || payload.selectedPaths.length === 0) {
      return null
    }
    return partitionCodebaseFiles(
      payload.folderPath,
      payload.selectedPaths,
      payload.maxChunkBytes || 8 * 1024 * 1024,
      payload.enableCompression ?? false
    )
  }
)

ipcMain.handle(
  'upload_chunks_sequentially',
  async (event, payload: { folderName: string; chunks: BundleChunk[]; originalPaths?: string[] }) => {
    if (!isValidMainWindowSender(event)) return { success: false, error: 'Unauthorized sender' }
    if (
      activeViewId &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      payload &&
      Array.isArray(payload.chunks) &&
      payload.chunks.length > 0
    ) {
      const view = aiViews.get(activeViewId)
      if (view && !view.webContents.isDestroyed()) {
        const modelKey = viewModelKeys.get(activeViewId) || ''
        const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
        await uploadChunksSequentially(
          view,
          mainWindow,
          payload.chunks,
          payload.folderName,
          feats.attachmentSelector
        )
        return { success: true }
      }
    }
    return { success: false, error: 'Active AI view is not available' }
  }
)

ipcMain.handle(
  'upload_single_chunk',
  async (event, payload: { folderName: string; chunk: BundleChunk }) => {
    if (!isValidMainWindowSender(event)) return { success: false, error: 'Unauthorized sender' }
    if (activeViewId && mainWindow && !mainWindow.isDestroyed() && payload?.chunk) {
      const view = aiViews.get(activeViewId)
      if (view && !view.webContents.isDestroyed()) {
        const modelKey = viewModelKeys.get(activeViewId) || ''
        const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
        await uploadChunksSequentially(
          view,
          mainWindow,
          [payload.chunk],
          payload.folderName,
          feats.attachmentSelector
        )
        return { success: true }
      }
    }
    return { success: false, error: 'Active AI view is not available' }
  }
)

ipcMain.handle(
  'attach_all_chunks',
  async (
    event,
    payload: { folderName: string; chunks: BundleChunk[]; originalPaths?: string[] }
  ) => {
    if (!isValidMainWindowSender(event)) return { success: false, error: 'Unauthorized sender' }
    if (!activeViewId || !mainWindow || mainWindow.isDestroyed())
      return { success: false, error: 'Active AI view is not available' }
    if (!payload || !Array.isArray(payload.chunks) || payload.chunks.length === 0)
      return { success: false, error: 'No parts to attach' }

    const view = aiViews.get(activeViewId)
    if (!view || view.webContents.isDestroyed())
      return { success: false, error: 'Active AI view is not available' }

    const modelKey = viewModelKeys.get(activeViewId) || ''
    const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
    const originalFiles = Array.isArray(payload.originalPaths) ? payload.originalPaths : []
    const result = await attachChunksAsOneMessage(
      view,
      payload.chunks,
      payload.folderName,
      feats.attachmentSelector,
      originalFiles
    )
    return result
  }
)

// ---------------------------------------------------------------------------
// Video preparation (plan 01)
//
// Two rules this block exists to enforce:
//  1. preparation is local and read-only on the user's file; nothing leaves the
//     machine until the user presses Send in the provider UI;
//  2. a provider is never assumed to accept video — the verdict comes from recorded
//     observations, and defaults to `unknown`.
// ---------------------------------------------------------------------------

function videoCapabilityFile(): string {
  return join(app.getPath('userData'), 'video-capability.json')
}

function loadVideoCapabilityStore(): CapabilityStore {
  try {
    const raw = readFileSync(videoCapabilityFile(), 'utf-8')
    const parsed = JSON.parse(raw) as CapabilityStore
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.observations)) {
      return emptyCapabilityStore()
    }
    // Drop anything malformed rather than trusting a hand-edited file.
    return {
      version: 1,
      observations: parsed.observations.filter((entry) => validateObservation(entry) === null)
    }
  } catch {
    return emptyCapabilityStore()
  }
}

function saveVideoCapabilityStore(store: CapabilityStore): void {
  try {
    writeFileSync(videoCapabilityFile(), JSON.stringify(store, null, 2), 'utf-8')
  } catch (error) {
    console.warn('[video] could not persist capability observations:', error)
  }
}

/** Which local tools exist — the UI must be able to say exactly what is missing. */
ipcMain.handle('get_media_tool_status', (event) => {
  if (!isValidMainWindowSender(event)) return { authorized: false }
  const tools = locateMediaTools()
  return {
    authorized: true,
    ffprobe: Boolean(tools.ffprobe),
    ffmpeg: Boolean(tools.ffmpeg),
    source: tools.source ?? 'none'
  }
})

ipcMain.handle('get_video_capability', (event, payload: { provider?: string; model?: string } = {}) => {
  if (!isValidMainWindowSender(event)) return { authorized: false }
  const store = loadVideoCapabilityStore()
  const verdict = assessVideoCapability(
    { provider: payload.provider ?? 'unknown-provider', model: payload.model, kind: 'video' },
    store.observations
  )
  return { authorized: true, verdict }
})

/**
 * Record what the user actually observed. Deliberately explicit about the fact: an
 * accept-attribute hint must never be stored as acceptance, so the caller has to say
 * which fact it saw and the store rejects anything malformed.
 */
ipcMain.handle(
  'record_video_capability_observation',
  (
    event,
    payload: {
      provider?: string
      model?: string
      status?: 'supported' | 'unsupported'
      fact?: string
      source?: string
      notes?: string
    } = {}
  ) => {
    if (!isValidMainWindowSender(event)) return { authorized: false, success: false }
    const observation = {
      provider: (payload.provider ?? '').trim(),
      model: payload.model || undefined,
      kind: 'video' as const,
      status: payload.status,
      fact: payload.fact,
      source: payload.source,
      observedAt: new Date().toISOString(),
      notes: payload.notes
    }
    const error = validateObservation(observation)
    if (error) return { authorized: true, success: false, error }
    const store = upsertObservation(loadVideoCapabilityStore(), observation as never)
    saveVideoCapabilityStore(store)
    const verdict = assessVideoCapability(
      { provider: observation.provider, model: observation.model, kind: 'video' },
      store.observations
    )
    return { authorized: true, success: true, verdict }
  }
)

ipcMain.handle(
  'prepare_video',
  async (
    event,
    payload: { filePath?: string; pace?: VideoPace; provider?: string; model?: string; userNote?: string } = {}
  ) => {
    if (!isValidMainWindowSender(event)) {
      return { ok: false, reason: 'unauthorized', message: 'Unauthorized sender' }
    }
    if (!payload?.filePath) {
      return { ok: false, reason: 'missing-path', message: 'No video file was selected.' }
    }

    // One preparation at a time: frame extraction is CPU- and disk-heavy.
    videoPrepController?.abort()
    const controller = new AbortController()
    videoPrepController = controller
    try {
      const store = loadVideoCapabilityStore()
      const result = await videoJobs.prepareJob({
        filePath: payload.filePath,
        pace: payload.pace ?? 'balanced',
        provider: payload.provider,
        model: payload.model,
        observations: store.observations,
        userNote: payload.userNote,
        signal: controller.signal
      })
      if (result.ok) {
        console.log(`[video] prepared ${result.summary.jobId}: ${result.summary.frameCount} still(s)`)
      } else {
        console.warn(`[video] preparation failed (${result.reason}): ${result.message}`)
      }
      return result
    } finally {
      if (videoPrepController === controller) videoPrepController = null
    }
  }
)

ipcMain.on('cancel_video_preparation', (event) => {
  if (!isValidMainWindowSender(event)) return
  videoPrepController?.abort()
  videoPrepController = null
  videoJobs.disposeAll()
})

ipcMain.on('discard_video_job', (event, jobId: string) => {
  if (!isValidMainWindowSender(event)) return
  if (typeof jobId === 'string' && jobId) videoJobs.discard(jobId)
})

ipcMain.handle(
  'attach_prepared_video',
  async (
    event,
    payload: { jobId?: string; userNote?: string; includeManifest?: boolean; manifestText?: string } = {}
  ) => {
    if (!isValidMainWindowSender(event)) return { success: false, message: 'Unauthorized sender' }
    if (!payload?.jobId) return { success: false, message: 'No prepared video was selected.' }
    if (!activeViewId || !mainWindow || mainWindow.isDestroyed()) {
      return { success: false, message: 'Active AI view is not available' }
    }
    const view = aiViews.get(activeViewId)
    if (!view || view.webContents.isDestroyed()) {
      return { success: false, message: 'Active AI view is not available' }
    }
    const modelKey = viewModelKeys.get(activeViewId) || ''
    const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
    const result = await videoJobs.attachPreparedVideo({
      jobId: payload.jobId,
      view,
      customSelector: feats.attachmentSelector,
      userNote: payload.userNote,
      includeManifest: payload.includeManifest,
      manifestText: typeof payload.manifestText === 'string' ? payload.manifestText : undefined
    })
    console.log(`[video] attach ${payload.jobId}: ${result.success ? 'ok' : 'failed'} — ${result.message}`)
    return result
  }
)

/**
 * Office preparation (plan 02, stage 3).
 *
 * Read locally, decide out loud, attach only on request. Document contents are never logged:
 * only the file name, the kind and the counts the dialog already shows.
 */
ipcMain.handle(
  'prepare_office',
  async (
    event,
    payload: {
      filePath?: string
      consent?: Record<string, unknown>
      wantPdf?: boolean
      discardJobId?: string
      maxCharsPerPart?: number
    } = {}
  ) => {
    if (!isValidMainWindowSender(event)) {
      return { ok: false, reason: 'unauthorized', message: 'Unauthorized sender' }
    }
    if (!payload?.filePath) {
      return { ok: false, reason: 'missing-path', message: 'No Office file was selected.' }
    }

    // One preparation at a time: parsing a large workbook is CPU- and disk-heavy.
    officePrepController?.abort()
    const controller = new AbortController()
    officePrepController = controller
    // Re-preparing the same file (consent change) replaces the previous job.
    if (typeof payload.discardJobId === 'string' && payload.discardJobId) {
      officeJobs.discard(payload.discardJobId)
    }
    try {
      const result = await prepareOfficeDocument({
        filePath: payload.filePath,
        consent: payload.consent,
        wantPdf: payload.wantPdf === true,
        maxCharsPerPart:
          typeof payload.maxCharsPerPart === 'number' ? payload.maxCharsPerPart : undefined,
        signal: controller.signal
      })
      if (result.ok) {
        const jobId = officeJobs.add({
          fileName: result.preview.fileName,
          parts: result.parts,
          preview: result.preview,
          jobDir: result.jobDir,
          pdfPath: result.pdfPath
        })
        console.log(
          `[office] prepared ${jobId}: ${result.preview.kind}, ${result.parts.length} part(s)`
        )
        return { ...result.preview, ok: true as const, jobId }
      }
      console.warn(`[office] preparation refused (${result.reason}): ${result.message}`)
      return { ...result, jobId: undefined }
    } catch (error) {
      console.error('[office] preparation threw:', error instanceof Error ? error.message : 'unknown')
      return { ok: false, reason: 'unexpected', message: 'Preparation failed unexpectedly.' }
    } finally {
      if (officePrepController === controller) officePrepController = null
    }
  }
)

ipcMain.handle('read_office_part', (event, payload: { jobId?: string; index?: number } = {}) => {
  if (!isValidMainWindowSender(event)) return { ok: false, message: 'Unauthorized sender' }
  if (!payload?.jobId || typeof payload.index !== 'number') {
    return { ok: false, message: 'No part was requested.' }
  }
  return officeJobs.partText(payload.jobId, payload.index)
})

ipcMain.on('discard_office_job', (event, jobId: string) => {
  if (!isValidMainWindowSender(event)) return
  if (typeof jobId === 'string' && jobId) officeJobs.discard(jobId)
})

ipcMain.on('cancel_office_preparation', (event) => {
  if (!isValidMainWindowSender(event)) return
  officePrepController?.abort()
  officePrepController = null
  officeJobs.disposeAll()
})

ipcMain.handle(
  'attach_prepared_office',
  async (
    event,
    payload: {
      jobId?: string
      attachPdf?: boolean
      includeManifest?: boolean
      manifestText?: string
    } = {}
  ) => {
    if (!isValidMainWindowSender(event)) return { success: false, message: 'Unauthorized sender' }
    if (!payload?.jobId) return { success: false, message: 'No prepared file was selected.' }
    if (!activeViewId || !mainWindow || mainWindow.isDestroyed()) {
      return { success: false, message: 'Active AI view is not available' }
    }
    const view = aiViews.get(activeViewId)
    if (!view || view.webContents.isDestroyed()) {
      return { success: false, message: 'Active AI view is not available' }
    }
    const modelKey = viewModelKeys.get(activeViewId) || ''
    const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
    const result = await officeJobs.attachPreparedOffice({
      jobId: payload.jobId,
      view,
      customSelector: feats.attachmentSelector,
      includeManifest: payload.includeManifest,
      manifestText: typeof payload.manifestText === 'string' ? payload.manifestText : undefined,
      attachPdf: payload.attachPdf === true
    })
    // Only the outcome is logged — never the document text.
    console.log(
      `[office] insert ${payload.jobId}: ${result.success ? 'ok' : 'failed'} — ${result.message}`
    )
    return result
  }
)

/**
 * Mixed selections (plan 02, stage 4): a folder drop is rarely only spreadsheets.
 * Each Office file is prepared on its own terms, in the user's order, with its own consent;
 * everything else keeps its normal upload route and is reported back by name.
 */
ipcMain.handle(
  'prepare_office_selection',
  async (
    event,
    payload: {
      filePaths?: string[]
      consentByPath?: Record<string, Record<string, unknown>>
      wantPdf?: boolean
      maxFiles?: number
    } = {}
  ) => {
    if (!isValidMainWindowSender(event)) {
      return { ok: false, message: 'Unauthorized sender' }
    }
    const filePaths = Array.isArray(payload?.filePaths)
      ? payload.filePaths.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : []
    if (filePaths.length === 0) {
      return { ok: false, message: 'No files were selected.' }
    }

    officePrepController?.abort()
    const controller = new AbortController()
    officePrepController = controller
    try {
      const result = await prepareOfficeSelection({
        filePaths,
        consentByPath: payload.consentByPath as
          | Record<string, Partial<OfficeConsent>>
          | undefined,
        wantPdf: payload.wantPdf === true,
        maxFiles: typeof payload.maxFiles === 'number' ? payload.maxFiles : undefined,
        signal: controller.signal,
        onProgress: (entry, index, total) => {
          // Progress goes to the dialog, never to the log: file names only.
          if (mainWindow && !mainWindow.isDestroyed()) {
            sendToMainWindow('office_selection_progress', {
              fileName: entry.fileName,
              index,
              total,
              status: entry.status
            })
          }
        }
      })

      // Register each prepared file as its own job so the user can inspect or discard them
      // individually, then hand the ids back in selection order.
      for (const file of result.prepared) {
        const jobId = officeJobs.add({
          fileName: file.preview.fileName,
          parts: file.parts,
          preview: file.preview,
          jobDir: file.jobDir,
          pdfPath: file.pdfPath
        })
        const entry = result.report.entries.find((candidate) => candidate.filePath === file.filePath)
        if (entry) entry.jobId = jobId
      }

      console.log(
        `[office] selection prepared: ${result.report.ready}/${result.report.entries.length} file(s), ${result.report.totalParts} part(s)`
      )
      return { ok: true as const, ...result }
    } catch (error) {
      console.error('[office] selection failed:', error instanceof Error ? error.message : 'unknown')
      return { ok: false, message: 'Preparing the selection failed unexpectedly.' }
    } finally {
      if (officePrepController === controller) officePrepController = null
    }
  }
)

ipcMain.handle(
  'attach_prepared_office_selection',
  async (event, payload: { jobIds?: string[]; attachPdf?: boolean; manifestText?: string } = {}) => {
    if (!isValidMainWindowSender(event)) return { success: false, message: 'Unauthorized sender' }
    const jobIds = Array.isArray(payload?.jobIds)
      ? payload.jobIds.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : []
    if (jobIds.length === 0) return { success: false, message: 'No prepared files were selected.' }
    if (!activeViewId || !mainWindow || mainWindow.isDestroyed()) {
      return { success: false, message: 'Active AI view is not available' }
    }
    const view = aiViews.get(activeViewId)
    if (!view || view.webContents.isDestroyed()) {
      return { success: false, message: 'Active AI view is not available' }
    }
    const modelKey = viewModelKeys.get(activeViewId) || ''
    const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
    const result = await officeJobs.attachPreparedOfficeMany({
      jobIds,
      view,
      customSelector: feats.attachmentSelector,
      manifestText: typeof payload.manifestText === 'string' ? payload.manifestText : undefined,
      attachPdf: payload.attachPdf === true
    })
    console.log(
      `[office] insert selection (${jobIds.length}): ${result.success ? 'ok' : 'failed'} — ${result.message}`
    )
    return result
  }
)

/**
 * Which provider/model the active tab is on. Video capability is scoped per provider, so
 * the dialog must not guess it. Reported as `unknown` when no tab is active.
 */
ipcMain.handle('get_active_ai_target', (event) => {
  if (!isValidMainWindowSender(event)) return { authorized: false }
  if (!activeViewId) return { authorized: true, tabId: null, provider: null, model: null }
  const modelKey = viewModelKeys.get(activeViewId) || null
  return { authorized: true, tabId: activeViewId, provider: modelKey, model: modelKey }
})

ipcMain.handle(
  'save_single_chunk_to_disk',
  async (event, payload: { folderName: string; chunk: BundleChunk; useDialog?: boolean }) => {
    if (!isValidMainWindowSender(event)) return { success: false, error: 'Unauthorized sender' }
    if (!mainWindow || mainWindow.isDestroyed() || !payload?.chunk) {
      return { success: false, error: 'Main window is not available.' }
    }
    const chunk = payload.chunk
    const safeName = (payload.folderName || 'bundle').replace(/[^a-zA-Z0-9_-]/g, '_')
    const targetDir = activeProjectDir || join(app.getPath('downloads'), 'nexus')

    try {
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true })
      }

      let filePath: string
      if (payload.useDialog) {
        const defaultName = `${safeName}_part${chunk.index}_of_${chunk.totalChunks}.txt`
        const { canceled, filePath: dialogPath } = await dialog.showSaveDialog(mainWindow, {
          title: `Save Chunk Part ${chunk.index}`,
          defaultPath: join(targetDir, defaultName),
          filters: [
            { name: 'Text File (*.txt)', extensions: ['txt'] },
            { name: 'All Files (*.*)', extensions: ['*'] }
          ]
        })
        if (canceled || !dialogPath) {
          return { success: false, canceled: true }
        }
        filePath = dialogPath
      } else {
        filePath = join(
          targetDir,
          `${safeName}_part${chunk.index}_of_${chunk.totalChunks}_${Date.now()}.txt`
        )
      }

      fs.writeFileSync(filePath, chunk.content, 'utf-8')
      clipboard.writeText(filePath)
      return { success: true, savedPath: filePath, copiedToClipboard: true }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to save chunk.' }
    }
  }
)

ipcMain.on('trigger_active_upload', async () => {
  recoverAbandonedPicker(mainWindow)
  if (activeViewId && mainWindow && !mainWindow.isDestroyed()) {
    const view = aiViews.get(activeViewId)
    if (view && !view.webContents.isDestroyed()) {
      const modelKey = viewModelKeys.get(activeViewId) || ''
      const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
      await handleFileUpload(view, mainWindow, feats.attachmentSelector)
    }
  }
})

ipcMain.handle('shell_open', async (event, url: string) => {
  if (!isValidMainWindowSender(event)) return
  if (!url || typeof url !== 'string') return
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'mailto:'
    ) {
      await shell.openExternal(url)
    } else {
      console.warn('[Security] Blocked non-http/https external open URL:', url)
    }
  } catch {
    console.warn('[Security] Invalid URL passed to shell_open:', url)
  }
})

ipcMain.handle('test_provider_live_hooks', async (_event, modelKey: string) => {
  // ACTIVE view first when it belongs to this provider — the old code broke on
  // the FIRST-inserted tab of the model (Map iteration order).
  let targetView: Electron.WebContentsView | null = null
  if (activeViewId) {
    const v = aiViews.get(activeViewId)
    if (v && viewModelKeys.get(activeViewId) === modelKey) targetView = v
  }
  if (!targetView) {
    for (const [tabId, view] of aiViews) {
      if (viewModelKeys.get(tabId) === modelKey) {
        targetView = view
        break
      }
    }
  }
  if (!targetView && activeViewId && aiViews.has(activeViewId)) {
    targetView = aiViews.get(activeViewId)!
  }
  if (!targetView || targetView.webContents.isDestroyed()) {
    return { success: false, reason: 'no_view' }
  }
  const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
  const compSel = feats.composerSelector || 'textarea, [contenteditable="true"]'
  const attachSel = feats.attachmentSelector || 'input[type="file"]'
  const script = `(() => {
    ${PAGE_HELPERS}
    const flash = (list, color) => {
      for (const s of splitList(list)) {
        try {
          for (const el of document.querySelectorAll(s)) {
            if (!visibleEl(el)) continue
            const prevO = el.style.outline, prevS = el.style.boxShadow;
            el.style.outline = '3px solid ' + color;
            el.style.boxShadow = '0 0 20px ' + color;
            setTimeout(() => { el.style.outline = prevO; el.style.boxShadow = prevS; }, 1600);
            return { found: true, via: s, tag: el.tagName.toLowerCase() };
          }
        } catch {}
      }
      return { found: false };
    };
    const comp = flash(${JSON.stringify(compSel)}, '#00e5ff');
    const attach = flash(${JSON.stringify(attachSel)}, '#34d399');
    return { success: true, compFound: comp.found, compVia: comp.via || null, compTag: comp.tag || null,
             attachFound: attach.found, attachVia: attach.via || null, attachTag: attach.tag || null };
  })()`
  return targetView.webContents.executeJavaScript(script).catch(() => ({ success: false }))
})

async function clickActiveViewFeature(
  field: 'stopGenerationSelector' | 'newChatSelector'
): Promise<{ ok: boolean; reason?: string }> {
  if (!activeViewId) return { ok: false, reason: 'no_active_view' }
  const view = aiViews.get(activeViewId)
  if (!view || view.webContents.isDestroyed()) return { ok: false, reason: 'no_active_view' }
  const modelKey = viewModelKeys.get(activeViewId) || ''
  const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
  const sel = feats[field]
  if (!sel) return { ok: false, reason: 'no_selector_configured' }
  const script = `(async () => {
    ${PAGE_HELPERS}
    for (const s of splitList(${JSON.stringify(sel)})) {
      try {
        for (const el of document.querySelectorAll(s)) {
          if (el instanceof HTMLButtonElement && el.disabled) continue
          if (!visibleEl(el)) continue
          el.scrollIntoView({ block: 'center' });
          el.click();
          return { ok: true, via: s };
        }
      } catch {}
    }
    return { ok: false, reason: 'no_match' };
  })()`
  return view.webContents
    .executeJavaScript(script, true)
    .catch(() => ({ ok: false, reason: 'error' }))
}

ipcMain.handle('ai_stop_generation', () => clickActiveViewFeature('stopGenerationSelector'))
ipcMain.handle('ai_site_new_chat', () => clickActiveViewFeature('newChatSelector'))

function isValidMainWindowSender(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent
): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (event.sender !== mainWindow.webContents) return false
  if (event.senderFrame && event.senderFrame !== mainWindow.webContents.mainFrame) {
    return false
  }
  return true
}

ipcMain.on('window_minimize', (event) => {
  if (!isValidMainWindowSender(event)) return
  mainWindow?.minimize()
})

ipcMain.on('window_maximize_toggle', (event) => {
  if (!isValidMainWindowSender(event)) return
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
})

ipcMain.on('window_close', (event) => {
  if (!isValidMainWindowSender(event)) return
  mainWindow?.close()
})

ipcMain.handle('window_is_maximized', (event) => {
  if (!isValidMainWindowSender(event)) return false
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false
})

ipcMain.on('claim_window_focus', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    mainWindow.focusOnWebView()
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.focus()
    }
  }
})

ipcMain.on('set_ui_zoom', (_, zoom) => {
  currentUiZoom = zoom
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomFactor(zoom)
  }
})

ipcMain.on('set_webview_zoom', (_, zoom) => {
  currentWebviewZoom = zoom
  for (const view of aiViews.values()) {
    if (view && view.webContents) {
      view.webContents.setZoomFactor(zoom)
    }
  }
})

ipcMain.handle('get_platform', () => {
  return process.platform
})

// Active project directory for intelligent download routing
let activeProjectDir: string | null = null

ipcMain.on('downloads_set_active_project_dir', (event, dir: string | null) => {
  if (!isValidMainWindowSender(event)) return
  activeProjectDir = dir && typeof dir === 'string' && dir.trim() ? dir.trim() : null
})

ipcMain.handle('downloads_show_item_in_folder', async (event, fullPath: string) => {
  if (!isValidMainWindowSender(event)) return
  if (fullPath && typeof fullPath === 'string' && existsSync(fullPath)) {
    shell.showItemInFolder(fullPath)
  }
})

ipcMain.handle('downloads_open_path', async (event, fullPath: string) => {
  if (!isValidMainWindowSender(event)) return 'Unauthorized'
  if (fullPath && typeof fullPath === 'string' && existsSync(fullPath)) {
    return await shell.openPath(fullPath)
  }
  return 'File not found'
})

ipcMain.on('downloads_copy_path', (event, fullPath: string) => {
  if (!isValidMainWindowSender(event)) return
  if (fullPath && typeof fullPath === 'string') {
    clipboard.writeText(fullPath)
  }
})

ipcMain.handle('downloads_get_default_dir', async () => {
  return join(app.getPath('downloads'), 'nexus')
})

const registeredSessions = new WeakSet<Electron.Session>()

function registerDownloadHandler(targetSession: Electron.Session) {
  if (registeredSessions.has(targetSession)) return
  registeredSessions.add(targetSession)

  targetSession.on('will-download', (_event, item, _webContents) => {
    const rawFilename = item.getFilename() || 'download'
    const targetDir =
      activeProjectDir && existsSync(activeProjectDir)
        ? activeProjectDir
        : join(app.getPath('downloads'), 'nexus')

    try {
      mkdirSync(targetDir, { recursive: true })
    } catch (err) {
      console.error('[Nexus Downloads] Failed to create destination directory:', targetDir, err)
    }

    // Determine unique save path avoiding accidental file clobbering
    let savePath = join(targetDir, rawFilename)
    const ext = extname(rawFilename)
    const base = basename(rawFilename, ext)
    let counter = 1
    while (existsSync(savePath)) {
      savePath = join(targetDir, `${base} (${counter})${ext}`)
      counter++
    }

    item.setSavePath(savePath)

    item.on('done', (_doneEvent, state) => {
      if (state === 'completed') {
        const finalPath = item.getSavePath() || savePath
        const isProject = Boolean(activeProjectDir && targetDir === activeProjectDir)
        const downloadInfo = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          filename: basename(finalPath),
          fullPath: finalPath,
          directory: targetDir,
          fileSize: item.getTotalBytes(),
          mimeType: item.getMimeType(),
          isProjectDir: isProject,
          timestamp: Date.now()
        }

        sendToMainWindow('download_completed', downloadInfo)
        downloadNotificationOverlay?.show({
          id: downloadInfo.id,
          filename: downloadInfo.filename,
          fullPath: downloadInfo.fullPath,
          size: downloadInfo.fileSize,
          destination: downloadInfo.directory
        })
      } else if (state === 'interrupted' || state === 'cancelled') {
        console.warn(`[Nexus Downloads] Download ${state}: ${rawFilename}`)
      }
    })
  })
}

async function injectSkillPromptIntoWebview(
  tabId: string,
  promptText: string,
  autoSend: boolean = false
): Promise<boolean> {
  const view = aiViews.get(tabId)
  if (!view || view.webContents.isDestroyed()) return false

  const modelKey = viewModelKeys.get(tabId) || ''
  const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
  const effectiveAutoSend = autoSend || feats.autoSubmitSkillPrompt === true

  const script = `
    (async () => {
      ${PAGE_HELPERS}
      const text = ${JSON.stringify(promptText)};
      const autoSend = ${Boolean(effectiveAutoSend)};
      const customComp = ${JSON.stringify(feats.composerSelector || '')};
      const customSnd = ${JSON.stringify(feats.sendButtonSelector || '')};

      const baseSelectors = [
        '.ql-editor', 'rich-textarea [contenteditable="true"]',
        '#prompt-textarea', 'div#prompt-textarea', 'textarea[data-id="root"]',
        'div.ProseMirror', 'div[contenteditable="true"].ProseMirror',
        'div.chat-input-editor', '.chat-input [contenteditable="true"]', '.chat-input textarea',
        'textarea#chat-input', 'textarea[class*="chat-input"]', 'textarea.ant-input:not([disabled])',
        '#chat-input', 'textarea[placeholder*="Ask"]',
        '[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]',
        'textarea:not([disabled])'
      ];
      const selectors = [...splitList(customComp), ...baseSelectors];

      let el = null;
      for (const s of selectors) {
        try { const f = document.querySelector(s); if (f && visibleEl(f)) { el = f; break } } catch {}
      }
      if (!el) {
        for (const s of selectors) {
          try { const f = document.querySelector(s); if (f) { el = f; break } } catch {}
        }
      }
      if (!el) return false;
      el.focus();

      if (el.isContentEditable) {
        const wsel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        wsel.removeAllRanges(); wsel.addRange(range);
        document.execCommand('insertText', false, text); // fires real input events (Lexical/ProseMirror)
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // React value-tracker bypass: plain el.value = text gets deduplicated by
        // React, so the composer never updates and the send button never enables.
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
          : el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
        const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, text); else el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      try { el.scrollTop = el.scrollHeight; } catch (e) {}
      if (!autoSend) return true;

      // Poll up to 2.5 s for the site to ENABLE its send button after the input event.
      const baseSendSelectors = [
        'button[aria-label*="Send"]', 'button[data-testid="send-button"]',
        'button[aria-label*="Submit"]', '.send-button', 'button.mb-1.me-1', 'button[type="submit"]'
      ];
      const sendSegments = [...splitList(customSnd), ...baseSendSelectors];
      const findSendButton = () => {
        for (const s of sendSegments) {
          try {
            for (const b of document.querySelectorAll(s)) {
              if (b instanceof HTMLButtonElement && !b.disabled && visibleEl(b)) return b;
            }
          } catch {}
        }
        return null;
      };
      for (let i = 0; i < 25; i++) {
        const btn = findSendButton();
        if (btn) { btn.click(); return true; }
        await new Promise((r) => setTimeout(r, 100));
      }
      el.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
      }));
      return true;
    })()
  `

  try {
    const result = await view.webContents.executeJavaScript(script)
    return Boolean(result)
  } catch (err) {
    console.error('[injectSkillPromptIntoWebview] Injection error:', err)
    return false
  }
}

// Skills & Project Directory IPC Handlers

ipcMain.handle('switch_to_tauri', () => {
  console.log('Switching to Tauri (Nexus Lite)...')

  const projectRoot =
    process.env.NODE_ENV === 'development'
      ? path.join(__dirname, '../../')
      : path.join(app.getAppPath(), '../../') // Might need adjustment in prod

  const releaseBin =
    process.platform === 'win32'
      ? path.join(projectRoot, 'src-tauri/target/release/nexus.exe')
      : path.join(projectRoot, 'src-tauri/target/release/nexus')

  let child
  if (fs.existsSync(releaseBin)) {
    child = spawn(releaseBin, [], {
      detached: true,
      stdio: 'ignore',
      cwd: projectRoot,
      shell: true
    })
  } else {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    child = spawn(npmCmd, ['run', 'tauri', 'dev'], {
      detached: true,
      stdio: 'ignore',
      cwd: projectRoot,
      shell: true
    })
  }
  child.unref()
  setTimeout(() => {
    app.quit()
  }, 200)
})

ipcMain.handle('skills_list', (event) => {
  if (!isValidMainWindowSender(event)) return []
  return skillsEngine.listSkills()
})
ipcMain.handle('skills_save', (event, skill: SkillDef) => {
  if (!isValidMainWindowSender(event)) return { success: false, error: 'Unauthorized sender' }
  return skillsEngine.saveSkill(skill)
})
ipcMain.handle('skills_delete', (event, skillId: string) => {
  if (!isValidMainWindowSender(event)) return { success: false, error: 'Unauthorized sender' }
  return skillsEngine.deleteSkill(skillId)
})
ipcMain.handle('skills_toggle_pin', (event, skillId: string) => {
  if (!isValidMainWindowSender(event)) return { success: false, error: 'Unauthorized sender' }
  return skillsEngine.togglePin(skillId)
})
ipcMain.handle('skills_increment_usage', (event, skillId: string) => {
  if (!isValidMainWindowSender(event)) return
  return skillsEngine.incrementUsage(skillId)
})

ipcMain.handle('skills_get_pinned_categories', (event) => {
  if (!isValidMainWindowSender(event)) return []
  return skillsEngine.getPinnedCategories()
})
ipcMain.handle('skills_toggle_category_pin', async (event, cat) => {
  if (!isValidMainWindowSender(event)) return false
  return await skillsEngine.toggleCategoryPin(cat)
})
ipcMain.handle('skills_rename_category', async (event, oldName, newName) => {
  if (!isValidMainWindowSender(event)) return false
  return await skillsEngine.renameCategory(oldName, newName)
})
ipcMain.handle('skills_delete_category', async (event, cat) => {
  if (!isValidMainWindowSender(event)) return false
  return await skillsEngine.deleteCategory(cat)
})
ipcMain.handle('skills_assign_category', async (event, cat, ids) => {
  if (!isValidMainWindowSender(event)) return false
  return await skillsEngine.assignSkillsToCategory(cat, ids)
})
ipcMain.handle('skills_read_file', (event, filePath: string, projectDir?: string) => {
  if (!isValidMainWindowSender(event)) return { success: false, error: 'Unauthorized sender' }
  return skillsEngine.readSkillFile(filePath, projectDir)
})
ipcMain.handle('skills_execute_command', (event, command: string, projectDir?: string) => {
  if (!isValidMainWindowSender(event)) return { success: false, error: 'Unauthorized sender' }
  return skillsEngine.executeSkillCommand(command, projectDir)
})
ipcMain.handle('skills_scan_project_files', (event, projectDir: string) => {
  if (!isValidMainWindowSender(event)) return []
  return skillsEngine.scanProjectFiles(projectDir)
})
ipcMain.handle('skills_choose_project_dir', async (event) => {
  if (!isValidMainWindowSender(event)) return null
  if (!mainWindow || mainWindow.isDestroyed()) return null
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  })
  return res.filePaths[0] || null
})
ipcMain.handle('skills_get_skills_dir', (event) => {
  if (!isValidMainWindowSender(event)) return ''
  return skillsEngine.getSkillsDirectory()
})
ipcMain.handle('skills_open_skills_dir', async (event) => {
  if (!isValidMainWindowSender(event)) return false
  const dir = skillsEngine.getSkillsDirectory()
  if (dir) await shell.openPath(dir)
  return true
})
ipcMain.handle('skills_get_safe_commands', (event) => {
  if (!isValidMainWindowSender(event)) return []
  return skillsEngine.getSafeCommands()
})
ipcMain.handle('skills_add_safe_command', (event, cmd: string) => {
  if (!isValidMainWindowSender(event)) return false
  return skillsEngine.addSafeCommand(cmd)
})
ipcMain.handle('skills_remove_safe_command', (event, cmd: string) => {
  if (!isValidMainWindowSender(event)) return false
  return skillsEngine.removeSafeCommand(cmd)
})
ipcMain.handle(
  'skills_inject_prompt',
  async (event, tabId: string, promptText: string, autoSend: boolean = false) => {
    if (!isValidMainWindowSender(event)) return false
    const targetId = tabId || activeViewId
    if (!targetId) return false
    return injectSkillPromptIntoWebview(targetId, promptText, autoSend)
  }
)

// Broadcast skills updates to renderer windows in real-time
skillsEngine.onSkillsChanged(() => {
  sendToMainWindow('skills_updated')
})

app.on('before-quit', () => {
  isQuitting = true
  // Never leave prepared frames on disk after the app exits.
  try {
    videoJobs.disposeAll()
  } catch {
    /* nothing left to clean */
  }
  // ...and never leave a converted PDF behind either.
  try {
    officeJobs.disposeAll()
  } catch {
    /* nothing left to clean */
  }
})

app.on('will-quit', () => {
  autoUpdateService?.stop()
  downloadNotificationOverlay?.destroy()
  // Remove staged upload parts so bundled source does not linger in the temp folder.
  cleanupAllUploadTempDirs()
  void flushGoogleSessionStore(session.fromPartition('persist:ai-shared')).catch(console.error)
  globalShortcut.unregisterAll()
})

function getTargetWindowBounds() {
  try {
    const currentCursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(currentCursor) || screen.getPrimaryDisplay()
    const { width, height } = display.workAreaSize
    const targetW = Math.round(width * 0.82)
    const targetH = Math.round(height * 0.82)
    return {
      width: targetW,
      height: targetH,
      x: Math.round(display.workArea.x + (width - targetW) / 2),
      y: Math.round(display.workArea.y + (height - targetH) / 2)
    }
  } catch {
    return { width: 1574, height: 886 }
  }
}

// ---------------------------------------------------------------------------
// Customizable shortcut routing.
// The renderer pushes the effective keymap (defaults + user customizations)
// via 'set_shortcut_map' and the open state of any fullscreen overlay via
// 'set_overlays_open'. When an overlay is open the renderer owns the keyboard
// entirely (its overlays handle their own keys), so main stops intercepting —
// otherwise in-overlay keys like Ctrl+J/K list navigation, Ctrl+H/L filter
// cycling or Escape would be consumed before the overlay ever saw them.
// ---------------------------------------------------------------------------
const SHORTCUTS_FILE = join(app.getPath('userData'), 'shortcuts.json')

const DEFAULT_ACTION_KEYS: Record<string, string[]> = {
  'tab-cycle': ['Ctrl', 'Tab'],
  'tab-pin': ['Alt', 'P'],
  'model-reload': ['Ctrl', 'R'],
  'settings-open': ['Ctrl', ','],
  'tab-reopen': ['Ctrl', 'Shift', 'T'],
  'tab-new': ['Ctrl', 'T'],
  'tab-close': ['Ctrl', 'W'],
  'history-open': ['Ctrl', 'H'],
  'tab-overview': ['Ctrl', 'Shift', 'A'],
  'sidebar-toggle': ['Ctrl', 'B'],
  'url-bar': ['Ctrl', 'L'],
  'upload-file': ['Ctrl', 'O'],
  'upload-folder': ['Ctrl', 'Shift', 'O'],
  'model-dev-tools': ['Ctrl', 'Shift', 'D'],
  'shell-inspector': ['Ctrl', 'Alt', 'Shift', 'I'],
  'skills-palette': ['Ctrl', 'S'],
  'skills-base-modal': ['Ctrl', 'Shift', 'S'],
  'fuzzy-cmd': ['Ctrl', 'Shift', 'P'],
  'model-next': ['Ctrl', ']'],
  'model-prev': ['Ctrl', '['],
  'guide-open': ['F1'],
  // Stop generation moved to Ctrl+Shift+dot when the container switcher took Ctrl+dot. The renderer
  // pushes its own keymap from Settings, so this table is only the fallback before that arrives.
  'stop-generation': ['Ctrl', 'Shift', '.'],
  'containers-picker': ['Ctrl', '.'],
  'tab-colours': ['Ctrl', 'Shift', 'C'],
  'site-new-chat': ['Ctrl', 'Shift', 'N'],
  'tab-prev': ['Ctrl', 'K'],
  'tab-next': ['Ctrl', 'J'],
  'notification-latest': ['Ctrl', 'Shift', 'Y'],
  'tab-move-up': ['Ctrl', 'Shift', 'K'],
  'tab-move-down': ['Ctrl', 'Shift', 'J']
}

let customKeymap: Record<string, string[]> = {}
let overlaysOpen = false
/**
 * Whether the *container switcher* is the overlay that is open. Tracked separately because the
 * switcher is the one overlay that has to be closable with the same key that opened it.
 */
let containerMenuOpen = false

// See overlayWatchdog.ts: Escape is a request, and a request can land nowhere.
let overlayWatchdog = createWatchdogState()
let overlayWatchdogTimer: NodeJS.Timeout | null = null
// How many consecutive "real bounds" messages arrived while main believed an overlay was open. Two is
// already a contradiction: the renderer's own bounds sender refuses to fire during an overlay.
let boundsWhileOverlay = 0

/**
 * Ask the renderer to close everything, and give it OVERLAY_CLOSE_GRACE_MS to confirm. If it does not,
 * stop trusting its answer: clear the flags, tell it to force-close, and put the workspace back.
 */
function requestOverlayClose(reason: string): void {
  sendToMainWindow('execute-global-action', { action: 'close_overlay' })
  if (!overlaysOpen) return
  overlayWatchdog = armWatchdog(overlayWatchdog, Date.now())
  if (overlayWatchdogTimer) return
  overlayWatchdogTimer = setTimeout(() => {
    overlayWatchdogTimer = null
    if (!isWatchdogOverdue(overlayWatchdog, Date.now()) || !overlaysOpen) {
      overlayWatchdog = disarmWatchdog()
      return
    }
    console.warn(
      `[overlay] still open ${900}ms after ${reason} — forcing it closed and restoring the view`
    )
    overlayWatchdog = disarmWatchdog()
    overlaysOpen = false
    containerMenuOpen = false
    sendToMainWindow('execute-global-action', { action: 'force_close_overlays' })
    restoreWorkspaceAfterOverlay()
  }, 900)
}

/** Put the native view back and give the keyboard to the shell-or-view that should have it. */
function restoreWorkspaceAfterOverlay(): void {
  reconcileViewPresentation()
  if (overlaysOpen) return
  const view = activeViewId ? aiViews.get(activeViewId) : null
  // Put the keyboard back where it was before the overlay opened. It used to always go to the view,
  // so pressing Escape in the address bar silently moved the keyboard into the page.
  if (keyboardBeforeOverlay === 'shell') {
    giveKeyboardToShell('overlay closed')
    return
  }
  if (view && !view.webContents.isDestroyed() && activeViewVisible) {
    giveKeyboardToView(view, 'overlay closed', activeViewId || undefined)
    focusPromptInView(view)
  } else {
    giveKeyboardToShell('overlay closed, no view')
  }
}

/**
 * The active view's surface, refreshed after the window comes back.
 *
 * This used to be `repairTabSurface(activeViewId, 'window resumed', true)` — an unconditional
 * detach and re-attach, on every `show`, `restore` and `powerMonitor resume`. The build-43 diagnostics
 * show what that costs: after 4.5 hours hidden the trace records a resume, then a detach and an
 * attach, and then the user opening Settings and switching tabs — the two things that clear a blank
 * view. A resume is not evidence that the surface was lost; the re-attach was the injury, not the cure.
 *
 * Evidence decides now (`lib/surfaceResume`): a view missing from the window is put back with the page
 * intact, everything else gets the strong repaint — visibility flip, invalidate, a real 1 px geometry
 * change — which is exactly the lever the workaround uses and the one the trace shows recovering the
 * view. A surface that is still broken after repeated repaints escalates through SurfaceRepairPolicy,
 * which is the signal that actually means "the cheap path failed".
 */
function refreshActiveViewSurfaceAfterResume(reason: string): void {
  const tabId = activeViewId
  const view = tabId ? aiViews.get(tabId) : null
  if (!tabId || !view || view.webContents.isDestroyed()) return

  let loading = false
  try {
    loading = view.webContents.isLoading()
  } catch {
    loading = false
  }

  const action = decideResumeSurfaceAction({
    attached: isViewAttached(view),
    wasHidden: viewWasHidden(tabId, view),
    msSinceLastRefresh: Date.now() - lastResumeRefreshAt
  })

  if (action === 'skip') {
    traceViewOp(tabId, 'resume refresh skipped — the window just resumed', { reason })
    return
  }
  lastResumeRefreshAt = Date.now()

  if (action === 'repair') {
    traceViewOp(tabId, 'view missing from the window — putting it back', { reason })
    if (loading || navigationIntent.pendingUrl(tabId)) {
      traceNav(tabId, 'repair', 'repair postponed — navigation in flight', { reason })
      const timer = setTimeout(() => {
        repairDeferrals.delete(tabId)
        refreshActiveViewSurfaceAfterResume(`${reason} (deferred)`)
      }, 600)
      repairDeferrals.set(tabId, timer)
      return
    }
    repairTabSurface(tabId, reason, true, false, 'if-detached')
    return
  }

  // Not a failing repaint: this is a known transition, so it must not count towards escalation.
  surfaceRepair.forget(tabId)
  // Verify and re-present, not just repaint: a resume is the transition where the surface — or the
  // presenting of the view itself — may be gone.
  ensureActiveViewPresented(`window resumed (${reason})`, 'suspect')
}

/** Rebuild one tab's surface in place, keeping its page. Never recreates the WebContents. */
function repairTabSurface(
  tabId: string,
  reason: string,
  visible = true,
  deferred = false,
  /**
   * May this repair detach and re-attach the view?
   *
   * `'always'` is the escalation: repeated repaints for a visible view have already failed, so the
   * surface has to be rebuilt. `'if-detached'` is for callers that act on evidence (a resume that found
   * the view missing from the window) — if it turns out to be attached after all, the detach is skipped
   * rather than performed on a view that did not need it.
   */
  reattach: 'always' | 'if-detached' = 'always'
): void {
  const view = aiViews.get(tabId)
  if (!view || view.webContents.isDestroyed()) return

  // Never rebuild a surface in the middle of a navigation. Detaching the child view aborts the load in
  // flight, and the tab is then left showing the page it had a moment ago — which the user sees as
  // "the tab title changed to the provider I picked, but the page did not move". That is exactly what
  // happened when a repair raced a navigation from the URL bar. Wait for the load to settle, once.
  let loading = false
  try {
    loading = view.webContents.isLoading()
  } catch {
    loading = false
  }
  if (loading || navigationIntent.pendingUrl(tabId)) {
    if (deferred) {
      console.log(`[viewRepair] not repairing tab ${tabId} (${reason}): a navigation is still in flight`)
      traceNav(tabId, 'repair', 'repair skipped — navigation in flight', { reason })
      return
    }
    console.log(`[viewRepair] postponed (${reason}) for tab ${tabId}: a navigation is in flight`)
    traceNav(tabId, 'repair', 'repair postponed — navigation in flight', { reason })
    const timer = setTimeout(() => {
      repairDeferrals.delete(tabId)
      repairTabSurface(tabId, `${reason} (deferred)`, visible, true)
    }, 600)
    repairDeferrals.set(tabId, timer)
    return
  }

  traceNav(tabId, 'repair', `repair running — ${reason}`, { visible })
  surfaceRepair.noteRepair(tabId)
  const bounds = lastRealBounds.get(tabId) ?? null
  // Adapter rather than a cast on the window: `contentView` is typed against Electron's `View`, and the
  // repair helper deliberately knows nothing about Electron's class hierarchy.
  const host = mainWindow && !mainWindow.isDestroyed()
    ? {
        contentView: {
          addChildView: (target: unknown) => {
            traceViewOp(tabId, 'attach (repair)', { reason })
            mainWindow?.contentView.addChildView(target as Electron.WebContentsView)
          },
          removeChildView: (target: unknown) => {
            traceViewOp(tabId, 'detach (repair) — aborts any load in flight', { reason })
            mainWindow?.contentView.removeChildView(target as Electron.WebContentsView)
          }
        }
      }
    : null
  const outcome = repairViewSurface(host, view, {
    bounds: bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null,
    visible,
    // Belt and braces: the guard above already deferred when a load was in flight.
    navigationInFlight: Boolean(view.webContents.isLoading?.()) || Boolean(navigationIntent.pendingUrl(tabId)),
    reason: `tab ${tabId} ${reason}`,
    reattach,
    isAttached: () => isViewAttached(view),
    log: (message) => console.log(`[viewRepair] ${message}`)
  })
  if (outcome === 'repaired') {
    activeViewVisible = visible
    markViewVisibility(tabId, visible)
    // The re-attach got us a fresh surface; it does not by itself produce a frame, and it also stacked
    // the page above the app's native toasts. Both are fixed here rather than left to the user.
    forceViewRepaint(view, {
      bounds: bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null,
      reason: 'after re-attach',
      force: true,
      // A re-attached view has no surface of its own to redraw: it has to be presented again.
      flipVisibility: true,
      log: (message) => console.log(`[viewRepaint] ${message}`)
    })
    raiseNativeOverlays()
    try {
      if (visible && keyboardOwner === 'view') {
        view.webContents.focus()
        focusPromptInView(view)
      }
    } catch {
      /* the surface is the part that matters */
    }
  }
}

/**
 * Idempotent reconciliation of native view presentation state.
 * Called after activation, valid bounds updates, overlay close, and
 * window show/restore so the live webview is never left blank.
 * Never recreates or reloads a live WebContents.
 */
function reconcileViewPresentation(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const isVisible = mainWindow.isVisible() && !mainWindow.isMinimized()
  const hasOverlay = overlaysOpen
  const shouldShow = isVisible && !hasOverlay && Boolean(activeViewId)

  // Always keep inactive views hidden
  for (const [tabId, view] of aiViews) {
    if (tabId === activeViewId) continue
    try {
      if (!view.webContents.isDestroyed()) {
        view.setVisible(false)
        view.webContents.setBackgroundThrottling(true)
        view.webContents.setAudioMuted(true)
      }
    } catch {}
  }

  // Reconcile the active view
  if (activeViewId) {
    const view = aiViews.get(activeViewId)
    const realBounds = lastRealBounds.get(activeViewId)
    if (view && !view.webContents.isDestroyed()) {
      // Apply cached bounds only when they are non-zero; never force stale zero geometry
      let previousBounds: Electron.Rectangle | null = null
      try {
        previousBounds = view.getBounds()
      } catch {
        /* bounds unavailable on this platform/build */
      }
      if (shouldShow && realBounds && realBounds.width > 0 && realBounds.height > 0) {
        try {
          view.setBounds(realBounds)
        } catch {}
      }
      activeViewVisible = shouldShow
      try {
        if (typeof view.setVisible === 'function') {
          traceViewOp(activeViewId, 'setVisible (reconcile-presentation)', { visible: shouldShow })
          view.setVisible(shouldShow)
        }
      } catch {}
      if (!view.webContents.isDestroyed()) {
        view.webContents.setBackgroundThrottling?.(!shouldShow)
        view.webContents.setAudioMuted?.(!shouldShow)
      }
      // Re-applying identical geometry does NOT make Chromium produce a frame, so a
      // surface discarded while the window was hidden/occluded stays blank ("dark tab")
      // until something flips visibility. When the geometry genuinely changed the
      // compositor already repaints, so only the no-change case needs a forced paint.
      const geometryChanged =
        !previousBounds ||
        !realBounds ||
        previousBounds.x !== realBounds.x ||
        previousBounds.y !== realBounds.y ||
        previousBounds.width !== realBounds.width ||
        previousBounds.height !== realBounds.height
      // A view that was parked at zero size (overlay open, tab switched away, window hidden) comes
      // back with geometry that *looks* changed but no frame behind it. Changing bounds on a
      // WebContentsView does not by itself make Chromium produce a new frame, so the surface can
      // stay blank until something flips visibility — which is exactly why hiding and re-showing
      // the window "fixes" it by hand. Repaint in that case too.
      // Geometry is not visibility. An overlay hides a view with `setVisible(false)` and never touches
      // its bounds, so the bounds-based guess reported `comingBackFromHidden=false` for exactly the
      // transition that loses the surface (build-32 diagnostics, +1439989ms). Ask what was recorded.
      // Consumed once, here: the activation recorded it before it overwrote the flag.
      const resumedByActivation = shownFromHidden.delete(activeViewId)
      const recordedHidden = viewWasHidden(activeViewId, view)
      const wasHidden = recordedHidden || resumedByActivation
      const boundsUsable = Boolean(realBounds && realBounds.width > 0 && realBounds.height > 0)
      const comingBackFromHidden = wasHidden || !previousBounds || !boundsUsable
      markViewVisibility(activeViewId, shouldShow)
      // One place decides how hard to ask for a frame — see surfaceReturn.ts.
      const surfaceReturn = classifySurfaceReturn({
        shouldShow,
        geometryChanged,
        recordedHidden,
        resumedByActivation,
        boundsUsable
      })
      if (surfaceReturn !== 'none') {
        traceViewOp(activeViewId, 'repaint (reconcile-presentation)', {
          geometryChanged,
          comingBackFromHidden,
          wasHidden,
          resumedByActivation,
          loading: (() => {
            try {
              return view.webContents.isLoading()
            } catch {
              return null
            }
          })()
        })
        const repaintBounds = boundsUsable ? realBounds : null
        if (surfaceReturn === 'strong') {
          // Back from an overlay / a hidden window / another tab. This is a *known* transition, so it
          // does not count towards escalation — it gets the strongest safe repaint instead (invalidate,
          // a real 1 px geometry change, and a second invalidate once a frame could have been produced).
          // Hide/show as well as invalidate+nudge — the user's own workaround, done on purpose — and
          // first, a check that the view is actually in the window and showing, because the build-44
          // trace shows `setVisible {visible=true}` being logged for a view that was not on screen.
          surfaceRepair.forget(activeViewId)
          ensureActiveViewPresented('coming back from hidden (overlay / tab switch)')
        } else {
          surfaceRepair.noteRepaint(activeViewId)
          forceViewRepaint(view, {
            bounds: repaintBounds,
            reason: 'reconcile-presentation',
            log: (message) => console.log(`[viewRepaint] ${message}`)
          })
          // Asking twice in a row for the same tab to repaint means the cheap path is not working. That
          // is the user's "it went blank and only closing the tab brought it back" — but a detach/attach
          // in the half-second after an overlay closed is what *created* the blank surface, so it waits.
          const justResumed = Date.now() - lastResumeRefreshAt <= 600
          if (
            surfaceRepair.shouldRepair(activeViewId) &&
            Date.now() - lastOverlayCloseAt > 600 &&
            !justResumed
          ) {
            // Escalation used to be a detach and re-attach. The build-44 trace settled that: no repair
            // fired at all in that session (the resume path no longer detaches) and the view still went
            // blank, so a detach is neither necessary nor sufficient — and it is the one operation that
            // can destroy a surface. Escalation is now the same strong lever as everything else:
            // verify the presentation, hide/show, invalidate, ask the page — repeated as needed, with
            // the genuine detach left to the explicit "Repair AI View" command.
            ensureActiveViewPresented('reconciled twice without a frame', 'always')
          } else if (surfaceRepair.shouldRepair(activeViewId)) {
            // A resume just ran the strong repaint. Escalating to a detach in the half-second after it
            // would replace the surface that repaint was about to produce — and a detach is the way to
            // end up with no surface at all.
            traceViewOp(
              activeViewId,
              justResumed
                ? 'repair held back — the window just resumed, the strong repaint runs first'
                : 'repair held back — an overlay just closed, the strong repaint runs first',
              {}
            )
          }
        }
        try {
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.invalidate?.()
          }
        } catch {
          /* surface already gone; the view repaint above is the part that matters */
        }
      }
    } else {
      activeViewVisible = false
    }
  }
}

function isValidKeymap(map: unknown): map is Record<string, string[]> {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false
  return Object.values(map as Record<string, unknown>).every(
    (v) => Array.isArray(v) && v.every((k) => typeof k === 'string')
  )
}

function loadCustomKeymap(): void {
  try {
    const parsed = JSON.parse(readFileSync(SHORTCUTS_FILE, 'utf-8'))
    if (isValidKeymap(parsed)) customKeymap = parsed
  } catch {}
}

// The renderer says which overlay is up, so Ctrl+dot can close the switcher without stealing the key
// from every other panel (Settings needs it to record the shortcut).
ipcMain.on('set_container_menu_open', (_event, open: boolean) => {
  containerMenuOpen = Boolean(open)
})

ipcMain.on('set_overlays_open', (_event, open: boolean) => {
  const next = Boolean(open)
  if (overlaysOpen === next) return
  overlaysOpen = next
  restartActiveArenaTitleSync()

  if (!overlaysOpen) {
    // The renderer confirmed it: the Escape deadline no longer applies.
    overlayWatchdog = disarmWatchdog()
    if (overlayWatchdogTimer) {
      clearTimeout(overlayWatchdogTimer)
      overlayWatchdogTimer = null
    }
    boundsWhileOverlay = 0
    lastOverlayCloseAt = Date.now()
    // A notification that arrived while a panel was open resumes here, and one that was merely hidden
    // for the duration of the panel comes back with the time it had left. Neither is thrown away.
    try {
      if (aiToastManager.isSuspended()) {
        aiToastManager.resume()
        currentNotificationData = aiToastManager.getCurrentData()
        isAiNotificationVisible = aiToastManager.getIsVisible()
        raiseNativeOverlays()
        traceViewOp(activeViewId || '', 'notification toast resumed — the overlay closed', {})
      }
    } catch {
      /* same */
    }
  }

  if (overlaysOpen) {
    // The toast is suspended, not dismissed: opening the address bar is not the user saying "forget
    // that notification". It comes back when the overlay closes, with its remaining time intact.
    try {
      if (aiToastManager.getIsVisible()) {
        aiToastManager.suspend()
        currentNotificationData = aiToastManager.getCurrentData()
        isAiNotificationVisible = aiToastManager.getIsVisible()
        traceViewOp(activeViewId || '', 'notification toast suspended — an overlay is open', {})
      }
    } catch {
      /* the toast is never worth failing an overlay for */
    }
    for (const [id, view] of aiViews) {
      try {
        if (typeof view?.setVisible === 'function') {
          traceViewOp(id, 'setVisible (overlay open)', { visible: false, active: id === activeViewId })
          view.setVisible(false)
          markViewVisibility(id, false)
        }
        if (view?.webContents && !view.webContents.isDestroyed?.()) {
          view.webContents.setBackgroundThrottling?.(true)
          view.webContents.setAudioMuted?.(true)
        }
      } catch {}
    }
    // The overlay owns the keyboard, so the shell has to own it too. Leaving it in a hidden native
    // view is how Escape stops reaching anything at all. Who had it before is remembered, so closing
    // the overlay does not silently move the keyboard into the page.
    keyboardBeforeOverlay = keyboardOwner
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus()
    } catch {}
    try {
      giveKeyboardToShell('overlay open')
    } catch {
      /* focus stays where it was; the overlay still owns the shortcuts */
    }
    traceNav(activeViewId || '', 'overlay', 'overlay open — AI view hidden', {})
    console.log('[overlay] open — the shell has the keyboard, the AI view is hidden')
  } else {
    traceNav(activeViewId || '', 'overlay', 'overlay closed — restoring the workspace', {})
    console.log('[overlay] closed — restoring the workspace')
    restoreWorkspaceAfterOverlay()
  }
})

ipcMain.on('set_shortcut_map', (_event, map: unknown) => {
  if (!isValidKeymap(map)) return
  customKeymap = map
  try {
    writeFileSync(SHORTCUTS_FILE, JSON.stringify(map, null, 2))
  } catch {}
})

function actionKeys(id: string): string[] {
  const custom = customKeymap[id]
  if (Array.isArray(custom) && custom.length > 0) return custom
  return DEFAULT_ACTION_KEYS[id] || []
}

// Map physical key codes to their unmodified key so combos like Ctrl+] match
// even when input.key reports a layout-specific character.
const CODE_KEY_MAP: Record<string, string> = {
  KeyB: 'b',
  KeyI: 'i',
  KeyN: 'n',
  KeyO: 'o',
  KeyY: 'y',
  BracketRight: ']',
  BracketLeft: '[',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: ' ',
  Tab: 'tab',
  Escape: 'escape',
  Enter: 'enter'
}

function modifiersMatch(input: Electron.Input, keys: string[]): boolean {
  const eventCtrl = Boolean(input.control || input.meta)
  const hasCtrl = keys.includes('Ctrl') || keys.includes('Control') || keys.includes('Meta')
  return (
    hasCtrl === eventCtrl &&
    keys.includes('Alt') === Boolean(input.alt) &&
    keys.includes('Shift') === Boolean(input.shift)
  )
}

function keyMatches(input: Electron.Input, keys: string[]): boolean {
  const nonMods = keys.filter((k) => !['Ctrl', 'Control', 'Alt', 'Shift', 'Meta'].includes(k))
  if (nonMods.length === 0) return false
  const target = nonMods[0].toLowerCase()
  const eventKey = (input.key || '').toLowerCase()
  if (eventKey && eventKey === target) return true
  if (
    target === 'b' &&
    (eventKey === 'b' || input.code === 'KeyB' || input.code?.toLowerCase() === 'keyb')
  )
    return true
  if (
    target === 'i' &&
    (eventKey === 'i' || input.code === 'KeyI' || input.code?.toLowerCase() === 'keyi')
  )
    return true
  if (
    target === 'o' &&
    (eventKey === 'o' || input.code === 'KeyO' || input.code?.toLowerCase() === 'keyo')
  )
    return true
  if (eventKey === ' ' && target === 'space') return true
  const codeKey = CODE_KEY_MAP[input.code || '']
  return Boolean(codeKey) && codeKey.toLowerCase() === target
}

function matchesAction(input: Electron.Input, id: string): boolean {
  const keys = actionKeys(id)
  if (keys.length === 0) return false
  return modifiersMatch(input, keys) && keyMatches(input, keys)
}

export function routeGlobalShortcut(
  event: Electron.Event,
  input: Electron.Input,
  _source: 'window' | 'view'
): boolean {
  if (input.type !== 'keyDown') return false

  const isCtrlOrMeta = Boolean(input.control || input.meta)
  const keyLower = (input.key || '').toLowerCase()
  const code = input.code || ''

  // Escape always also reaches the renderer (non-consuming) so overlays can
  // run their own cancel logic; close_overlay is idempotent.
  if (keyLower === 'escape' || code === 'Escape') {
    // Still non-consuming, so an overlay can run its own cancel logic; but now the close is also a
    // request with a deadline (see overlayWatchdog.ts), because a request that lands nowhere used to
    // leave the window unreachable by any shortcut.
    requestOverlayClose('Escape')
    return false
  }

  // Ctrl+dot -> the container / profile switcher, and the same key closes it again.
  // Handled *before* the overlay guard on purpose: the switcher is itself an overlay, so the guard
  // would swallow the key that is supposed to shut it.
  if (matchesAction(input, 'containers-picker')) {
    // Another overlay keeps the keyboard, so Ctrl+dot can still be *recorded* as a shortcut in
    // Settings instead of opening the switcher underneath it. The switcher itself is the exception.
    if (overlaysOpen && !containerMenuOpen) return false
    event.preventDefault()
    if (!input.isAutoRepeat) {
      sendToMainWindow('execute-global-action', { action: 'toggle_container_menu' })
    }
    return true
  }

  // While a fullscreen overlay is open the renderer owns the keyboard.
  if (overlaysOpen) return false

  // In-app shortcut: switch to the latest notified tab, if it still exists.
  // Never register a system-wide hotkey or silently wake a closed tab.
  if (matchesAction(input, 'notification-latest') && lastNotifiedTabId) {
    const tabId = lastNotifiedTabId
    const tabExists =
      aiViews.has(tabId) ||
      tabDiscardManager.hasView(tabId) ||
      tabDiscardManager.isTabEvicted(tabId)
    if (tabExists) {
      event.preventDefault()
      if (!input.isAutoRepeat) {
        dismissInAppToast(true)
        sendToMainWindow('notification_switch_to_tab', tabId)
      }
      return true
    }
    lastNotifiedTabId = null
  }

  // Alt+J / Alt+K -> In-chat prompt navigation (only when active webview is visible)
  const isAltJK =
    input.alt &&
    !input.control &&
    !input.shift &&
    !input.meta &&
    (keyLower === 'j' || keyLower === 'k' || code === 'KeyJ' || code === 'KeyK')
  if (isAltJK) {
    if (activeViewId && activeViewVisible) {
      event.preventDefault()
      const dir: 'older' | 'newer' = keyLower === 'k' || code === 'KeyK' ? 'older' : 'newer'
      const view = aiViews.get(activeViewId)
      if (view && !view.webContents.isDestroyed()) {
        const modelKey = viewModelKeys.get(activeViewId) || ''
        const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
        view.webContents
          .executeJavaScript(buildEngine(dir, feats.promptNavSelector))
          .then((res: import('./promptNav').NavigationResult) => {
            if (res && res.status !== 'ok' && res.status !== 'cancelled') {
              console.debug('[prompt-nav]', modelKey, dir, res)
            }
          })
          .catch((err) => {
            console.error('[prompt-nav] execution failed', modelKey, dir, err)
          })
      }
      return true
    }
  }

  // Ctrl+Alt+1..9 -> open that container; Ctrl+Alt+0 -> the default one.
  // AltGr on some layouts arrives as ctrl+alt; the digit check keeps this to deliberate presses.
  // The container is resolved *here*, from the store, so the shortcut does not depend on the
  // renderer's idea of the list — and a digit with no container is reported instead of doing nothing
  // silently, which is what made the higher digits look broken.
  if (isCtrlOrMeta && input.alt && !input.shift) {
    const digit = /^\d$/.test(keyLower) ? keyLower : code.startsWith('Digit') ? code.slice(5) : ''
    if (digit) {
      event.preventDefault()
      if (!input.isAutoRepeat) {
        const containers = containerStore.list()
        const container = containerForShortcutDigit(containers, digit)
        console.log(
          `[containers] Ctrl+Alt+${digit} -> ${container ? container.id : 'none'} of ${containers.length}`
        )
        sendToMainWindow('execute-global-action', {
          action: 'open_container',
          // Position in an order the user chose, not creation order: the containers section writes it
          // down, the switcher lists it, and 0 has always meant "the first one".
          index: digit === '0' ? 1 : Number(digit),
          containerId: container?.id ?? null,
          total: containers.length
        })
      }
      return true
    }
  }

  // Ctrl+Tab / Ctrl+Shift+Tab -> Cycle tabs
  const isTab = keyLower === 'tab' || code === 'Tab'
  if (isCtrlOrMeta && !input.alt && isTab) {
    event.preventDefault()
    sendToMainWindow('trigger_tab_cycle', { shift: Boolean(input.shift) })
    return true
  }

  // Alt+P -> Toggle Pin Active Tab
  if (matchesAction(input, 'tab-pin')) {
    if (activeViewId) {
      event.preventDefault()
      sendToMainWindow('execute-global-action', { action: 'toggle_pin', tabId: activeViewId })
    }
    return true
  }

  // Ctrl+R -> Reload Active View directly in main
  if (matchesAction(input, 'model-reload')) {
    event.preventDefault()
    const view = activeViewId ? aiViews.get(activeViewId) : null
    if (view && !view.webContents.isDestroyed()) {
      // A reload is a navigation: it aborts anything still loading in that tab. Say so, so a reload
      // the user did not intend is distinguishable from a page reloading itself.
      traceNav(activeViewId || '', 'load', 'reload (Ctrl+R)', {})
      view.webContents.reload()
    }
    return true
  }

  // Ctrl+O -> Upload files (files-only native picker; multi-select supported)
  if (matchesAction(input, 'upload-file')) {
    event.preventDefault()
    if (input.isAutoRepeat) return true
    // A picker that never returned must not keep the shortcut dead until restart.
    recoverAbandonedPicker(mainWindow)
    if (activeViewId && mainWindow && !mainWindow.isDestroyed()) {
      const view = aiViews.get(activeViewId)
      if (view && !view.webContents.isDestroyed()) {
        handleFilesUpload(view, mainWindow).catch((err) => {
          console.error('Failed to handle file upload:', err)
        })
      }
    }
    return true
  }

  // Ctrl+Shift+O -> Upload Folder directly in main (guarded against repeat & renderer bounce)
  if (matchesAction(input, 'upload-folder')) {
    event.preventDefault()
    if (input.isAutoRepeat) return true
    recoverAbandonedPicker(mainWindow)
    if (activeViewId && mainWindow && !mainWindow.isDestroyed()) {
      const view = aiViews.get(activeViewId)
      if (view && !view.webContents.isDestroyed()) {
        handleFolderUpload(view, mainWindow).catch((err) => {
          console.error('Failed to handle folder upload:', err)
        })
      }
    }
    return true
  }

  if (matchesAction(input, 'stop-generation')) {
    event.preventDefault()
    clickActiveViewFeature('stopGenerationSelector').catch(() => {})
    return true
  }
  if (matchesAction(input, 'site-new-chat')) {
    event.preventDefault()
    clickActiveViewFeature('newChatSelector').catch(() => {})
    return true
  }

  // Keymap-driven actions (each honors user customizations from Settings)
  const keymapActions: Array<[string, string]> = [
    ['settings-open', 'toggle_settings'],
    ['tab-reopen', 'reopen_tab'],
    ['tab-new', 'new_tab'],
    ['tab-close', 'close_tab'],
    ['history-open', 'toggle_history'],
    ['tab-overview', 'toggle_tab_overview'],
    ['sidebar-toggle', 'toggle_sidebar'],
    ['url-bar', 'toggle_url_bar'],
    ['fuzzy-cmd', 'toggle_url_bar'],
    ['skills-palette', 'toggle_skills'],
    ['skills-base-modal', 'toggle_base_skills'],
    ['model-next', 'model_next'],
    ['model-prev', 'model_prev'],
    ['guide-open', 'guide_open'],
    ['export-context', 'toggle_export'],
    ['stop-generation', 'stop_generation'],
    ['tab-colours', 'toggle_tab_colours'],
    ['site-new-chat', 'site_new_chat']
  ]
  for (const [id, action] of keymapActions) {
    if (matchesAction(input, id)) {
      event.preventDefault()
      sendToMainWindow('execute-global-action', { action })
      return true
    }
  }

  // Ctrl+J / Ctrl+K -> Down (next) / Up (prev)
  if (matchesAction(input, 'tab-prev') || matchesAction(input, 'tab-next')) {
    event.preventDefault()
    const prev = matchesAction(input, 'tab-prev')
    sendToMainWindow('execute-global-action', {
      action: 'navigate_tab',
      direction: prev ? 'prev' : 'next'
    })
    return true
  }

  // Ctrl+Shift+J / Ctrl+Shift+K -> Move Tab Down / Move Tab Up
  if (matchesAction(input, 'tab-move-up') || matchesAction(input, 'tab-move-down')) {
    event.preventDefault()
    const up = matchesAction(input, 'tab-move-up')
    sendToMainWindow('execute-global-action', { action: 'move_tab', direction: up ? 'up' : 'down' })
    return true
  }

  // Ctrl+Alt+Shift+I -> Nexus Shell Inspector (mainWindow.webContents)
  if (
    matchesAction(input, 'shell-inspector') ||
    (isCtrlOrMeta && input.alt && input.shift && (keyLower === 'i' || code === 'KeyI'))
  ) {
    event.preventDefault()
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.webContents &&
      !mainWindow.webContents.isDestroyed()
    ) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
    return true
  }

  // Ctrl+Shift+D or Ctrl+Shift+I -> DevTools
  if (
    matchesAction(input, 'model-dev-tools') ||
    (isCtrlOrMeta && input.shift && !input.alt && (keyLower === 'i' || code === 'KeyI'))
  ) {
    event.preventDefault()
    const view = activeViewId ? aiViews.get(activeViewId) : null
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.openDevTools({ mode: 'detach' })
    }
    return true
  }

  // Digits 1..9: Ctrl+1..9 (the tab numbered N, pinned tabs first) or Alt+1..9 (pinned only)
  const digitCodeMatch = code ? code.match(/^(?:Digit|Numpad)([1-9])$/) : null
  const digitKeyMatch = keyLower.match(/^[1-9]$/)
  const digitNum = digitCodeMatch
    ? parseInt(digitCodeMatch[1], 10)
    : digitKeyMatch
      ? parseInt(digitKeyMatch[0], 10)
      : null

  if (digitNum !== null && !input.shift) {
    // The renderer owns the numbering (pinned tabs first, then the rest) so the digit it acts on is
    // always the number printed on the tab. Main only forwards the digit; it is not a tab list.
    if (isCtrlOrMeta && !input.alt) {
      event.preventDefault()
      sendToMainWindow('execute-global-action', {
        action: 'switch_tab_index',
        number: digitNum,
        pinnedOnly: false
      })
      return true
    } else if (input.alt && !isCtrlOrMeta) {
      event.preventDefault()
      sendToMainWindow('execute-global-action', {
        action: 'switch_tab_index',
        number: digitNum,
        pinnedOnly: true
      })
      return true
    }
  }

  // Zoom: Ctrl+Minus, Ctrl+Equal, Ctrl+0, Numpad (Shift = UI zoom)
  if (
    isCtrlOrMeta &&
    !input.alt &&
    (code === 'Minus' ||
      code === 'Equal' ||
      code === 'Digit0' ||
      code === 'NumpadAdd' ||
      code === 'NumpadSubtract' ||
      code === 'Numpad0')
  ) {
    event.preventDefault()
    sendToMainWindow('execute-global-action', { action: 'zoom', code, shift: input.shift })
    return true
  }

  return false
}

// Exported testing hooks for shortcut routing unit tests
export function setMainWindowForTesting(win: any): void {
  mainWindow = win
}

export function setActiveViewForTesting(tabId: string | null, view?: any): void {
  activeViewId = tabId
  if (tabId && view) {
    aiViews.set(tabId, view)
  } else if (tabId === null) {
    aiViews.clear()
  }
}

export function setOverlaysOpenForTesting(open: boolean): void {
  overlaysOpen = open
}

export function setCustomKeymapForTesting(map: Record<string, string[]>): void {
  customKeymap = map
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }

  const bounds = getTargetWindowBounds()

  mainWindow = new BrowserWindow({
    title: 'Nexus',
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 800,
    minHeight: 500,
    show: true,
    autoHideMenuBar: true,
    ...windowChrome(process.platform),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.webContents.setMaxListeners(50)

  trustWindow(mainWindow)

  mainWindow.setMenu(null)

  aiNotificationView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Loading a background toast must not take focus from the active input.
      focusOnNavigation: false
    }
  })
  aiNotificationView.webContents.on('before-input-event', (event, input) => {
    routeGlobalShortcut(event, input, 'window')
  })
  aiNotificationView.setBackgroundColor('#00000000')
  aiNotificationView.setVisible(false)
  aiNotificationView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  mainWindow.contentView.addChildView(aiNotificationView)

  // Construct once during window startup. This must not live in the
  // AI-notification presenter, or downloads before an AI alert are dropped.
  downloadNotificationOverlay = new DownloadNotificationOverlay(
    mainWindow,
    join(__dirname, '../preload/index.js'),
    () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (aiNotificationView) {
        mainWindow.contentView.removeChildView(aiNotificationView)
        mainWindow.contentView.addChildView(aiNotificationView)
      }
    }
  )

  mainWindow.on('resize', () => {
    if (aiNotificationView && currentNotificationData && isAiNotificationVisible) {
      const winBounds = mainWindow?.getContentBounds()
      if (winBounds) {
        aiNotificationView.setBounds({
          x: Math.max(0, winBounds.width - 395),
          y: 44,
          width: 380,
          height: 125
        })
      }
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  })

  // When the OS window regains focus, hand Chromium focus to whichever surface
  // is visible so keyboard input is never swallowed:
  //  - webview visible → AI view (focus-retention script restores the caret)
  //  - webview hidden (overlay open) → React renderer so overlay shortcuts work
  mainWindow.on('focus', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    sendToMainWindow('window-focus-changed', true)
    // The keyboard goes back to whoever had it. Coming back to Nexus after alt-tabbing should not drop
    // the caret into the AI page when the user was last typing in the shell.
    if (overlaysOpen || keyboardOwner === 'shell') {
      giveKeyboardToShell('window focused')
    }
    if (activeViewVisible && !overlaysOpen && activeViewId && keyboardOwner === 'view') {
      const view = aiViews.get(activeViewId)
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.focus()
        focusPromptInView(view)
        // Coming back from another app can present a stale surface on some drivers.
        forceViewRepaint(view, {
          bounds: lastRealBounds.get(activeViewId) ?? null,
          reason: 'window-focus',
          log: (message) => console.log(`[viewRepaint] ${message}`)
        })
      }
    } else if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.focusOnWebView()
      mainWindow.webContents.focus()
    }
  })

  mainWindow.on('blur', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    sendToMainWindow('window-focus-changed', false)
  })

  mainWindow.on('hide', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    sendToMainWindow('window-focus-changed', false)
  })

  mainWindow.on('minimize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    sendToMainWindow('window-focus-changed', false)
  })

  mainWindow.on('restore', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    sendToMainWindow('window-focus-changed', true)
  })

  mainWindow.on('show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    sendToMainWindow('window-focus-changed', true)
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    } else {
      previewLoop.stop()
    }
  })

  mainWindow.webContents.on('focus', () => {
    setKeyboardOwner('shell', 'shell focused')
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Ctrl+V typed while the shell owns the keyboard. The shell has no composer, so the keystroke is
    // the user asking for the prompt — route it before it becomes a paste into nothing. Skipped when an
    // overlay is open (those do have fields of their own) and when the tab already owns the keyboard,
    // where the page's own paste is the correct one.
    if (
      input.type === 'keyDown' &&
      (input.control || input.meta) &&
      !input.alt &&
      !input.shift &&
      (input.key || '').toLowerCase() === 'v' &&
      !overlaysOpen &&
      !activeViewHasKeyboard()
    ) {
      event.preventDefault()
      if (!input.isAutoRepeat) pasteIntoActiveView('shell key')
      return
    }
    routeGlobalShortcut(event, input, 'window')
  })

  const suspendAllViews = () => {
    previewLoop.stop()
    arenaTitleSync.stop()
    for (const [tabId, view] of aiViews) {
      if (!view.webContents.isDestroyed()) {
        view.webContents.setBackgroundThrottling(true)
        view.webContents.setAudioMuted(true)
        // Record it. The window being hidden or minimised *is* a hidden transition for every view, and
        // the resume path asks `viewWasHidden()` to decide how strong a repaint this needs. Nothing used
        // to set it here, so after hours hidden the answer was still "not hidden" — the build-43 trace
        // reads `repaint ... {comingBackFromHidden=false}` one millisecond after a 4.5-hour gap, and the
        // transition that does drop a surface then took the weak path.
        markViewVisibility(tabId, false)
      }
    }
  }

  // Stop screenshot capture and throttle background webviews when hidden/minimized
  mainWindow.on('hide', suspendAllViews)
  mainWindow.on('minimize', suspendAllViews)
  mainWindow.on('maximize', () => {
    sendToMainWindow('window_maximized_changed', true)
  })
  mainWindow.on('unmaximize', () => {
    sendToMainWindow('window_maximized_changed', false)
  })
  const resumeActiveView = () => {
    restartActiveArenaTitleSync()
    // Reconcile first: it is what re-shows the view (and, because `suspendAllViews` now records the
    // hidden transition, what takes the *strong* repaint branch instead of the weak one).
    reconcileViewPresentation()
    // Coming back from hidden/minimised/sleep is where the compositor can drop a surface. Refresh it with
    // the strongest *safe* lever; re-attach only if the view is really missing from the window.
    if (activeViewId && activeViewVisible && !overlaysOpen) {
      refreshActiveViewSurfaceAfterResume('window resumed')
    }
    try {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.invalidate?.()
      }
    } catch {
      /* window tearing down — nothing to repaint */
    }
  }
  mainWindow.on('show', resumeActiveView)
  mainWindow.on('restore', resumeActiveView)
  // Waking from sleep is another way to come back to a surface the compositor dropped.
  // Registered once per app, not per window, and only touches the visible view.
  if (!powerResumeHookRegistered) {
    powerResumeHookRegistered = true
    try {
      powerMonitor.on('resume', () => {
        if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return
        resumeActiveView()
        try {
          mainWindow.webContents?.invalidate?.()
        } catch {
          /* webContents already destroyed after wake */
        }
      })
    } catch (error) {
      console.warn('[viewRepaint] powerMonitor resume hook unavailable:', error)
    }
  }
  mainWindow.on('blur', () => previewLoop.stop())
  const resumePreview = () => {
    if (
      previewViewId &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.isVisible() &&
      !mainWindow.isMinimized()
    ) {
      previewLoop.start(previewViewId)
    }
  }
  mainWindow.on('show', resumePreview)
  mainWindow.on('restore', resumePreview)
  mainWindow.on('focus', resumePreview)

  mainWindow.on('closed', () => {
    previewLoop.stop()
    arenaTitleSync.stop()
    mainWindow = null
    currentUiZoom = 1.0 // reset on destroy if needed
  })

  mainWindow.on('app-command', (_e, cmd) => {
    if (!activeViewId) return
    const activeView = aiViews.get(activeViewId)
    if (!activeView || activeView.webContents.isDestroyed()) return
    if (cmd === 'browser-backward') {
      if (activeView.webContents.navigationHistory.canGoBack()) {
        activeView.webContents.navigationHistory.goBack()
        sendToMainWindow('history-nav-hud', { action: 'back', message: '← Back' })
      } else {
        sendToMainWindow('history-nav-hud', { action: 'boundary', message: 'Start of History' })
      }
    } else if (cmd === 'browser-forward') {
      if (activeView.webContents.navigationHistory.canGoForward()) {
        activeView.webContents.navigationHistory.goForward()
        sendToMainWindow('history-nav-hud', { action: 'forward', message: '→ Forward' })
      } else {
        sendToMainWindow('history-nav-hud', { action: 'boundary', message: 'End of History' })
      }
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (e, url) => {
    const isDevUrl =
      is.dev &&
      process.env['ELECTRON_RENDERER_URL'] &&
      url.startsWith(process.env['ELECTRON_RENDERER_URL'])
    const isProdUrl = url.startsWith('file://') && url.includes('renderer/index.html')
    if (!isDevUrl && !isProdUrl) {
      e.preventDefault()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Let Chromium select a safe GPU/video path; do not force blocked drivers.
// These switches are Linux-specific, not Windows/macOS settings.
for (const [name, value] of linuxDisplaySwitches(process.platform)) {
  app.commandLine.appendSwitch(name, value)
}
app.commandLine.appendSwitch('process-per-site')

// userData pinned: renaming package.json must never orphan tabs/logins again
app.setPath('userData', join(app.getPath('appData'), 'nexus'))

const thumbnailsDir = join(app.getPath('userData'), 'thumbnails')
mkdirSync(thumbnailsDir, { recursive: true })

// thumb:// must be privileged BEFORE app ready: standard+secure so the renderer
// (http://localhost:5173) may fetch images from it without CORS/opaque errors.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'thumb',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

/**
 * Crash diagnostics.
 *
 * Build 29 closed the window when a URL-bar navigation ran into a page that re-navigates itself, and the
 * only evidence was a log that stopped mid-line — no exception, no reason. Nothing in the app was
 * listening. Anything that kills a process, throws from a timer or rejects an unhandled promise now says
 * so, in the log the user can send and in the trace the Logs tab shows.
 *
 * The handler deliberately does not re-throw: a diagnostic that then exits tells nobody anything, and
 * this app is more useful with one broken navigation than with no window.
 */
function reportFatal(kind: string, detail: unknown): void {
  let message = ''
  try {
    message =
      detail instanceof Error
        ? `${detail.name}: ${detail.message}\n${String(detail.stack || '').split('\n').slice(0, 6).join('\n')}`
        : typeof detail === 'object'
          ? JSON.stringify(detail)
          : String(detail)
  } catch {
    message = '(unprintable)'
  }
  try {
    console.error(`[fatal] ${kind} — ${message}`)
  } catch {
    /* a console that throws is not worth a second throw */
  }
  try {
    traceNav(activeViewId || '', 'note', `FATAL: ${kind}`, { detail: message.slice(0, 300) })
  } catch {
    /* ignore */
  }
}

process.on('uncaughtException', (error) => reportFatal('uncaughtException', error))
process.on('unhandledRejection', (reason) => reportFatal('unhandledRejection', reason))
app.on('child-process-gone', (_event, details) => {
  reportFatal('child-process-gone', `${details.type} · ${details.reason} · exit ${details.exitCode}`)
})
app.on('render-process-gone', (_event, _contents, details) => {
  reportFatal('render-process-gone', `${details.reason} · exit ${details.exitCode}`)
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.nexus.app')

  loadCustomKeymap()
  loadAppearanceFromDisk()
  nativeTheme.themeSource = activeAppearance
  loadThemeFromDisk()
  loadProviderConfigFromDisk()
  tabDiscardManager.init()
  // Frames from a crashed/killed session must not sit in the temp dir forever.
  try {
    const swept = sweepStaleJobDirs()
    if (swept.length) console.log(`[video] swept ${swept.length} stale preparation dir(s)`)
  } catch (error) {
    console.warn('[video] stale sweep failed:', error)
  }
  try {
    const sweptOffice = sweepStaleConversionDirs()
    if (sweptOffice.length) console.log(`[office] swept ${sweptOffice.length} stale conversion dir(s)`)
  } catch (error) {
    console.warn('[office] stale sweep failed:', error)
  }
  tabDiscardManager.onStatusChange((status) => {
    sendToMainWindow('tab_discard_status_updated', {
      residentTabIds: status.residentTabIds,
      discardedTabIds: status.discardedTabIds
    })
  })
  scheduleStartupAndExitPruning(getFinalUserDataDir())
  // Clear upload part directories left behind by earlier sessions (crash or force-quit).
  cleanupStaleUploadTempDirs()
  // Retain persistent partition cache across launches to avoid cold-load network re-download penalties.

  // thumb:// serves JPEG thumbnails from the disk-backed thumbnails dir.
  // 'thumb://abc.jpg' parses as hostname 'abc.jpg' + empty pathname, so
  // concatenating hostname+pathname reconstructs the original filename.
  protocol.handle('thumb', async (request) => {
    try {
      const parsed = new URL(request.url)
      const filename = decodeURIComponent(parsed.hostname + parsed.pathname)
      const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '')
      const filePath = join(thumbnailsDir, safe)
      const data = await readFileSync(filePath)
      return new Response(data, { headers: { 'Content-Type': 'image/jpeg' } })
    } catch {
      return new Response('', { status: 404 })
    }
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
    window.webContents.setWindowOpenHandler(() => {
      // A popup opened from a container tab has to stay in that container's cookie store. Hard-coding
      // the default partition here meant a Google login popup in container "2016" landed in the shared
      // store — signing the wrong account in.
      const partition = partitionOfOpener(window.webContents)
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: window,
          autoHideMenuBar: true,
          webPreferences: {
            partition,
            nodeIntegration: false,
            contextIsolation: true
          }
        }
      }
    })
  })

  installAiSessionPolicy('persist:ai-shared')

  // Register intelligent download manager routing for the app's own windows
  registerDownloadHandler(session.defaultSession)

  // Intercept and cancel WebAuthn/Passkey prompts in webviews so that authentication flows
  // (Google, OpenAI, Claude, Microsoft) fall back smoothly to password/2FA instead of hanging
  // on Windows Hello or unsupported hardware security key modals.
  const setupWebAuthnCancellation = (targetSession: Electron.Session) => {
    try {
      targetSession.on(
        'select-webauthn-account' as any,
        (_event: any, _details: any, callback: any) => {
          if (typeof callback === 'function') {
            try {
              callback() // Invoking with no args cancels the WebAuthn ceremony cleanly
            } catch {
              // ignore
            }
          }
        }
      )
      targetSession.on('select-webauthn-authenticator' as any, (_event: any, callback: any) => {
        if (typeof callback === 'function') {
          try {
            callback()
          } catch {
            // ignore
          }
        }
      })
    } catch {
      // ignore
    }
  }

  // Block webview notifications so AI provider websites (Gemini, ChatGPT, Claude) never trigger duplicate OS notifications
  const blockNotifications = (sess: Electron.Session) => {
    try {
      sess.setPermissionRequestHandler((_webContents, permission, callback) => {
        if (permission === 'notifications') {
          return callback(false)
        }
        callback(true)
      })
      sess.setPermissionCheckHandler((_webContents, permission) => {
        if (permission === 'notifications') {
          return false
        }
        return true
      })
    } catch {}
  }

  blockNotifications(session.fromPartition('persist:ai-shared'))
  blockNotifications(session.defaultSession)

  setupWebAuthnCancellation(session.fromPartition('persist:ai-shared'))
  setupWebAuthnCancellation(session.defaultSession)

  app.on('web-contents-created', (_event, contents) => {
    if (contents && contents.session) {
      registerDownloadHandler(contents.session)
      setupWebAuthnCancellation(contents.session)
      blockNotifications(contents.session)
    }
  })

  createWindow()

  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide Nexus',
      click: () => {
        toggleMainWindow()
      }
    },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setToolTip('Nexus AI')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    toggleMainWindow()
  })

  const noHotkey = process.argv.includes('--no-hotkey')
  const hotkeyArg = process.argv.find((a) => a.startsWith('--hotkey='))
  let customHotkey = hotkeyArg ? hotkeyArg.split('=')[1] : null

  if (!customHotkey && !noHotkey) {
    try {
      const configPath = join(app.getPath('userData'), 'config.json')
      const cfg = JSON.parse(readFileSync(configPath, 'utf-8'))
      if (cfg.hotkey === false || cfg.hotkey === 'none') customHotkey = 'none'
      else if (typeof cfg.hotkey === 'string') customHotkey = cfg.hotkey
    } catch {
      // no config file or invalid json
    }
  }

  const finalHotkey = customHotkey === 'none' || noHotkey ? null : customHotkey || 'Alt+Space'
  updateGlobalHotkey(finalHotkey)

  startAutoUpdates()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // e.preventDefault() not needed, removing app.quit() is enough
})

function focusPromptInView(
  view: Electron.WebContentsView | null | undefined,
  modelKey?: string
): void {
  if (!view || view.webContents.isDestroyed()) return
  // A sign-in page is not an AI page. The callers of this function check for a provider login wall
  // (see loginWall.ts) but not all of them do, so the one guard that covers every caller lives here —
  // and it uses the same predicate as every other injection site, which is broader than the identity
  // one on purpose: nothing of ours goes into any identity provider's page.
  if (isThirdPartyAuthPage(view.webContents.getURL())) return
  let keyToUse = modelKey
  if (!keyToUse && activeViewId) {
    keyToUse = viewModelKeys.get(activeViewId)
  }
  if (!keyToUse) {
    for (const [id, v] of aiViews) {
      if (v === view) {
        keyToUse = viewModelKeys.get(id)
        break
      }
    }
  }
  const feats = keyToUse ? getMergedProviderFeatures(keyToUse, providerConfig[keyToUse]) : null
  const customSel = feats?.composerSelector ? JSON.stringify(feats.composerSelector) : 'null'
  const script = `
    (() => {
      const custom = ${customSel};
      const baseSelectors = [
        // Gemini
        '.ql-editor',
        'rich-textarea [contenteditable="true"]',
        // ChatGPT
        '#prompt-textarea',
        'div#prompt-textarea',
        'textarea[data-id="root"]',
        // Claude
        'div.ProseMirror',
        'div[contenteditable="true"].ProseMirror',
        // Kimi
        'div.chat-input-editor',
        '.chat-input [contenteditable="true"]',
        '.chat-input textarea',
        // Qwen
        'textarea#chat-input', 'textarea[class*="chat-input"]', 'textarea.ant-input:not([style*="display: none"]):not([disabled])',
        // DeepSeek
        '#chat-input',
        'textarea#chat-input',
        'textarea[placeholder*="DeepSeek"]',
        // Perplexity
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="search"]',
        // Generic Universal Fallbacks for Any AI
        '[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        '[contenteditable="true"]',
        '[contenteditable="plaintext-only"]',
        'textarea:not([disabled])',
        'input[type="text"]:not([disabled])'
      ];
      const selectors = custom ? [custom, ...baseSelectors] : baseSelectors;

      const tryFocus = () => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null && !el.disabled) {
            // Already the focused element: touching the caret here is this function's own doing, and
            // the browser has not lost the position. Doing nothing is what keeps a half-written prompt
            // where the user left it (build 35 — the caret used to be thrown to the end on every call).
            if (document.activeElement === el) return true;
            const empty =
              typeof el.value === 'string'
                ? el.value.length === 0
                : (el.textContent || '').length === 0;
            el.focus({ preventScroll: false });
            // Only place the caret when there is nothing to preserve. A composer with text in it keeps
            // whatever selection it had: pressing Ctrl+V or Alt+J must not move the caret to the end.
            if (!empty) return true;
            if (typeof el.selectionStart === 'number') {
              el.selectionStart = el.selectionEnd = el.value.length;
            } else if (window.getSelection && document.createRange) {
              try {
                const range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(false);
                const sel = window.getSelection();
                if (sel) {
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
              } catch (_) {}
            }
            return true;
          }
        }
        return false;
      };

      if (!tryFocus()) {
        setTimeout(tryFocus, 50);
        setTimeout(tryFocus, 150);
        setTimeout(tryFocus, 350);
      }
    })();
  `
  view.webContents.executeJavaScript(script).catch(() => {})
}

function buildWebviewRuntimeJs(modelKey?: string): string {
  const resolvedKey = modelKey || ''
  const globalOv = providerConfig['ALL'] || providerConfig['global'] || {}
  const specificOv = providerConfig[resolvedKey] || {}
  const feats = getMergedProviderFeatures(resolvedKey, specificOv, globalOv)

  const customComp = feats.composerSelector ? JSON.stringify(feats.composerSelector) : 'null'
  const customTitleSel = feats.chatTitleSelector ? JSON.stringify(feats.chatTitleSelector) : 'null'
  const requestedInterval = feats.chatTitlePollingIntervalMs
  const pollInterval =
    requestedInterval === 0
      ? 0
      : typeof requestedInterval === 'number' && Number.isFinite(requestedInterval)
        ? Math.max(500, Math.min(60000, requestedInterval))
        : 1500
  const enableSlash = feats.enableSlashFocus !== false
  const enableRetention = feats.enableFocusRetention !== false
  const virtSelector = feats.virtualizationSelector
    ? feats.virtualizationSelector
    : '[class*="user-query"]:not([class*="assistant"]), .qwen-chat-message-user, .segment.segment-user, .user-query-bubble-with-background'
  const customInit = feats.customInitScript || ''

  return `/* === Nexus AI Webview Runtime Automation Script === */
/* Target Provider: ${resolvedKey || 'Universal'} */

// 0. Fix Shift+Scroll for horizontal scrolling in code blocks (Universal Linux/Electron Quirks fix)
if (!window.__nexusShiftScrollInjected) {
  window.addEventListener('wheel', (e) => {
    // If we receive a purely vertical scroll with Shift held (Electron Linux quirk)
    if (e.shiftKey && e.deltaY !== 0 && e.deltaX === 0) {
      e.preventDefault();
      e.stopPropagation(); // Hide the broken event from Monaco/React

      // Dispatch a corrected horizontal event
      const correctedEvent = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        deltaX: e.deltaY, // Translate vertical to horizontal
        deltaY: 0,
        deltaZ: 0,
        deltaMode: e.deltaMode,
        shiftKey: false // Strip shift so it looks like a pure horizontal trackpad scroll
      });
      e.target.dispatchEvent(correctedEvent);
    }
  }, { capture: true, passive: false });
  window.__nexusShiftScrollInjected = true;
}

// 0b. Disable provider webview notifications so AI web pages never trigger duplicate OS notifications
try {
  if (typeof window !== 'undefined') {
    var DummyNotification = function(title, options) {
      this.title = title;
      this.options = options;
      this.close = function() {};
      this.addEventListener = function() {};
      this.removeEventListener = function() {};
      this.dispatchEvent = function() { return false; };
    };
    DummyNotification.permission = 'denied';
    DummyNotification.requestPermission = function() { return Promise.resolve('denied'); };
    DummyNotification.maxActions = 0;
    try {
      window.Notification = DummyNotification;
    } catch (e) {
      if (window.Notification) {
        window.Notification.requestPermission = function() { return Promise.resolve('denied'); };
        try {
          Object.defineProperty(window.Notification, 'permission', {
            get: function() { return 'denied'; },
            configurable: true
          });
        } catch (err) {}
        window.Notification.prototype.show = function() {};
      }
    }
  }
} catch (e) {}

// 1. Global '/' shortcut to focus chat prompt
if (!window.__slashFocusInjected && ${enableSlash}) {
  window.addEventListener('keydown', (e) => {
    // Ignore if user is already typing in an input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      const custom = ${customComp};
      const baseSelectors = [
        '.ql-editor',
        'rich-textarea [contenteditable="true"]',
        '#prompt-textarea',
        'div#prompt-textarea',
        'textarea[data-id="root"]',
        'div.ProseMirror',
        'div[contenteditable="true"].ProseMirror',
        'div.chat-input-editor',
        '.chat-input [contenteditable="true"]',
        '.chat-input textarea',
        'textarea#chat-input', 'textarea[class*="chat-input"]', 'textarea.ant-input:not([style*="display: none"]):not([disabled])',
        '#chat-input',
        'textarea#chat-input',
        'textarea[placeholder*="DeepSeek"]',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="search"]',
        '[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        '[contenteditable="true"]',
        '[contenteditable="plaintext-only"]',
        'textarea:not([disabled])',
        'input[type="text"]:not([disabled])'
      ];
      const selectors = custom ? [custom, ...baseSelectors] : baseSelectors;
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null && !el.disabled) {
          el.focus();
          if (typeof el.selectionStart === 'number') {
            el.selectionStart = el.selectionEnd = el.value.length;
          }
          break;
        }
      }
    }
  });
  window.__slashFocusInjected = true;
}

// 2. Chat Title Extractor / Polling
(() => {
  ${PAGE_HELPERS}
  if (window.__nexusTitleInterval) {
    clearInterval(window.__nexusTitleInterval);
    window.__nexusTitleInterval = null;
  }
  if (window.__nexusTitleVisibilityHandler) {
    document.removeEventListener('visibilitychange', window.__nexusTitleVisibilityHandler);
    window.__nexusTitleVisibilityHandler = null;
  }
  const titleSel = ${customTitleSel};
  if (titleSel && ${pollInterval > 0}) {
    const updateTitle = () => {
      try {
        if (document.visibilityState === 'hidden') return;
        let txt = '';
        for (const s of splitList(titleSel)) {
          const el = document.querySelector(s);
          if (el) {
            const candidate = (el.innerText || el.textContent || '').trim();
            if (candidate) { txt = candidate; break; }
          }
        }
        if (txt && document.title !== txt) {
          document.title = txt;
        }
      } catch(e) {}
    };
    const syncTitlePolling = () => {
      if (document.visibilityState === 'hidden') {
        if (window.__nexusTitleInterval) clearInterval(window.__nexusTitleInterval);
        window.__nexusTitleInterval = null;
        return;
      }
      updateTitle();
      if (!window.__nexusTitleInterval) window.__nexusTitleInterval = setInterval(updateTitle, ${pollInterval});
    };
    window.__nexusTitleVisibilityHandler = syncTitlePolling;
    document.addEventListener('visibilitychange', syncTitlePolling);
    syncTitlePolling();
  }
  window.__titleExtractionInjected = true;
})();

// 3. Focus retention
if (!window.__focusRetentionInjected && ${enableRetention}) {
  let __savedFocus = null;
  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) {
      __savedFocus = {
        el,
        start: typeof el.selectionStart === 'number' ? el.selectionStart : null,
        end: typeof el.selectionEnd === 'number' ? el.selectionEnd : null
      };
    }
  }, true);

  const __restoreFocus = () => {
    if (__savedFocus && __savedFocus.el && __savedFocus.el.isConnected) {
      const saved = __savedFocus;
      __savedFocus = null;
      try {
        saved.el.focus({ preventScroll: true });
        if (saved.start !== null && saved.el.setSelectionRange) {
          saved.el.setSelectionRange(saved.start, saved.end);
        }
      } catch(e) {}
    }
  };
  window.addEventListener('focus', __restoreFocus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') __restoreFocus();
  });
  window.__focusRetentionInjected = true;
}

// 4. Virtualized Chat Rendering (Memory Optimization)
(() => {
  const sel = ${JSON.stringify(virtSelector)};
  if (sel) {
    let s = document.getElementById('__nexus_virtualization');
    if (!s) {
      s = document.createElement('style');
      s.id = '__nexus_virtualization';
      document.head.appendChild(s);
    }
    const css = \`\${sel} { content-visibility: auto; contain-intrinsic-size: auto 800px; }\`;
    if (s.textContent !== css) s.textContent = css;
  }
})();

// 5. Custom Injected User Script
try {
  ${customInit}
} catch (err) {
  console.error('[Nexus Custom Init Script Error]', err);
}
`
}

function shouldIgnoreProviderTitle(
  title: string,
  defaultTitles: string[] = [],
  modelKey?: string
): boolean {
  if (typeof isDefaultConversationTitle === 'function') {
    return isDefaultConversationTitle(title, modelKey, defaultTitles)
  }
  if (
    !title ||
    !title.trim() ||
    title.trim().toLowerCase() === 'loading' ||
    title.trim().toLowerCase() === 'loading...'
  )
    return true
  const rawLower = title.toLowerCase().trim()
  if (rawLower.startsWith('http://') || rawLower.startsWith('https://')) return true
  const cleaned = (
    typeof cleanConversationTitle === 'function'
      ? cleanConversationTitle(title, modelKey)
      : title.replace(
          /^(chatgpt|kimi\s*ai|kimi|claude|gemini|google\s*gemini|deepseek|perplexity|qwen\s*studio|qwen|arena\s*ai|arena|z\.ai|z\s*chat|glm)\s*[-|–—:•·]\s*/i,
          ''
        )
  ).trim()
  if (!cleaned) return true
  const lower = cleaned.toLowerCase()
  const isDefault = (defaultTitles || []).some((t) => {
    const dLower = (t || '').toLowerCase().trim()
    return lower === dLower || rawLower === dLower
  })
  const genericNoise =
    /^new chat\b/i.test(lower) ||
    lower === 'untitled' ||
    lower === 'chat' ||
    lower === 'chatgpt' ||
    lower === 'qwen' ||
    lower === 'claude' ||
    lower === 'gemini' ||
    lower === 'google gemini' ||
    lower === 'kimi' ||
    lower === 'kimi ai' ||
    lower === 'deepseek' ||
    lower === 'perplexity' ||
    lower === 'arena' ||
    lower === 'arena ai' ||
    lower === 'z.ai' ||
    lower === 'z chat'
  return isDefault || genericNoise
}

function ensureAiView(tabId: string, containerId?: unknown): Electron.WebContentsView {
  let view = aiViews.get(tabId)
  if (view) {
    let isDestroyed = false
    try {
      if (view.webContents && !view.webContents.isDestroyed()) {
        return view
      }
      isDestroyed = view.webContents ? view.webContents.isDestroyed() : false
    } catch (err) {
      console.warn(`[ensureAiView] Accessor check failed for tab ${tabId}:`, err)
      // If the accessor throws, but the manager still retains this view as live,
      // return the existing view instead of creating an orphan replacement.
      if (
        tabDiscardManager &&
        typeof tabDiscardManager.hasView === 'function' &&
        tabDiscardManager.hasView(tabId)
      ) {
        return view
      }
    }

    if (
      !isDestroyed &&
      tabDiscardManager &&
      typeof tabDiscardManager.hasView === 'function' &&
      tabDiscardManager.hasView(tabId)
    ) {
      return view
    }

    // A close may finish natively after our timeout, or another owner may close
    // the contents. Never hand a destroyed wrapper back to activation/navigation.
    aiViews.delete(tabId)
    viewTitles.delete(tabId)
    console.warn('[lifecycle] Recreating destroyed view:', tabId)
  }

  // The partition is decided once, at creation: a container's tabs must never end up sharing a
  // cookie store with another container's, and Electron cannot move a live view between partitions.
  if (containerId !== undefined) rememberTabContainer(tabId, containerId)
  const partition = partitionForTab(tabId)
  installAiSessionPolicy(partition)

  view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition,
      backgroundThrottling: true
    }
  })
  view.webContents.setMaxListeners(50)
  webContentsPartitions.set(view.webContents.id, partition)

  // Own the navigation surface. From here on, every programmatic load, reload, stop or history move on
  // this view records itself with the file and line that called it, so "the tab went back on its own"
  // stops being a theory and becomes a stack frame.
  tapNavigationSurface(view.webContents as unknown as NavigationSurface, (event) => {
    traceNav(tabId, 'prog', event.action, {
      ...(event.url ? { url: event.url } : {}),
      ...(event.caller ? { caller: event.caller } : {}),
      wc: view.webContents.id
    })
  })

  view.webContents.userAgent = AI_UA
  view.webContents.setZoomFactor(currentWebviewZoom)
  setViewBackground(view)
  view.setVisible(false)
  view.webContents.setBackgroundThrottling(true)
  view.webContents.setAudioMuted(true)
  applyColorSchemeEmulation(
    view.webContents,
    resolveEffectiveColorScheme(activeAppearance, nativeTheme.shouldUseDarkColors)
  )

  view.webContents.on('context-menu', (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = [
      { role: 'copy' },
      { role: 'paste' },
      { role: 'cut' },
      { type: 'separator' },
      { role: 'selectAll' },
      { type: 'separator' },
      {
        label: 'Go Back',
        click: () => {
          if (view.webContents.canGoBack()) view.webContents.goBack()
        }
      },
      {
        label: 'Reload Page',
        click: () => {
          traceNav(tabId, 'load', 'reload (context menu)', {})
          view.webContents.reload()
        }
      },
      { type: 'separator' },
      { label: 'Inspect Element', click: () => view.webContents.inspectElement(params.x, params.y) }
    ]
    const menu = Menu.buildFromTemplate(template)
    menu.popup()
  })

  view.webContents.on('render-process-gone', (_e, details) => {
    traceNav(tabId, 'event', 'render-process-gone — reloading', { reason: details.reason })
    console.warn(`[Lifecycle] Tab ${tabId} renderer gone (${details.reason}); reloading it.`)
    try {
      view.webContents.reload()
    } catch (err) {
      console.error('[Lifecycle] Failed to auto-reload:', err)
    }
  })

  /**
   * A main-frame load that fails used to leave the view on whatever it had — usually nothing — until
   * the tab was closed and reopened. Retry once, within the same reload budget, and say why in the
   * console so a recurring failure is identifiable instead of looking like a random blank page.
   */
  view.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      traceNav(tabId, 'event', 'did-fail-load', {
        code: describeLoadFailure(errorCode, errorDescription),
        url: validatedURL,
        pending: navigationIntent.pendingUrl(tabId) || '(none)'
      })
      // ERR_ABORTED is a navigation we replaced on purpose (a redirect or a second load), not a failure.
      // It must NOT drop the intent either: this event fires for the abort that `navigate_tab` is about
      // to judge, and clearing the intent here made the retry conclude "superseded" and give up while
      // the request was still exactly what the user asked for. The load's own callbacks clear it.
      if (errorCode === -3) return
      navigationIntent.forget(tabId)
      console.warn(`[view] ${tabId} load failed: ${errorCode} ${errorDescription} — ${validatedURL}`)
      if (!validatedURL || !/^https?:/i.test(validatedURL)) return
      const key = `retry:${validatedURL}`
      const decision = reloadGuard.shouldReload(tabId, key)
      if (!decision.allow) {
        console.warn(`[view] ${tabId} not retrying: ${decision.reason}`)
        return
      }
      reloadGuard.record(tabId, key)
      setTimeout(() => {
        if (view.webContents.isDestroyed()) return
        console.log(`[view] ${tabId} retrying load once — ${validatedURL}`)
        view.webContents.loadURL(validatedURL).catch((err) => {
          console.warn(`[view] ${tabId} retry failed:`, err?.message ?? err)
        })
      }, 700)
    }
  )

  // Catch newly created popup windows (like OAuth or target="_blank" links)
  view.webContents.on('did-create-window', (popupWindow) => {
    popupWindow.on('closed', () => {
      if (
        activeViewId === tabId &&
        activeViewVisible &&
        !overlaysOpen &&
        !view.webContents.isDestroyed()
      ) {
        view.webContents.focus()
        focusPromptInView(view)
      }
    })
    popupWindow.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.key.toLowerCase() === 'l' && input.type === 'keyDown') {
        event.preventDefault()
        const currentUrl = popupWindow.webContents.getURL()

        // Spawn a tiny frameless window as the URL bar to completely bypass CSP
        const win = new BrowserWindow({
          width: 600,
          height: 60,
          parent: popupWindow,
          modal: true,
          frame: false,
          transparent: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: join(__dirname, '../preload/index.js')
          }
        })

        const safeUrlJson = JSON.stringify(currentUrl || '')
        const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
          </head>
          <body style="margin:0;padding:0;background:transparent;display:flex;justify-content:center;align-items:center;height:100vh;">
            <div style="width:100%;height:100%;background:#1e293b;border:1px solid #334155;border-radius:8px;display:flex;align-items:center;padding:0 12px;box-shadow:0 10px 25px rgba(0,0,0,0.5);box-sizing:border-box;">
              <input id="u" style="flex:1;background:#0f172a;color:#f8fafc;padding:10px 14px;border:1px solid #475569;border-radius:6px;font-size:14px;outline:none;font-family:sans-serif;" />
              <button id="c" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;padding:8px 12px;margin-left:4px;">✕</button>
            </div>
            <script>
              const u = document.getElementById('u');
              u.value = ${safeUrlJson};
              u.select();
              u.focus();
              u.onkeydown = (e) => {
                if (e.key === 'Enter') {
                  window.electron?.ipcRenderer?.send('popup-nav-' + ${win.id}, u.value);
                }
                if (e.key === 'Escape') {
                  window.electron?.ipcRenderer?.send('popup-close-' + ${win.id});
                }
              };
              document.getElementById('c').onclick = () => {
                window.electron?.ipcRenderer?.send('popup-close-' + ${win.id});
              };
            </script>
          </body>
          </html>
        `

        const navHandler = (e: Electron.IpcMainEvent, url: string) => {
          if (e.sender !== win.webContents) return
          if (typeof url === 'string' && url.trim()) {
            let finalUrl = url.trim()
            if (!/^https?:\/\//i.test(finalUrl)) {
              finalUrl = 'https://' + finalUrl
            }
            try {
              const parsed = new URL(finalUrl)
              if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                popupWindow.webContents.loadURL(parsed.href)
              }
            } catch {}
          }
          if (!win.isDestroyed()) win.close()
        }
        const closeHandler = (e: Electron.IpcMainEvent) => {
          if (e.sender !== win.webContents) return
          if (!win.isDestroyed()) win.close()
        }

        ipcMain.once('popup-nav-' + win.id, navHandler)
        ipcMain.once('popup-close-' + win.id, closeHandler)

        win.on('closed', () => {
          ipcMain.removeListener('popup-nav-' + win.id, navHandler)
          ipcMain.removeListener('popup-close-' + win.id, closeHandler)
        })

        win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      }
    })
  })

  // Allow OAuth popup windows to open with window.opener in the shared AI partition
  view.webContents.setWindowOpenHandler((_details) => {
    // The popup belongs to the same session as the view that opened it. Hard-coding the shared
    // partition here meant an OAuth popup in a container wrote its cookies into another account's
    // store: the tab never saw the session and the sign-in looked like it did nothing.
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: mainWindow ?? undefined,
        autoHideMenuBar: true,
        width: 550,
        height: 680,
        center: true,
        webPreferences: {
          partition,
          nodeIntegration: false,
          contextIsolation: true
        }
      }
    }
  })

  // Forward keyboard events (like global shortcuts) from the inner view back to the main window,
  // handling all global shortcuts through unified native IPC routing.
  // Clicking into the page is the clearest statement of intent there is: from then on the keyboard
  // belongs to the view until the shell asks for it back.
  view.webContents.on('focus', () => {
    setKeyboardOwner('view', 'view focused', tabId)
  })

  view.webContents.on('before-input-event', (event, input) => {
    if (routeGlobalShortcut(event, input, 'view')) {
      return
    }

    // Intercept global Ctrl/Cmd shortcuts so Chromium and webview single-page apps don't trigger
    // internal/browser actions (e.g. Save As on Ctrl+S, new window on Ctrl+N, internal search)
    const isControlOrMeta = Boolean(input.control || input.meta)
    const keyLower = (input.key || '').toLowerCase()
    const isB = keyLower === 'b' || input.code === 'KeyB' || input.code?.toLowerCase() === 'keyb'
    const globalKeys = ['b', 'd', 's', 'n', 'o']
    if (
      input.type === 'keyDown' &&
      isControlOrMeta &&
      !input.alt &&
      (globalKeys.includes(keyLower) || isB)
    ) {
      event.preventDefault()
    }
  })

  view.webContents.on('page-title-updated', (_event, title) => {
    const modelKey = viewModelKeys.get(tabId) || ''
    const globalOv = providerConfig['ALL'] || providerConfig['global'] || {}
    const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey], globalOv)
    if (shouldIgnoreProviderTitle(title, feats.defaultChatTitles || [], modelKey)) return
    const cleanTitle =
      (typeof cleanConversationTitle === 'function'
        ? cleanConversationTitle(title, modelKey)
        : title.trim()) || title.trim()
    viewTitles.set(tabId, cleanTitle) // Fix #1: Track titles for proper idle eviction
    if (activeViewId === tabId) arenaTitleSync.invalidate()
    sendToMainWindow('ai-title-updated', tabId, cleanTitle)
  })

  view.webContents.on('dom-ready', () => {
    applyColorSchemeEmulation(
      view.webContents,
      resolveEffectiveColorScheme(activeAppearance, nativeTheme.shouldUseDarkColors)
    )
    const modelKey =
      viewModelKeys.get(tabId) || resolveModelKey(tabId, view.webContents.getURL()) || ''
    // applyWebviewTheme itself clears our stylesheet on an auth page; the rest is provider automation.
    applyWebviewTheme(view, modelKey)
    if (!isThirdPartyAuthPage(view.webContents.getURL())) {
      injectVirtualizationCss(view, modelKey)
      applyProviderMotionMode(view, modelKey)
      executeCustomInitScript(view, modelKey)
      injectAiStatusObserver(view, modelKey, providerConfig, tabViewGenerations.get(tabId) ?? 1)
    }
  })

  view.webContents.on('did-finish-load', () => {
    const modelKey =
      viewModelKeys.get(tabId) || resolveModelKey(tabId, view.webContents.getURL()) || ''
    applyWebviewTheme(view, modelKey)
    if (activeViewId === tabId && activeViewVisible && !overlaysOpen) {
      focusPromptInView(view, modelKey)
    }

    // Provider runtime automation (composer focus, send helpers, status hooks) has no business on an
    // identity provider's page: it cannot match anything there, and its observers only add noise.
    if (!isThirdPartyAuthPage(view.webContents.getURL())) {
      const script = buildWebviewRuntimeJs(modelKey)
      view.webContents.executeJavaScript(script).catch((err) => console.error(err))
      injectAiStatusObserver(view, modelKey, providerConfig, tabViewGenerations.get(tabId) ?? 1)
    }
  })

  // The first and most trustworthy signal that a load actually started. Everything else (promise
  // rejections, did-fail-load, repairs) is downstream of this line, so the trace always begins here.
  view.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    // `wc` is the webContents id. If a tab ever reports two of them, there are two views alive for one
    // tab — the failure mode the trace in build 26 could not rule out, because it printed neither.
    traceNav(tabId, 'event', 'did-start-navigation', {
      url,
      inPlace: isInPlace,
      mainFrame: isMainFrame,
      pending: navigationIntent.pendingUrl(tabId) || '(none)',
      wc: view.webContents.id
    })

    // The user's URL is in flight and the page we left is starting to navigate the frame back. The
    // last six builds waited for that navigation to finish and retried afterwards, which meant the
    // page had already re-committed to its old URL and our retry was, from Chromium's point of view,
    // the interloper. So we take the frame back instead: starting our load cancels theirs. Bounded by
    // NAV_DEFENCE_BUDGET, and only for the page we were leaving — a redirect to another host during
    // the load is a normal load and is left alone.
    const wanted = navWanted.get(tabId)
    const pendingUrl = wanted?.url
    const leaving = navLeaveFrom.get(tabId) || ''
    const defence = navDefences.get(tabId)
    const now = Date.now()
    if (
      shouldDefend({
        isMainFrame,
        incomingUrl: url,
        pendingUrl: leaving && sameSiteUrl(url, leaving) ? pendingUrl || null : null,
        sameUrl: sameSiteUrl,
        defencesUsed: defence && defence.url === pendingUrl ? defence.used : 0,
        budget: NAV_DEFENCE_BUDGET,
        lastDefenceAt: defence && defence.url === pendingUrl ? defence.at : 0,
        now
      }) &&
      pendingUrl
    ) {
      const used = (defence && defence.url === pendingUrl ? defence.used : 0) + 1
      navDefences.set(tabId, { used, at: now, url: pendingUrl })
      traceNav(tabId, 'abort', 'taking the frame back from the old page', {
        intruder: url,
        keeping: pendingUrl,
        defence: `${used}/${NAV_DEFENCE_BUDGET}`,
        wc: view.webContents.id
      })

      // Build 28 called `loadURL` from inside this handler; build 29 called `stop()`. Both are
      // re-entrant native calls made while Chromium is *starting* a navigation, and both behaved as
      // badly as that sounds: 28 aborted its own load (`ERR_FAILED -2`), 29 closed the app — the trace
      // ends on the `stop` line, which is the last thing that ran. So the handler now does nothing but
      // schedule: it returns immediately and the actual work happens outside the event dispatch.
      //
      // No `stop()` either. Asking for the user's URL after the intruder has been left alone for a
      // moment cancels it anyway, and cancelling is not worth a crash.
      navBouncedTabs.add(tabId)
      scheduleDefence(view, tabId, pendingUrl)
      return
    }
  })

  // Electron only emits these for a navigation the *page* started (a link, a script, a meta refresh,
  // a redirect chain). A load we started through `loadURL` never reaches them. So a `will-navigate`
  // naming a URL we did not ask for is the page changing itself — the one thing the trace could not
  // distinguish from a load of ours before.
  /**
   * The page is holding the document hostage.
   *
   * This is the answer to the whole Ctrl+L saga. Electron says it plainly in the `loadURL` docs: *"If the
   * existing page has a beforeUnload handler, did-fail-load will be called unless will-prevent-unload is
   * handled."* Every one of these chat apps registers `beforeunload` — draft protection, unsaved prompt,
   * an open composer — and by default Electron honours it. So the load we asked for was cancelled by the
   * page, Chromium re-committed the document it was already on, and the trace showed a main-frame
   * `did-start-navigation` to the *current* URL a few milliseconds after ours: not an intruder, not a
   * restore, just a page that refused to unload. `will-navigate` never fired because nothing navigated.
   *
   * Six builds tried to out-wait, out-retry, out-stop and out-clear that. None of it could work: the
   * navigation was never blocked by another navigation.
   *
   * Calling `event.preventDefault()` here means "ignore the beforeunload handler and let the page go",
   * which is what a URL bar means. It is only done when the user actually asked for a different page, so
   * a page's own guard still applies when nothing of ours is in flight.
   */
  view.webContents.on('will-prevent-unload', (event: Electron.Event) => {
    const wanted = navWanted.get(tabId)?.url
    let current = ''
    try {
      current = view.webContents.getURL() || ''
    } catch {
      current = ''
    }
    traceNav(tabId, 'event', 'will-prevent-unload — the page tried to keep itself', {
      current,
      wanted: wanted || '(none)',
      wc: view.webContents.id
    })
    if (!wanted) return
    try {
      event.preventDefault()
      traceNav(tabId, 'note', 'leaving anyway — the user asked for another page', { url: wanted })
    } catch {
      /* if Electron ever refuses, the request loop still reports the failure */
    }
  })

  /**
   * The page navigating *itself* — and, while the user's request is in flight, the one thing we can
   * refuse out loud.
   *
   * `will-navigate` is emitted before a page-initiated main-frame navigation starts, which is the moment
   * the build-31 trace kept naming (`asked=no`) five milliseconds after each of our loads. Cancelling it
   * here is not a retry and cannot abort our own load: the intruder never gets to start, so there is
   * nothing for ours to lose against.
   *
   * It is deliberately narrow. Only a navigation back to the site we are leaving, and only while a URL
   * the user asked for is still pending, is refused — a redirect *during* the load (a sign-in hop, a
   * canonical host, a deepseek conversation URL under the new site) is a normal part of loading and is
   * left alone. A page's own link clicks are untouched when nothing of ours is in flight.
   */
  view.webContents.on('will-navigate', (event, url) => {
    const pending = navigationIntent.pendingUrl(tabId)
    const wanted = navWanted.get(tabId)?.url
    const leaving = navLeaveFrom.get(tabId) || ''
    const asked = !!(pending && sameSiteUrl(url, pending))
    const goingBackToItself = !!(wanted && leaving && sameSiteUrl(url, leaving) && !sameSiteUrl(url, wanted))
    traceNav(tabId, 'event', 'will-navigate — the page is navigating itself', {
      url,
      pending: pending || '(none)',
      asked: asked ? 'yes' : 'no',
      self: goingBackToItself ? 'yes' : 'no',
      wc: view.webContents.id
    })
    if (!wanted || asked || !goingBackToItself) return
    try {
      event.preventDefault()
      traceNav(tabId, 'abort', 'refused — the page may not navigate itself back while a URL is pending', {
        refused: url,
        keeping: wanted,
        wc: view.webContents.id
      })
    } catch {
      /* if the event cannot be cancelled, the defence and the rebuild still apply */
    }
  })

  view.webContents.on('did-navigate', (_event, url) => {
    traceNav(tabId, 'event', 'did-navigate (committed)', {
      url,
      pending: navigationIntent.pendingUrl(tabId) || '(none)',
      wc: view.webContents.id
    })
    // Evidence, not behaviour: if a tab is being navigated by something we have not found yet, this
    // says so once, with the URL, instead of leaving a page that appears to refresh forever.
    const now = Date.now()
    const entry = navigationCounters.get(tabId)
    if (!entry || now - entry.since > 60_000) {
      navigationCounters.set(tabId, { count: 1, since: now })
    } else {
      entry.count += 1
      if (entry.count === 6) {
        console.warn(
          `[nav] tab ${tabId} navigated ${entry.count} times in under a minute — something is reloading it (${url})`
        )
      }
    }
    const nextGen = bumpTabViewGeneration(tabId)
    setTabAiLifecycle(tabId, 'unknown', { viewGeneration: nextGen, skipTimer: true })
    viewCssState.delete(view.webContents)
    resolveModelKey(tabId, url)
    sendToMainWindow('ai-url-updated', tabId, url)
    // `url` and the tab's own account: a container recovers only for its own store, and a tab that is
    // *on* Google's sign-in page is left alone entirely (that is where the user signs in).
    void recoverGoogleSessionFromLatestBrowser(
      tabId,
      view,
      url,
      containerForTab(tabId)?.accountId ?? 'default'
    )
  })
  view.webContents.on('did-navigate-in-page', (_event, url) => {
    sendToMainWindow('ai-url-updated', tabId, url)
    const modelKey = viewModelKeys.get(tabId) || resolveModelKey(tabId, url) || ''
    if (!isThirdPartyAuthPage(url)) {
      injectAiStatusObserver(view, modelKey, providerConfig, tabViewGenerations.get(tabId) ?? 1)
    }
  })
  view.webContents.on('did-start-loading', () => {
    sendToMainWindow('ai-loading', tabId, true)
  })
  view.webContents.on('did-stop-loading', () => {
    // `did-stop-loading` carries no frame information and fires for subframe traffic too — the build-43
    // trace has ten of them, each one line after `did-start-navigation {url=about:blank mainFrame=false}`.
    // Treating those as "the page finished loading" cleared the navigation intent while the *main frame*
    // was still loading, which is the claim that `repairTabSurface`, the URL-bar load and the abort
    // defence all rely on ("detach (repair) — aborts any load in flight"). So ask the contents whether it
    // is still loading: a subframe stop leaves that true, and is left alone.
    let stillLoading = false
    try {
      stillLoading = view.webContents.isLoading()
    } catch {
      stillLoading = false
    }
    traceNav(tabId, 'event', 'did-stop-loading', {
      url: (() => {
        try {
          return view.webContents.getURL() || '(empty)'
        } catch {
          return '(gone)'
        }
      })(),
      pending: navigationIntent.pendingUrl(tabId) || '(none)',
      stillLoading
    })
    if (stillLoading) {
      // A subframe finished, not the page. Nothing about the tab's navigation state has changed.
      tabDiscardManager.reconcileCapacity()
      return
    }
    navigationIntent.forget(tabId)
    tabDiscardManager.reconcileCapacity()
    sendToMainWindow('ai-loading', tabId, false)
    // A load finishing never takes the keyboard. It used to, and a page that reloads itself (deepseek,
    // and any SPA that restores its route) pulled focus out of the shell twice a second — after which
    // Ctrl+L opened an address bar that could not be typed into. The keyboard stays wherever the user
    // put it; `did-stop-loading` may only keep it, never move it.
    if (keyboardStaysWithView(view, tabId)) {
      focusPromptInView(view, viewModelKeys.get(tabId))
    }
  })

  // Transactional registration: register with TabDiscardManager BEFORE adding to window or setting in aiViews
  const viewGen = bumpTabViewGeneration(tabId)
  setTabAiLifecycle(tabId, 'unknown', { viewGeneration: viewGen, skipTimer: true })
  tabDiscardManager.registerView(tabId, view as unknown as DiscardableView)

  attachAiStatusListener(
    view.webContents,
    tabId,
    (id, isGenerating, lastSnippet, report) => {
      const currentGen = tabViewGenerations.get(id) ?? 1
      if (report?.viewGeneration !== undefined && report.viewGeneration !== currentGen) {
        return
      }
      if (report?.status) {
        setTabAiLifecycle(id, report.status, {
          lastSnippet,
          error: report.error,
          viewGeneration: report.viewGeneration ?? currentGen
        })
      } else if (report?.initial) {
        setTabAiLifecycle(id, report.hasReliableHooks ? 'idle' : 'unknown', {
          viewGeneration: report.viewGeneration ?? currentGen
        })
      } else {
        const nextStatus: AiLifecycleStatus = isGenerating
          ? 'working'
          : id !== activeViewId && isSnippetAwaitingInput(lastSnippet)
            ? 'waiting-input'
            : 'done'
        setTabAiLifecycle(id, nextStatus, { lastSnippet, viewGeneration: currentGen })
      }
    },
    () => tabViewGenerations.get(tabId) ?? 1
  )

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      traceViewOp(tabId, 'attach (ensureAiView)', {})
      mainWindow.contentView.addChildView(view)
      if (aiNotificationView) {
        mainWindow.contentView.removeChildView(aiNotificationView)
        mainWindow.contentView.addChildView(aiNotificationView)
      }
      // addChildView(view) puts the native AI canvas on top. Downloads must
      // be attached last or only the portion outside the canvas is visible.
      downloadNotificationOverlay?.raiseToFront()
    } catch {}
  }

  aiViews.set(tabId, view)
  // A freshly attached page is stacked above the in-app toast; put the toast back on top.
  raiseNativeOverlays()
  return view
}

ipcMain.on('navigate_to_url', async (_event, tabId, url, bounds, modelKey, containerId) => {
  rememberTabContainer(tabId, containerId)
  await tabDiscardManager.waitForClose(tabId)
  wakeTokens.set(tabId, (wakeTokens.get(tabId) || 0) + 1)
  activeWakeOperations.delete(tabId)
  console.log('[navigate_to_url]', tabId, url)
  tabDiscardManager.onExplicitNavigation(tabId)
  resolveModelKey(tabId, url, modelKey)

  if (currentUiZoom !== 1.0 && bounds) {
    bounds = {
      x: Math.round(bounds.x * currentUiZoom),
      y: Math.round(bounds.y * currentUiZoom),
      width: Math.round(bounds.width * currentUiZoom),
      height: Math.round(bounds.height * currentUiZoom)
    }
  }

  const view = ensureAiView(tabId, containerId)
  applyWebviewTheme(view, viewModelKeys.get(tabId))
  view.setBounds(bounds)
  if (bounds.width > 0) lastRealBounds.set(tabId, bounds)
  const currentUrl = view.webContents.getURL()
  if (currentUrl !== url && !view.webContents.isLoading()) {
    traceNav(tabId, 'load', 'loadURL (ensureAiView)', { url })
    void view.webContents.loadURL(url).catch((err) => {
      if (err?.code === 'ERR_ABORTED' || err?.errno === -3) return
      console.warn(`[navigate_to_url] Failed to load URL for ${tabId}:`, err)
    })
  }
})

// Native appearance management: defaults to dark across all platforms
let activeAppearance: ThemeAppearance = DEFAULT_THEME_APPEARANCE

function appearanceFile() {
  return join(app.getPath('userData'), 'theme-appearance.json')
}

function loadAppearanceFromDisk() {
  try {
    const file = appearanceFile()
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed && isValidThemeAppearance(parsed.appearance)) {
        activeAppearance = parsed.appearance
        return
      }
    }
  } catch {}
  activeAppearance = DEFAULT_THEME_APPEARANCE
}

function persistAppearance() {
  try {
    atomicWriteJson(appearanceFile(), { appearance: activeAppearance })
  } catch {}
}

// Webview theming: inject the active app theme's own colors into AI pages.
// Persisted to disk so views are born themed on cold start (no raw-style flash),
// and re-applied on every dom-ready/did-finish-load so navigations keep it.
let webviewTheme: { on: boolean; colors: Record<string, string> | null; radius?: number } | null =
  null

function themeFile() {
  return join(app.getPath('userData'), 'webview-theme.json')
}

function loadThemeFromDisk() {
  try {
    const file = themeFile()
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && 'colors' in parsed) {
        webviewTheme = parsed
        return
      }
    }
    // Migration: if legacy theme.json contains webview-theme data (has colors/on and lacks activeId)
    const legacy = join(app.getPath('userData'), 'theme.json')
    if (existsSync(legacy)) {
      const legacyRaw = readFileSync(legacy, 'utf-8')
      const legacyParsed = JSON.parse(legacyRaw)
      if (
        legacyParsed &&
        typeof legacyParsed === 'object' &&
        ('colors' in legacyParsed || 'on' in legacyParsed) &&
        !('activeId' in legacyParsed)
      ) {
        webviewTheme = legacyParsed
        persistTheme()
        return
      }
    }
  } catch {
    // first run: no theme file yet
  } finally {
    // Ensure webviewTheme has default fallback colors on startup so views are born themed
    if (!webviewTheme || !webviewTheme.colors) {
      webviewTheme = {
        on: true,
        colors: {
          bg: '#050f14',
          surface: '#07101e',
          surface2: '#0b192e',
          accent: '#00e5ff',
          text: '#e0f7fa',
          text2: '#4dd0e1',
          border: '#0d47a1'
        },
        radius: 4
      }
    }
  }
}

function persistTheme() {
  try {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    atomicWriteJson(themeFile(), webviewTheme ?? null)
  } catch {
    // non-fatal: theme still applies in-session
  }
}

function setViewBackground(view) {
  const bg = webviewTheme?.on && webviewTheme.colors?.bg ? webviewTheme.colors.bg : '#1a1a2e'
  view.setBackgroundColor(bg)
}

// Per-provider webview overrides (keyed by ModelDef.key), owned by main and
// persisted so views are born customized on cold start. Renderer syncs via
// get_provider_config / set_provider_config IPC.

// Live-preview capture stream (Settings → Webview tab). Captures the REAL
// view (no duplicate page), streams ~3fps to the renderer panel.
const previewLoop = new PreviewCaptureLoop<string>({
  intervalMs: 1000,
  canCapture: () =>
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.isVisible() &&
    !mainWindow.isMinimized() &&
    mainWindow.isFocused(),
  capture: async (tabId) => {
    const view = aiViews.get(tabId)
    if (!view || view.webContents.isDestroyed()) return null
    const img = await view.webContents.capturePage()
    if (aiViews.get(tabId) !== view || view.webContents.isDestroyed() || img.isEmpty()) return null
    const size = img.getSize()
    const resized = size.width > 960 ? img.resize({ width: 960, quality: 'good' }) : img
    return 'data:image/jpeg;base64,' + resized.toJPEG(78).toString('base64')
  },
  publish: (frame) => sendToMainWindow('webview_preview_frame', frame)
})
let previewViewId: string | null = null
let previewRestoreBounds: Electron.Rectangle | null = null
// Last non-zero view bounds per tab — used to un-hide a view for capture while
// the settings overlay covers it.
const lastRealBounds = new Map<string, Electron.Rectangle>()
let resizeThemeTimer: NodeJS.Timeout | null = null

function providerConfigFile() {
  return join(app.getPath('userData'), 'providers.json')
}

function loadProviderConfigFromDisk() {
  const filePath = providerConfigFile()
  if (!existsSync(filePath)) {
    // Fresh install or missing file: initialize with user's exact default configurations
    providerConfig = JSON.parse(JSON.stringify(DEFAULT_BUILTIN_PROVIDER_CONFIG))
    persistProviderConfig()
    return
  }
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      const merged: import('../shared/providerConfig').ProviderConfigMap = {}
      for (const [k, v] of Object.entries(DEFAULT_BUILTIN_PROVIDER_CONFIG)) {
        merged[k] = JSON.parse(JSON.stringify(v))
      }
      for (const [k, v] of Object.entries(parsed)) {
        if (merged[k] && typeof merged[k] === 'object' && typeof v === 'object' && v !== null) {
          merged[k] = {
            ...merged[k],
            ...(v as any),
            cssFeatures: { ...merged[k].cssFeatures, ...(v as any).cssFeatures },
            themeSelectors: { ...merged[k].themeSelectors, ...(v as any).themeSelectors },
            features: { ...merged[k].features, ...(v as any).features },
            geometry: { ...merged[k].geometry, ...(v as any).geometry }
          }
        } else {
          merged[k] = v as any
        }
      }
      let migratedArena = false
      for (const arenaKey of ['arena-ai', 'arena'] as const) {
        if (merged[arenaKey]) {
          const res = migrateLegacyArenaFeatures(merged[arenaKey].features)
          if (res.migrated) {
            merged[arenaKey] = { ...merged[arenaKey], features: res.features }
            migratedArena = true
          }
        }
      }
      providerConfig = merged
      if (migratedArena) {
        persistProviderConfig()
      }
    } else {
      providerConfig = JSON.parse(JSON.stringify(DEFAULT_BUILTIN_PROVIDER_CONFIG))
      persistProviderConfig()
    }
  } catch (e) {
    console.error('[ProviderConfig] Corrupted providers.json, creating backup:', e)
    try {
      copyFileSync(filePath, `${filePath}.corrupt.${Date.now()}`)
    } catch {}
    providerConfig = JSON.parse(JSON.stringify(DEFAULT_BUILTIN_PROVIDER_CONFIG))
  }
}

function persistProviderConfig() {
  try {
    const filePath = providerConfigFile()
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })

    // SAFETY GUARD: Refuse to overwrite non-empty providers.json with an empty object!
    if (
      !providerConfig ||
      typeof providerConfig !== 'object' ||
      Object.keys(providerConfig).length === 0
    ) {
      if (existsSync(filePath)) {
        try {
          const existing = readFileSync(filePath, 'utf-8').trim()
          if (existing && existing !== '{}') {
            console.warn(
              '[ProviderConfig] Refusing to overwrite non-empty providers.json with empty config.'
            )
            return
          }
        } catch {}
      }
    }

    // Safety backup of existing configuration before overwriting
    if (existsSync(filePath)) {
      try {
        copyFileSync(filePath, `${filePath}.bak`)
      } catch {}
    }

    const tmpPath = `${filePath}.tmp`
    writeFileSync(tmpPath, JSON.stringify(providerConfig, null, 2), 'utf-8')
    renameSync(tmpPath, filePath)
  } catch (e) {
    console.error('[ProviderConfig] Failed to persist providers.json atomically:', e)
  }
}

function updateWebviewTitlePoller(view: Electron.WebContentsView, modelKey: string): void {
  if (view.webContents.isDestroyed()) return
  // Same rule as focusPromptInView: nothing is injected into an identity provider's page.
  if (isThirdPartyAuthPage(view.webContents.getURL())) return
  // Keep live reconfiguration consistent with buildWebviewRuntimeJs.
  const globalOv = providerConfig['ALL'] || providerConfig['global'] || {}
  const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey], globalOv)
  const customTitleSel = feats.chatTitleSelector ? JSON.stringify(feats.chatTitleSelector) : 'null'
  const requestedInterval = feats.chatTitlePollingIntervalMs
  const pollInterval =
    requestedInterval === 0
      ? 0
      : typeof requestedInterval === 'number' && Number.isFinite(requestedInterval)
        ? Math.max(500, Math.min(60000, requestedInterval))
        : 1500
  const script = `(() => {
    ${PAGE_HELPERS}
    if (window.__nexusTitleInterval) {
      clearInterval(window.__nexusTitleInterval);
      window.__nexusTitleInterval = null;
    }
    if (window.__nexusTitleVisibilityHandler) {
      document.removeEventListener('visibilitychange', window.__nexusTitleVisibilityHandler);
      window.__nexusTitleVisibilityHandler = null;
    }
    const titleSel = ${customTitleSel};
    if (titleSel && ${pollInterval > 0}) {
      const updateTitle = () => {
        try {
          if (document.visibilityState === 'hidden') return;
        let txt = '';
          for (const s of splitList(titleSel)) {
            const el = document.querySelector(s);
            if (el) {
              const candidate = (el.innerText || el.textContent || '').trim();
              if (candidate) { txt = candidate; break; }
            }
          }
          if (txt && document.title !== txt) {
            document.title = txt;
          }
        } catch(e) {}
      };
      const syncTitlePolling = () => {
        if (document.visibilityState === 'hidden') {
          if (window.__nexusTitleInterval) clearInterval(window.__nexusTitleInterval);
          window.__nexusTitleInterval = null;
          return;
        }
        updateTitle();
        if (!window.__nexusTitleInterval) window.__nexusTitleInterval = setInterval(updateTitle, ${pollInterval});
      };
      window.__nexusTitleVisibilityHandler = syncTitlePolling;
      document.addEventListener('visibilitychange', syncTitlePolling);
      syncTitlePolling();
    }
  })()`
  view.webContents.executeJavaScript(script).catch(() => {})
}

// Explicit opt-in; a sequence prevents stale async changes from restoring an older setting.
let providerMotionSequence = 0
function applyProviderMotionMode(view: Electron.WebContentsView, modelKey: string): void {
  if (isThirdPartyAuthPage(view.webContents.getURL())) return
  if (view.webContents.isDestroyed()) return
  const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
  const script = buildProviderMotionScript(
    feats.pauseCssAnimations === true,
    ++providerMotionSequence
  )
  view.webContents.executeJavaScript(script).catch((err) => {
    console.warn('[provider-motion] Could not update provider animation setting:', err)
  })
}

function injectVirtualizationCss(view: Electron.WebContentsView, modelKey: string): void {
  if (isThirdPartyAuthPage(view.webContents.getURL())) return
  if (view.webContents.isDestroyed()) return
  const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
  const sel = feats.virtualizationSelector
  if (!sel) return
  const css = `${sel} { content-visibility: auto; contain-intrinsic-size: auto 800px; }`
  view.webContents
    .executeJavaScript(
      `(() => {
      let s = document.getElementById('__nexus_virtualization');
      if (!s) { s = document.createElement('style'); s.id = '__nexus_virtualization'; document.head.appendChild(s); }
      const css = ${JSON.stringify(css)};
      if (s.textContent !== css) s.textContent = css;
    })()`
    )
    .catch(() => {})
}

function executeCustomInitScript(view: Electron.WebContentsView, modelKey: string): void {
  if (isThirdPartyAuthPage(view.webContents.getURL())) return
  if (view.webContents.isDestroyed()) return
  const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
  const script = feats.customInitScript
  if (!script || !script.trim()) return
  view.webContents
    .executeJavaScript(
      `(() => {
      try {
        ${script}
      } catch (err) {
        console.error('[Nexus Custom Init Script Error]', err);
      }
    })()`
    )
    .catch((err) => {
      console.warn(`[nexus] customInitScript failed for ${modelKey}:`, err)
    })
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16
  )
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
function isDarkColor(hex) {
  const { r, g, b } = hexToRgb(hex)
  // Perceived luminance (WCAG-ish): dark <= 0.45
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 <= 0.45
}

function buildWebviewThemeCss(themeData, url, viewWidthPx, overrides, modelKey?: string) {
  const colors = themeData.colors || {}
  const dark = isDarkColor(colors.bg || '#1a1a2e')
  const vars = {
    bg: colors.bg || '#1a1a2e',
    surface: colors.surface || '#16213e',
    surface2: colors.surface2 || '#0f3460',
    accent: colors.accent || '#e94560',
    text: colors.text || '#eaeaea',
    text2: colors.text2 || '#8899aa',
    border: colors.border || '#2a2a2e',
    radius: themeData.radius ?? 8,
    borderWidth: 1,
    ambientAura: themeData.ambientAura,
    ambientAuraMode: themeData.ambientAuraMode,
    ambientAuraIntensity: themeData.ambientAuraIntensity,
    ambientAuraColor: themeData.ambientAuraColor,
    ambientAuraLive: themeData.ambientAuraLive,
    bubbleStyle: themeData.bubbleStyle,
    bubbleGradientDepth: themeData.bubbleGradientDepth,
    codeBlockStyle: themeData.codeBlockStyle,
    codeBlockMargin: themeData.codeBlockMargin,
    composerGlow: themeData.composerGlow,
    composerHaloIntensity: themeData.composerHaloIntensity,
    messageGap: themeData.messageGap,
    aiResponseWidthPx: themeData.aiResponseWidthPx,
    userPromptWidthPx: themeData.userPromptWidthPx,
    cssFeatures: overrides?.cssFeatures || {}
  }
  const merged = mergeOverrides(vars, overrides)
  if (merged.pageWidthPx != null && typeof viewWidthPx === 'number' && viewWidthPx > 0) {
    merged.pageWidthPx = Math.max(320, Math.min(merged.pageWidthPx, viewWidthPx - 40))
  }
  let host = ''
  try {
    host = url ? new URL(url).host : ''
  } catch {
    host = ''
  }
  const provider = PROVIDER_THEMES.find((p) =>
    p.hosts.some((h) => host === h || host.endsWith('.' + h))
  )
  let css = provider ? provider.css(merged) : genericFallbackCss(merged, dark)

  // Apply customthemes.conf if exists
  const customKey = modelKey || resolveModelKey('', url)
  if (customKey) {
    const customEntry = getCustomThemeEntry(customKey, host)
    if (customEntry && customEntry.enabled && customEntry.css) {
      css += '\n\n/* customthemes.conf */\n' + customEntry.css
    }
  }

  // Sanitize customCss before appending: strip bare property declarations
  // (lines like "--bg: #0a0a0f;" outside any selector block) and validate
  // the CSS doesn't start with naked text that crashes the parser.
  if (overrides?.customCss) {
    let userCss = overrides.customCss.trim()
    const lines = userCss.split('\n')
    const cleaned: string[] = []
    let insideBlock = 0
    let insideComment = false
    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed.includes('/*')) insideComment = true

      if (!insideComment) {
        for (const ch of trimmed) {
          if (ch === '{') insideBlock++
          if (ch === '}') insideBlock = Math.max(0, insideBlock - 1)
        }
      }

      let skip = false
      if (!insideComment && insideBlock === 0) {
        if (/^--[\w-]+\s*:/.test(trimmed)) skip = true
        else if (
          trimmed.length > 0 &&
          !trimmed.startsWith('/') &&
          !trimmed.startsWith('@') &&
          !trimmed.includes('{') &&
          !trimmed.includes('}') &&
          !trimmed.includes(':') &&
          !trimmed.includes(';') &&
          !trimmed.endsWith(',')
        )
          skip = true
      }

      if (trimmed.includes('*/')) insideComment = false

      if (!skip) cleaned.push(line)
    }
    userCss = cleaned.join('\n').trim()
    if (userCss) css += '\n' + userCss
  }

  return css
}

function genericFallbackCss(v, dark) {
  const feat = v.cssFeatures || { structural: true, colors: true, bubbles: true, typography: true }

  const doStruct = feat.structural !== false
  const doColor = feat.colors !== false
  const doBubble = feat.bubbles !== false
  const doTypo = feat.typography !== false

  const typography: string[] = []
  if (doTypo) {
    if (v.fontWeight != null) typography.push(`font-weight: ${v.fontWeight} !important;`)
    if (v.fontSize != null) typography.push(`font-size: ${v.fontSize}px !important;`)
    if (v.fontFamily) typography.push(`font-family: ${v.fontFamily} !important;`)
    if (v.lineHeight != null) typography.push(`line-height: ${v.lineHeight} !important;`)
    if (v.letterSpacing != null) typography.push(`letter-spacing: ${v.letterSpacing}px !important;`)
  }
  const bodyTypography = typography.length ? `body { ${typography.join(' ')} }` : ''

  return `
    ${getStructuralVars(v)}
    :root {
      color-scheme: ${dark ? 'dark' : 'light'} !important;
      --nexus-bg: ${v.bg};
      --nexus-surface: ${v.surface};
      --nexus-surface2: ${v.surface2};
      --nexus-accent: ${v.accent};
      --nexus-text: ${v.text};
      --nexus-text2: ${v.text2};
      --nexus-border: ${v.border};
      --radius: ${v.radius ?? 8}px;
    }
    html { color-scheme: ${dark ? 'dark' : 'light'} !important; }
    ${
      doColor
        ? `
    html { background-color: var(--nexus-bg) !important; color-scheme: ${dark ? 'dark' : 'light'} !important; }
    body { background-color: var(--nexus-bg) !important; ${bodyTypography} }
    ::selection { background: var(--nexus-accent) !important; color: var(--nexus-bg) !important; }
    a { color: var(--nexus-accent) !important; }
    input, textarea, [contenteditable="true"] { caret-color: var(--nexus-accent) !important; }
    `
        : ''
    }

    * { scrollbar-color: var(--nexus-surface2) var(--nexus-surface) !important; scrollbar-width: thin !important; }
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-thumb { background: var(--nexus-surface2) !important; border-radius: 9999px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--nexus-accent) !important; }
    ::-webkit-scrollbar-track { background: transparent !important; }

    /* Universal Code Block & Container Safety for Unthemed / Custom Agents */
    pre, code, pre > code, .code-block, [class*="code-block"], [class*="codeBlock"] {
      max-width: 100% !important;
      box-sizing: border-box !important;
    }
    pre {
      overflow-x: auto !important;
      white-space: pre !important;
      word-break: normal !important;
      word-wrap: normal !important;
    }
    html, body, #root, #app, #__next, main, [class*="chat-history"], [class*="conversation"] {
      max-width: 100% !important;
      box-sizing: border-box !important;
    }

    ${ambientAuraCss(v)}

    ${
      v.themeSelectors?.appContainer
        ? `
    /* Custom App Container & Canvas Transparency Overwrite */
    #root, #__next, #app, body > div, body > main,
    ${v.themeSelectors.appContainer},
    ${v.themeSelectors.appContainer} > div,
    ${v.themeSelectors.appContainer} > div > div,
    ${v.themeSelectors.appContainer} main {
      ${doColor ? 'background-color: transparent !important; background-image: none !important;' : ''}
    }
    `
        : ''
    }

    ${
      v.themeSelectors?.chatWrapper
        ? `
    /* Custom Central Chat Column Overwrite */
    ${v.themeSelectors.chatWrapper} {
      ${doColor ? 'background-color: transparent !important; background-image: none !important;' : ''}
      ${
        doStruct
          ? `
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      padding-left: calc(max(1rem, 50% - (var(--nexus-ai-width) / 2))) !important;
      padding-right: calc(max(1rem, 50% - (var(--nexus-ai-width) / 2))) !important;
      `
          : ''
      }
    }`
        : ''
    }

    ${
      v.themeSelectors?.sidebar
        ? `
    /* Custom Sidebar Overwrite */
    ${v.themeSelectors.sidebar} {
      ${doColor ? 'background-color: var(--nexus-surface) !important; border-color: var(--nexus-border) !important;' : ''}
    }`
        : ''
    }

    ${
      v.themeSelectors?.header
        ? `
    /* Custom Header Overwrite */
    ${v.themeSelectors.header} {
      ${doColor ? 'background-color: transparent !important; border-bottom: 1px solid var(--nexus-border) !important;' : ''}
    }`
        : ''
    }

    ${
      v.themeSelectors?.modelDropdown
        ? `
    /* Custom Model Dropdown / Badge Overwrite */
    ${v.themeSelectors.modelDropdown} {
      ${doColor ? 'background-color: var(--nexus-surface) !important; color: var(--nexus-text) !important; border: 1px solid var(--nexus-border) !important;' : ''}
      ${doBubble ? 'border-radius: var(--radius) !important;' : ''}
    }`
        : ''
    }

    ${
      v.themeSelectors?.userMessage
        ? `
    /* Custom User Message Overwrite */
    ${v.themeSelectors.userMessage} {
      ${
        doBubble
          ? `
      background: var(--nexus-bubble-bg) !important;
      background-color: var(--nexus-bubble-bg-color) !important;
      background-image: var(--nexus-bubble-bg) !important;
      border: var(--nexus-bubble-border) !important;
      border-radius: var(--radius) !important;
      box-shadow: var(--nexus-bubble-shadow) !important;
      padding: 12px 16px !important;
      `
          : ''
      }
      ${doColor ? 'color: var(--nexus-text) !important;' : ''}
      ${
        doStruct
          ? `
      width: max-content !important;
      max-width: var(--nexus-user-width) !important;
      margin-left: auto !important;
      margin-right: 0 !important;
      margin-bottom: var(--nexus-message-gap) !important;
      word-break: break-word !important;
      overflow-wrap: break-word !important;
      `
          : ''
      }
    }`
        : ''
    }

    ${
      v.themeSelectors?.aiMessage
        ? `
    /* Custom AI Message Overwrite */
    ${v.themeSelectors.aiMessage} {
      ${doStruct ? `width: 100% !important; max-width: 100% !important; margin-left: 0 !important; margin-right: 0 !important; margin-bottom: var(--nexus-message-gap) !important; box-sizing: border-box !important;` : ''}
    }
    ${splitSelectorList(v.themeSelectors.aiMessage)
      .map((s) => `${s} div, ${s} p, ${s} article`)
      .join(', ')} {
      ${doStruct ? 'max-width: 100% !important;' : ''}
    }`
        : ''
    }

    ${
      v.themeSelectors?.markdownProse
        ? `
    /* Custom Markdown Prose Typography Overwrite */
    ${v.themeSelectors.markdownProse} {
      ${doColor ? 'color: var(--nexus-text) !important;' : ''}
      ${doStruct ? 'max-width: 100% !important;' : ''}
    }
    ${splitSelectorList(v.themeSelectors.markdownProse)
      .map((s: string) => `${s} p, ${s} li, ${s} span`)
      .join(', ')} {
      ${doColor ? 'color: inherit !important;' : ''}
    }
    ${splitSelectorList(v.themeSelectors.markdownProse)
      .map((s: string) => `${s} h1, ${s} h2, ${s} h3, ${s} h4`)
      .join(', ')} {
      ${doColor ? 'color: var(--nexus-text) !important;' : ''}
      font-weight: 700 !important;
    }
    ${splitSelectorList(v.themeSelectors.markdownProse)
      .map((s: string) => `${s} table, ${s} th, ${s} td`)
      .join(', ')} {
      ${doColor ? 'border-color: var(--nexus-border) !important;' : ''}
    }`
        : ''
    }

    ${
      v.themeSelectors?.thinkingBlock
        ? `
    /* Custom Thinking / Reasoning Block Overwrite */
    ${v.themeSelectors.thinkingBlock} {
      ${doBubble ? 'border-radius: var(--radius) !important; border: 1px solid var(--nexus-border) !important;' : ''}
      ${doColor ? 'background-color: var(--nexus-surface2) !important; color: var(--nexus-text2) !important;' : ''}
    }`
        : ''
    }

    ${
      v.themeSelectors?.codeBlock
        ? `
    /* Custom Code Block Overwrite */
    ${v.themeSelectors.codeBlock} {
      ${doBubble ? 'border-radius: var(--radius) !important; box-shadow: var(--nexus-code-shadow) !important; margin: var(--nexus-code-margin) !important; padding: 14px 18px !important; border: var(--nexus-code-border) !important;' : ''}
      ${doColor ? 'background: var(--nexus-code-bg) !important; color: var(--nexus-text) !important;' : ''}
      ${doStruct ? 'overflow-x: auto !important;' : ''}
    }
    ${splitSelectorList(v.themeSelectors.codeBlock)
      .map((s: string) => `${s} code`)
      .join(', ')} {
      ${doColor ? 'background: transparent !important; color: inherit !important;' : ''}
      font-size: inherit !important;
      padding: 0 !important;
      border: none !important;
    }`
        : ''
    }

    ${
      v.themeSelectors?.composer
        ? `
    /* Custom Composer Overwrite */
    ${v.themeSelectors.composer} {
      ${doColor ? 'background-color: var(--nexus-surface) !important; color: var(--nexus-text) !important;' : ''}
      ${doBubble ? 'border: 1px solid var(--nexus-border) !important; border-radius: var(--radius) !important; transition: box-shadow 0.3s ease, border-color 0.3s ease !important;' : ''}
      ${doStruct ? `width: 100% !important; max-width: var(--nexus-ai-width) !important; margin-left: auto !important; margin-right: auto !important; box-sizing: border-box !important;` : ''}
    }
    ${splitSelectorList(v.themeSelectors.composer)
      .map((s: string) => `form:focus-within ${s}`)
      .join(', ')},
    ${splitSelectorList(v.themeSelectors.composer)
      .map((s: string) => `${s}:focus`)
      .join(', ')} {
      ${doBubble ? 'border: var(--nexus-composer-focus-border) !important; border-bottom: var(--nexus-composer-focus-border-bottom) !important; box-shadow: var(--nexus-composer-focus-shadow) !important; outline: none !important;' : ''}
    }`
        : ''
    }

    ${
      v.themeSelectors?.sendButton
        ? `
    /* Custom Send Button Overwrite */
    ${v.themeSelectors.sendButton} {
      ${doColor ? 'background-color: var(--nexus-accent) !important; color: var(--nexus-bg) !important; border-color: transparent !important;' : ''}
      ${doBubble ? 'border-radius: var(--radius) !important; box-shadow: 0 0 12px var(--nexus-accent) !important;' : ''}
    }`
        : ''
    }

    ${
      v.themeSelectors?.actionButtons
        ? `
    /* Custom Action Buttons / Toolbar Overwrite */
    ${v.themeSelectors.actionButtons} {
      ${doColor ? 'color: var(--nexus-text2) !important;' : ''}
    }
    ${splitSelectorList(v.themeSelectors.actionButtons)
      .map((s: string) => `${s} button, ${s} svg`)
      .join(', ')} {
      ${doColor ? 'color: var(--nexus-text2) !important;' : ''}
    }
    ${splitSelectorList(v.themeSelectors.actionButtons)
      .map((s: string) => `${s} button:hover, ${s} svg:hover`)
      .join(', ')} {
      ${doColor ? 'color: var(--nexus-accent) !important;' : ''}
    }`
        : ''
    }
  `
}
// Keyed insertCSS management: exactly ONE theme stylesheet per view, always
// swapped (removeInsertedCSS then insertCSS), never stacked. Previously every
// resize/navigation/settings change appended a new giant stylesheet — that
// accumulation caused multi-GB memory + multi-minute freezes.
const viewCssState = new WeakMap<Electron.WebContents, { css: string; key: string }>()
const viewCssChains = new WeakMap<Electron.WebContents, Promise<void>>()
const focusCssKeys = new WeakMap<Electron.WebContents, string>()
// Per-tab accent & aura, keyed by tab id. Memory only on purpose: the renderer owns the durable
// copy (it serialises tabs to disk), main only needs to know how to paint the view that is open.
const viewTabColors = new Map<string, { accentColor?: string; auraColor?: string }>()

/** Hex only — these strings are concatenated into CSS that is injected into a live page. */
function sanitiseTabColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const raw = value.trim()
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw) ? raw : undefined
}

function tabIdForWebContents(wc: Electron.WebContents): string | undefined {
  for (const [id, view] of aiViews.entries()) {
    if (view.webContents === wc) return id
  }
  return undefined
}

/**
 * Provider overrides with this tab's own colours laid on top. A tab accent without a separate
 * aura colour drags the aura along with it — one colour is the common case, and a tab whose dot
 * is orange but whose glow is still indigo looks like a bug.
 */
function getOverridesForTab(
  modelKey: string | undefined,
  url: string | undefined,
  tabId: string | undefined
): ProviderOverrides | undefined {
  const baseOverrides = getOverridesForModel(modelKey, url)
  // A container's colour is the aura's default, so every tab in it is recognisable at a glance.
  // A tab's own aura colour still wins: someone who picked a colour for one chat meant it.
  const containerColor = tabId ? containerForTab(tabId)?.color : undefined
  const tabColors = tabId ? viewTabColors.get(tabId) : undefined
  if (!containerColor && (!tabColors || (!tabColors.accentColor && !tabColors.auraColor))) {
    return baseOverrides
  }
  const merged: ProviderOverrides = { ...(baseOverrides ?? {}) }
  if (containerColor) merged.ambientAuraColor = containerColor
  if (tabColors?.accentColor) {
    merged.accentColor = tabColors.accentColor
    if (!tabColors.auraColor) merged.ambientAuraColor = tabColors.accentColor
  }
  if (tabColors?.auraColor) merged.ambientAuraColor = tabColors.auraColor
  return merged
}

function getOverridesForModel(modelKey?: string, url?: string): ProviderOverrides | undefined {
  if (!providerConfig || typeof providerConfig !== 'object') return undefined
  if (modelKey) {
    if (providerConfig[modelKey]) return providerConfig[modelKey]
    const lower = modelKey.toLowerCase().trim()
    for (const [k, v] of Object.entries(providerConfig)) {
      if (k.toLowerCase().trim() === lower) return v
    }
  }
  // Fallback: match by URL domain
  if (url) {
    try {
      const host = new URL(url).host.toLowerCase()
      if (host.includes('gemini') || host.includes('aistudio')) {
        return getOverridesForModel('gemini')
      }
      if (host.includes('chatgpt') || host.includes('openai')) {
        return getOverridesForModel('chatgpt')
      }
      if (host.includes('claude') || host.includes('anthropic')) {
        return getOverridesForModel('claude')
      }
      if (host.includes('deepseek')) {
        return getOverridesForModel('deepseek')
      }
      if (host.includes('perplexity') || host.includes('pplx')) {
        return getOverridesForModel('perplexity')
      }
      if (host.includes('kimi') || host.includes('moonshot')) {
        return getOverridesForModel('kimi')
      }
      if (host.includes('qwen') || host.includes('aliyun')) {
        return getOverridesForModel('qwen')
      }
      if (host.includes('mistral')) {
        return getOverridesForModel('mistral')
      }
      if (host.includes('grok') || host.includes('x.ai')) {
        return getOverridesForModel('grok')
      }

      // Dynamic fallback: match against user-configured models from models.json
      try {
        const modelsRaw = fs.readFileSync(
          path.join(app.getPath('userData'), 'models.json'),
          'utf-8'
        )
        const models = JSON.parse(modelsRaw)
        if (Array.isArray(models)) {
          for (const m of models) {
            if (m.url && m.key) {
              try {
                const mHost = new URL(m.url).host.toLowerCase()
                if (host === mHost || host.endsWith('.' + mHost) || mHost.endsWith('.' + host)) {
                  return getOverridesForModel(m.key)
                }
              } catch {}
            }
          }
        }
      } catch {}
    } catch {}
  }
  return undefined
}

function resolveModelKey(
  tabId: string,
  url?: string,
  explicitModelKey?: string
): string | undefined {
  if (explicitModelKey) {
    if (tabId) viewModelKeys.set(tabId, explicitModelKey)
    return explicitModelKey
  }
  if (tabId && viewModelKeys.has(tabId)) {
    return viewModelKeys.get(tabId)
  }
  if (url) {
    try {
      const host = new URL(url).host.toLowerCase()
      let inferredKey: string | undefined
      if (host.includes('gemini') || host.includes('aistudio')) inferredKey = 'gemini'
      else if (host.includes('chatgpt') || host.includes('openai')) inferredKey = 'chatgpt'
      else if (host.includes('claude') || host.includes('anthropic')) inferredKey = 'claude'
      else if (host.includes('deepseek')) inferredKey = 'deepseek'
      else if (host.includes('perplexity') || host.includes('pplx')) inferredKey = 'perplexity'
      else if (host.includes('kimi') || host.includes('moonshot')) inferredKey = 'kimi'
      else if (host.includes('qwen') || host.includes('aliyun')) inferredKey = 'qwen'
      else if (host.includes('mistral')) inferredKey = 'mistral'
      else if (host.includes('grok') || host.includes('x.ai')) inferredKey = 'grok'
      else if (host.includes('z.ai') || host.includes('bigmodel')) inferredKey = 'glm'
      else if (host.includes('arena') || host.includes('lmarena')) inferredKey = 'arena'

      // Dynamic fallback: match against user-configured models from models.json
      if (!inferredKey) {
        try {
          const modelsRaw = fs.readFileSync(
            path.join(app.getPath('userData'), 'models.json'),
            'utf-8'
          )
          const models = JSON.parse(modelsRaw)
          if (Array.isArray(models)) {
            for (const m of models) {
              if (m.url && m.key) {
                try {
                  const mHost = new URL(m.url).host.toLowerCase()
                  if (host === mHost || host.endsWith('.' + mHost) || mHost.endsWith('.' + host)) {
                    inferredKey = m.key
                    break
                  }
                } catch {}
              }
            }
          }
        } catch {}
      }

      if (inferredKey && tabId) {
        viewModelKeys.set(tabId, inferredKey)
      }
      return inferredKey
    } catch {}
  }
  return undefined
}

function computeThemeCss(view, modelKey?: string): string {
  const theme = webviewTheme
  const url = view.webContents.getURL()
  const resolvedKey = modelKey || resolveModelKey('', url)
  const overrides = getOverridesForTab(resolvedKey, url, tabIdForWebContents(view.webContents))
  const on = overrides?.on === 'on' ? true : overrides?.on === 'off' ? false : (theme?.on ?? false)
  if (on && theme?.colors) {
    return buildWebviewThemeCss(theme, url, view.getBounds().width, overrides, resolvedKey)
  }
  return overrides?.customCss ? overrides.customCss : ''
}
function applyWebviewTheme(view, modelKey?: string) {
  const wc = view.webContents
  const url = wc.getURL()
  if (isThirdPartyAuthPage(url)) {
    // A sign-in page keeps its own appearance. Our stylesheet carries the drifting ambient aura and
    // the provider's colour overrides; over Google's account chooser that is a page that appears to
    // keep refreshing. Strip ours and leave the provider's page exactly as it shipped.
    const state = viewCssState.get(wc)
    if (state?.key) {
      viewCssState.delete(wc)
      void wc.removeInsertedCSS(state.key).catch(() => {})
      console.log('[theme] removed Nexus stylesheet on an auth page:', url)
    }
    // Google's own surface greys, so the first paint is not a dark rectangle flashing white.
    view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#202124' : '#ffffff')
    return
  }
  const resolvedKey = modelKey || resolveModelKey('', url)
  const overrides = getOverridesForTab(resolvedKey, url, tabIdForWebContents(wc))
  const css = computeThemeCss(view, resolvedKey)
  const bg = overrides?.surfaceBgColor || (webviewTheme?.on && webviewTheme.colors?.bg) || '#1a1a2e'
  view.setBackgroundColor(bg)
  // insertCSS on a page that has NOT committed a document (empty URL /
  // about:blank) HANGS FOREVER (observed: promise never settles), and because
  // applies are serialized on a per-view promise chain, one hung insertCSS
  // blocks every later apply — theme never lands. Skip only while there is no
  // committed URL; isLoading() is too aggressive (SPAs stay "loading" for
  // minutes via long-poll) and would suppress all applies.
  if (!wc.getURL() || wc.getURL() === 'about:blank' || wc.getURL() === 'about:srcdoc') return
  const prevChain = viewCssChains.get(wc) ?? Promise.resolve()
  const nextChain = prevChain.then(async () => {
    const decision = nextThemeSwap(viewCssState.get(wc) ?? null, css)
    if (!decision.swap) return
    if (decision.oldKey) {
      try {
        await wc.removeInsertedCSS(decision.oldKey)
      } catch {
        /* key already gone (page reloaded) */
      }
    }
    try {
      // insertCSS resolves only after the frame actually applies the stylesheet.
      // If the renderer is busy/throttled that can stall for many seconds — the
      // next apply would queue behind it. Time-box it so a stalled frame can
      // never wedge the chain; did-finish-load/resize re-applies anyway.
      const key = await Promise.race([
        wc.insertCSS(decision.css),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('insertCSS timeout')), 5000)
        )
      ])
      viewCssState.set(wc, { css: decision.css, key })
      for (const [id, v] of aiViews.entries()) {
        if (v.webContents === wc) {
          sendToMainWindow('ai-theme-applied', id)
          break
        }
      }
    } catch (e: any) {
      console.error('[theme] insertCSS failed:', String(e))
    }
  })
  viewCssChains.set(wc, nextChain)
}
ipcMain.handle(
  'set_titlebar_overlay_theme',
  (_event, colors: { color: string; symbolColor: string }) => {
    if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.setTitleBarOverlay({
          color: colors.color || '#11151e',
          symbolColor: colors.symbolColor || '#e9edf4',
          height: 36
        })
        return true
      } catch (err) {
        console.warn('[setTitleBarOverlay] failed:', err)
      }
    }
    return false
  }
)

ipcMain.handle('get_theme_appearance', () => activeAppearance)

ipcMain.handle('set_theme_appearance', (_event, mode: unknown) => {
  if (isValidThemeAppearance(mode)) {
    activeAppearance = mode
    nativeTheme.themeSource = mode
    persistAppearance()
    const effective = resolveEffectiveColorScheme(mode, nativeTheme.shouldUseDarkColors)
    for (const [tabId, view] of aiViews) {
      applyColorSchemeEmulation(view.webContents, effective)
      applyWebviewTheme(
        view,
        viewModelKeys.get(tabId) || resolveModelKey(tabId, view.webContents.getURL())
      )
    }
  }
  return activeAppearance
})

ipcMain.on('set_webview_theme', (_event, payload) => {
  webviewTheme = payload || null
  persistTheme()
  for (const [tabId, view] of aiViews) {
    applyWebviewTheme(view, resolveModelKey(tabId, view.webContents.getURL()))
  }
  if (previewViewId) capturePreviewFrame()
})

// Per-tab accent & aura. The renderer sends this whenever the active tab's colours change, and
// once more on every tab activation, because views are created and destroyed all day.
ipcMain.on('set_tab_colors', (_event, tabId: unknown, colors: unknown) => {
  if (typeof tabId !== 'string' || !tabId) return
  const record = (colors && typeof colors === 'object' ? colors : {}) as Record<string, unknown>
  const accentColor = sanitiseTabColor(record.accentColor)
  const auraColor = sanitiseTabColor(record.auraColor)
  if (!accentColor && !auraColor) viewTabColors.delete(tabId)
  else viewTabColors.set(tabId, { accentColor, auraColor })
  const view = aiViews.get(tabId)
  if (view && !view.webContents.isDestroyed()) {
    applyWebviewTheme(view, resolveModelKey(tabId, view.webContents.getURL()))
  }
})

ipcMain.handle('get_provider_config', () => providerConfig)

ipcMain.handle('get_full_provider_css', (_event, modelKey: string, providerUrl?: string) => {
  const theme = webviewTheme
  const keyToUse = !modelKey || modelKey === 'ALL' ? 'gemini' : modelKey
  const overrides = getOverridesForModel(keyToUse)
  const defaultUrls: Record<string, string> = {
    chatgpt: 'https://chatgpt.com',
    claude: 'https://claude.ai',
    gemini: 'https://gemini.google.com',
    perplexity: 'https://www.perplexity.ai',
    deepseek: 'https://chat.deepseek.com',
    kimi: 'https://kimi.moonshot.cn',
    qwen: 'https://chat.qwenlm.ai',
    mistral: 'https://chat.mistral.ai',
    grok: 'https://grok.com'
  }
  const sampleUrl =
    providerUrl || (keyToUse && defaultUrls[keyToUse.toLowerCase()]) || 'https://gemini.google.com'
  if (theme && theme.colors) {
    return buildWebviewThemeCss(theme, sampleUrl, 1200, overrides, keyToUse)
  }
  return overrides?.customCss || ''
})

ipcMain.handle('get_full_provider_js', (_event, modelKey?: string) => {
  const keyToUse = !modelKey || modelKey === 'ALL' ? undefined : modelKey
  return buildWebviewRuntimeJs(keyToUse)
})

ipcMain.handle('execute_live_provider_js', async (event, modelKey: string, code: string) => {
  if (!isValidMainWindowSender(event)) return { success: false, error: 'Unauthorized sender' }
  const targetKey = (modelKey || '').toLowerCase()
  let targetView: Electron.WebContentsView | null = null

  if (activeViewId && aiViews.has(activeViewId)) {
    const activeVKey = (viewModelKeys.get(activeViewId) || '').toLowerCase()
    if (!targetKey || activeVKey === targetKey) {
      targetView = aiViews.get(activeViewId)!
    }
  }

  if (!targetView) {
    for (const [tabId, view] of aiViews) {
      const vKey = (viewModelKeys.get(tabId) || '').toLowerCase()
      if (vKey === targetKey || (!targetKey && tabId === activeViewId)) {
        targetView = view
        break
      }
    }
  }

  if (!targetView && activeViewId && aiViews.has(activeViewId)) {
    targetView = aiViews.get(activeViewId)!
  }

  if (targetView && !targetView.webContents.isDestroyed()) {
    try {
      const res = await targetView.webContents.executeJavaScript(code)
      return {
        success: true,
        result: res !== undefined ? String(res) : 'Executed successfully (no return value)'
      }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  }
  return {
    success: false,
    error: `No active webview tab found for ${modelKey || 'provider'}. Please open a tab first.`
  }
})

ipcMain.handle('get_custom_theme_entry', (_event, modelKey: string) => {
  return getCustomThemeEntry(modelKey)
})

ipcMain.handle('get_provider_base_css', (_event, modelKey: string, providerUrl?: string) => {
  const theme = webviewTheme
  if (!theme || !theme.colors) return ''

  const defaultUrls: Record<string, string> = {
    chatgpt: 'https://chatgpt.com',
    claude: 'https://claude.ai',
    gemini: 'https://gemini.google.com',
    perplexity: 'https://www.perplexity.ai',
    deepseek: 'https://chat.deepseek.com',
    kimi: 'https://kimi.moonshot.cn',
    qwen: 'https://chat.qwenlm.ai',
    mistral: 'https://chat.mistral.ai',
    grok: 'https://grok.com'
  }
  const sampleUrl = providerUrl || (modelKey && defaultUrls[modelKey.toLowerCase()]) || ''

  // Create generic empty overrides so we get raw base CSS
  const rawOverrides = {}

  let host = ''
  try {
    host = sampleUrl ? new URL(sampleUrl).host : ''
  } catch {}

  const provider = PROVIDER_THEMES.find((p) =>
    p.hosts.some((h) => host === h || host.endsWith('.' + h))
  )

  const vars = {
    bg: theme.colors.bg || '#1a1a2e',
    surface: theme.colors.surface || '#16213e',
    surface2: theme.colors.surface2 || '#0f3460',
    accent: theme.colors.accent || '#e94560',
    text: theme.colors.text || '#eaeaea',
    text2: theme.colors.text2 || '#8899aa',
    border: theme.colors.border || '#2a2a2e',
    radius: theme.radius ?? 8,
    borderWidth: 1,
    ambientAura: (theme as any).ambientAura,
    ambientAuraMode: (theme as any).ambientAuraMode,
    ambientAuraIntensity: (theme as any).ambientAuraIntensity,
    ambientAuraColor: (theme as any).ambientAuraColor,
    ambientAuraLive: (theme as any).ambientAuraLive,
    bubbleStyle: (theme as any).bubbleStyle,
    bubbleGradientDepth: (theme as any).bubbleGradientDepth,
    codeBlockStyle: (theme as any).codeBlockStyle,
    codeBlockMargin: (theme as any).codeBlockMargin,
    composerGlow: (theme as any).composerGlow,
    composerHaloIntensity: (theme as any).composerHaloIntensity,
    messageGap: (theme as any).messageGap,
    aiResponseWidthPx: (theme as any).aiResponseWidthPx,
    userPromptWidthPx: (theme as any).userPromptWidthPx
  }

  const merged = mergeOverrides(vars, rawOverrides)
  const dark = isDarkColor(merged.bg)
  return provider ? provider.css(merged) : genericFallbackCss(merged, dark)
})

ipcMain.handle('save_custom_theme_file', (_event, modelKey: string, css: string, url?: string) => {
  const success = saveCustomThemeEntry(modelKey, css, url)
  if (success) {
    // Re-apply theme for all matching active tabs
    for (const [tabId, view] of aiViews) {
      if (resolveModelKey(tabId, view.webContents.getURL()) === modelKey) {
        applyWebviewTheme(view, modelKey)
      }
    }
  }
  return success
})

ipcMain.handle('reset_custom_theme_file', (_event, modelKey: string) => {
  const success = removeCustomThemeEntry(modelKey)
  if (success) {
    for (const [tabId, view] of aiViews) {
      if (resolveModelKey(tabId, view.webContents.getURL()) === modelKey) {
        applyWebviewTheme(view, modelKey)
      }
    }
  }
  return success
})

// Only the trusted settings renderer may request read-only evidence or selector validation.
for (const channel of ['capture_feature_hook_evidence', 'validate_feature_hook_selectors']) {
  ipcMain.handle(
    channel,
    async (
      event,
      modelKey: string,
      providerUrl?: string,
      proposed?: unknown,
      expectedContext?: string
    ) => {
      try {
        if (
          !mainWindow ||
          event.sender !== mainWindow.webContents ||
          event.senderFrame !== event.sender.mainFrame
        ) {
          return { success: false, reason: 'untrusted_sender' }
        }
        if (typeof modelKey !== 'string' || typeof providerUrl !== 'string')
          return { success: false, reason: 'invalid_request' }
        if (!activeViewId) return { success: false, reason: 'no_active_tab' }
        const view = aiViews.get(activeViewId)
        if (!view || view.webContents.isDestroyed())
          return { success: false, reason: 'no_active_tab' }
        const contents = view.webContents
        const actualUrl = contents.getURL(),
          actual = new URL(actualUrl),
          requested = new URL(providerUrl)
        if (!/^https?:$/.test(actual.protocol) || !/^https?:$/.test(requested.protocol))
          return { success: false, reason: 'unsupported_url' }
        // A stale provider key must not authorize an unrelated navigated hostname.
        // Explicit provider redirect aliases can be added separately after verification.
        if (actual.hostname.toLowerCase() !== requested.hostname.toLowerCase())
          return { success: false, reason: 'active_provider_mismatch' }
        const id = activeViewId,
          contextId = hookContextId(contents)
        if (expectedContext && expectedContext !== contextId)
          return { success: false, reason: 'context_changed_revalidate' }
        const features =
          channel === 'validate_feature_hook_selectors'
            ? parseFeatureHookImport(JSON.stringify(proposed)).selectors
            : getMergedProviderFeatures(modelKey, providerConfig[modelKey])
        const evidence = (await executeHookCapture(
          contents,
          buildFeatureHookEvidenceScript(features as Record<string, unknown>)
        )) as ReturnType<typeof collectFeatureHookEvidence>
        if (
          contents.isDestroyed() ||
          activeViewId !== id ||
          contents.getURL() !== actualUrl ||
          hookContextId(contents) !== contextId
        ) {
          return { success: false, reason: 'tab_changed_during_capture' }
        }
        if (
          !evidence ||
          evidence.version !== 2 ||
          evidence.origin !== actual.origin ||
          !evidence.validations ||
          JSON.stringify(evidence).length > 64000
        ) {
          return { success: false, reason: 'invalid_evidence' }
        }
        return { success: true, evidence, contextId }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'capture_failed'
        console.warn('Feature hook request failed:', reason.slice(0, 180))
        return { success: false, reason: reason.slice(0, 180) }
      }
    }
  )
}

ipcMain.handle(
  'extract_provider_live_dom',
  async (_event, modelKey: string, providerUrl?: string) => {
    try {
      let targetView: Electron.WebContentsView | null = null

      // 1. Prefer active view if it matches the requested modelKey
      if (
        activeViewId &&
        aiViews.has(activeViewId) &&
        viewModelKeys.get(activeViewId) === modelKey
      ) {
        targetView = aiViews.get(activeViewId)!
      }

      // 2. Match by model key in other active views
      if (!targetView) {
        for (const [tabId, view] of aiViews) {
          if (viewModelKeys.get(tabId) === modelKey) {
            targetView = view
            break
          }
        }
      }

      // 3. Match by URL host if not matched by key (check active view first)
      if (!targetView && providerUrl) {
        try {
          const targetHost = new URL(providerUrl).host.toLowerCase()
          if (activeViewId && aiViews.has(activeViewId)) {
            const active = aiViews.get(activeViewId)!
            const vUrl = active.webContents.getURL()
            if (vUrl && new URL(vUrl).host.toLowerCase() === targetHost) {
              targetView = active
            }
          }
          if (!targetView) {
            for (const [, view] of aiViews) {
              const vUrl = view.webContents.getURL()
              if (vUrl && new URL(vUrl).host.toLowerCase() === targetHost) {
                targetView = view
                break
              }
            }
          }
        } catch {}
      }

      // 4. Fallback to active view if model matches or no target found
      if (!targetView && activeViewId && aiViews.has(activeViewId)) {
        const active = aiViews.get(activeViewId)!
        if (viewModelKeys.get(activeViewId) === modelKey) {
          targetView = active
        }
      }

      if (!targetView || targetView.webContents.isDestroyed()) {
        return { success: false, reason: 'no_open_tab' }
      }

      const script = `(() => {
      try {
        const root = document.body;
        if (!root) return { success: false, reason: 'no_root' };

        const clone = root.cloneNode(true);
        const toRemove = clone.querySelectorAll('script, style, link, noscript, iframe, canvas, meta, base, svg, img, video, audio');
        toRemove.forEach(el => el.remove());

        // Remove hidden/fixed overlays that pollute the DOM and waste tokens
        const overlays = clone.querySelectorAll('[class*="fixed"], [class*="z-10000"], [id^="bits-"]');
        overlays.forEach(el => el.remove());

        const shouldKeepAttr = (n) => {
          return n === 'id' || n === 'class' || n.startsWith('data-') || n === 'role' || n === 'placeholder' || n === 'type' || n === 'contenteditable' || n === 'aria-label' || n === 'accept' || n === 'name' || n === 'title';
        };

        // Strip non-essential attributes from the root clone itself
        const rootAttrs = Array.from(clone.attributes || []);
        for (const attr of rootAttrs) {
          const name = attr.name.toLowerCase();
          if (!shouldKeepAttr(name)) {
            clone.removeAttribute(attr.name);
          }
        }

        const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
        const nodesToRemove = [];
        let node;
        while ((node = walker.nextNode())) {
          if (node.nodeType === 1) { // ELEMENT_NODE
            const el = node;
            const attrs = Array.from(el.attributes);
            for (const attr of attrs) {
              const name = attr.name.toLowerCase();
              if (!shouldKeepAttr(name)) {
                el.removeAttribute(attr.name);
              }
            }
          } else if (node.nodeType === 3) { // TEXT_NODE
            if (node.nodeValue && node.nodeValue.trim().length > 0) {
              node.nodeValue = '[TEXT]';
            }
          } else if (node.nodeType === 8) { // COMMENT_NODE
            nodesToRemove.push(node);
          }
        }

        nodesToRemove.forEach(c => c.remove());

        // Remove empty divs repeatedly to collapse the tree
        let previousLength = -1;
        while (previousLength !== clone.innerHTML.length) {
          previousLength = clone.innerHTML.length;
          const emptyEls = clone.querySelectorAll('div:empty, span:empty, p:empty, a:empty, button:empty');
          emptyEls.forEach(el => el.remove());
        }

        let html = clone.outerHTML || '';

        // Final aggressive cleanup of empty class/id attributes to save tokens
        html = html.replace(/ class=""/g, '').replace(/ id=""/g, '');

        return {
          success: true,
          html,
          url: location.href,
          title: document.title
        };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    })();`

      const result = await targetView.webContents.executeJavaScript(script)
      return result || { success: false, reason: 'script_failed' }
    } catch (err) {
      console.error('extract_provider_live_dom error:', err)
      return { success: false, error: String(err) }
    }
  }
)

ipcMain.on('set_provider_config', (_event, map) => {
  if (!map || typeof map !== 'object' || Object.keys(map).length === 0) {
    if (Object.keys(providerConfig).length > 0) {
      console.warn('[ProviderConfig] Rejected empty set_provider_config payload.')
      return
    }
  }
  providerConfig = map && typeof map === 'object' ? map : {}
  persistProviderConfig()
  for (const [tabId, view] of aiViews) {
    const modelKey = resolveModelKey(tabId, view.webContents.getURL()) || ''
    applyWebviewTheme(view, modelKey)
    updateWebviewTitlePoller(view, modelKey)
    injectVirtualizationCss(view, modelKey)
    applyProviderMotionMode(view, modelKey)
    injectAiStatusObserver(view, modelKey, providerConfig)
  }
  if (previewViewId) capturePreviewFrame()
  restartActiveArenaTitleSync()
})

// Title recovery for the active Arena view. Unlike provider-page intervals this
// timer is owned by main, so a stale/clamped page timer cannot permanently block
// title sync. It never modifies document.title or reloads/discards the page.
const arenaTitleSync = new ActiveTitleSync()
function restartActiveArenaTitleSync(): void {
  arenaTitleSync.stop()
  const tabId = activeViewId
  if (
    !tabId ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !mainWindow.isVisible() ||
    mainWindow.isMinimized() ||
    !activeViewVisible ||
    overlaysOpen
  )
    return
  const view = aiViews.get(tabId)
  const modelKey = viewModelKeys.get(tabId) || ''
  if (!view || !['arena', 'arena-ai'].includes(modelKey.toLowerCase())) return
  const globalOv = providerConfig['ALL'] || providerConfig['global'] || {}
  const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey], globalOv)
  const selector = feats.chatTitleSelector
  const requested = feats.chatTitlePollingIntervalMs
  const interval =
    requested === 0
      ? 0
      : typeof requested === 'number' && Number.isFinite(requested)
        ? Math.max(500, Math.min(60000, requested))
        : 1500
  if (!selector || !interval) return
  const wc = view.webContents
  if (!wc || wc.isDestroyed()) return
  const script = buildActiveTitleReadScript(selector)
  const canRun = () =>
    Boolean(
      mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.isVisible() &&
      !mainWindow.isMinimized() &&
      activeViewId === tabId &&
      activeViewVisible &&
      !overlaysOpen &&
      aiViews.get(tabId) === view &&
      !wc.isDestroyed()
    )
  arenaTitleSync.start({
    contents: wc,
    intervalMs: interval,
    canRun,
    read: async () => {
      const beforeUrl = wc.getURL()
      if (!beforeUrl) return null
      const title = await wc.executeJavaScript(script)
      if (wc.isDestroyed() || wc.getURL() !== beforeUrl || typeof title !== 'string') return null
      const rawClean = title.trim()
      const clean =
        (typeof cleanConversationTitle === 'function'
          ? cleanConversationTitle(rawClean, modelKey)
          : rawClean) || rawClean
      return clean && !shouldIgnoreProviderTitle(rawClean, feats.defaultChatTitles || [], modelKey)
        ? clean
        : null
    },
    publish: (title) => {
      viewTitles.set(tabId, title)
      sendToMainWindow('ai-title-updated', tabId, title)
    }
  })
}

// Switch tabs: show target view, hide the rest. Loads URL only on first visit.
let activationRevision = 0
const wakeTokens = new Map<string, number>()
interface ActiveWakeOperation {
  token: number
  targetUrl: string
}
const activeWakeOperations = new Map<string, ActiveWakeOperation>()

ipcMain.on('activate_tab', async (_event, tabId, url, bounds, modelKey, containerId) => {
  const revision = ++activationRevision
  // Recorded before the view is ensured: the partition is fixed at creation, and a container tab
  // must never be born on another container's cookie store.
  rememberTabContainer(tabId, containerId)
  await tabDiscardManager.waitForClose(tabId)
  if (revision !== activationRevision) return
  if (currentUiZoom !== 1.0 && bounds) {
    bounds = {
      x: Math.round(bounds.x * currentUiZoom),
      y: Math.round(bounds.y * currentUiZoom),
      width: Math.round(bounds.width * currentUiZoom),
      height: Math.round(bounds.height * currentUiZoom)
    }
  }

  // 1. Ensure view exists safely; if creation fails, leave evicted state intact so user can retry
  let view: Electron.WebContentsView
  try {
    view = ensureAiView(tabId, containerId)
  } catch (err) {
    console.error(`[activate_tab] Failed to create or ensure view for ${tabId}:`, err)
    return
  }

  console.log('[activate_tab]', tabId, 'url=', url, 'current=', view.webContents?.getURL?.())
  traceNav(tabId, 'request', 'activate_tab', {
    url: url || '(none)',
    current: (() => {
      try {
        return view.webContents?.getURL?.() || '(empty)'
      } catch {
        return '(gone)'
      }
    })(),
    loading: (() => {
      try {
        return view.webContents?.isLoading?.() ?? null
      } catch {
        return null
      }
    })(),
    overlaysOpen
  })
  resolveModelKey(tabId, url, modelKey)

  try {
    tabDiscardManager.activateTab(tabId)
  } catch (err) {
    console.warn(`[activate_tab] tabDiscardManager.activateTab warning for ${tabId}:`, err)
  }

  // 2. Safe theme application and title polling — failures here MUST NOT abort visibility or leave view hidden
  try {
    applyWebviewTheme(view, viewModelKeys.get(tabId))
  } catch (err) {
    console.warn(`[activate_tab] applyWebviewTheme error for ${tabId}:`, err)
  }

  try {
    updateWebviewTitlePoller(view, viewModelKeys.get(tabId) || '')
  } catch (err) {
    console.warn(`[activate_tab] updateWebviewTitlePoller error for ${tabId}:`, err)
  }


  // 3. Set visibility and bounds: hide background views safely, then ALWAYS set bounds/visibility for selected view
  const isHidden = Boolean(bounds && bounds.width === 0 && bounds.height === 0)
  for (const [id, v] of aiViews) {
    if (id !== tabId) {
      try {
        if (!v.webContents?.isDestroyed?.()) {
          traceViewOp(id, 'setVisible (activate_tab, background)', { visible: false })
          markViewVisibility(id, false)
          v.setVisible(false)
          v.webContents.setBackgroundThrottling(true)
          v.webContents.setAudioMuted(true)
        }
      } catch (err) {
        console.warn(`[activate_tab] Failed to set background view visibility for ${id}:`, err)
      }
    }
  }

  activeViewId = tabId
  const currentLifecycle = activeAiLifecycles.get(tabId)
  const currentGen = tabViewGenerations.get(tabId) ?? 1
  if (
    currentLifecycle?.status === 'done' &&
    currentLifecycle.isBackgroundCompletion &&
    currentLifecycle.viewGeneration === currentGen
  ) {
    currentLifecycle.isBackgroundCompletion = false
    const existingTimer = aiLifecycleTimers.get(tabId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      aiLifecycleTimers.delete(tabId)
    }
    const rev = currentLifecycle.revision
    const timer = setTimeout(() => {
      const cur = activeAiLifecycles.get(tabId)
      const latestGen = tabViewGenerations.get(tabId) ?? 1
      if (
        cur &&
        cur.revision === rev &&
        cur.viewGeneration === currentGen &&
        latestGen === currentGen &&
        cur.status === 'done'
      ) {
        setTabAiLifecycle(tabId, 'idle', { viewGeneration: currentGen })
      }
    }, VISITED_DONE_LINGER_MS)
    aiLifecycleTimers.set(tabId, timer)
  }
  // The toast about this tab used to be dismissed the moment the tab was activated. Two things were
  // wrong with that: it also fired for the *other* tabs (which is why notifications vanished on any tab
  // switch), and a notification the user never got to read is not improved by hiding it. The toast now
  // lives out its timer and can be clicked or closed; the lifecycle status is what says "seen".
  activeViewVisible = !isHidden
  try {
    if (bounds) {
      view.setBounds(bounds)
      if (!isHidden) lastRealBounds.set(tabId, bounds)
    }
    const shouldBeVisible = !isHidden && !overlaysOpen
    // Asked *before* the view is shown: afterwards this always answers "not hidden", which is exactly
    // how the strong repaint used to be skipped for a tab coming back from the background.
    const returningFromHidden = shouldBeVisible && viewWasHidden(tabId, view)
    if (typeof view?.setVisible === 'function') {
      traceViewOp(tabId, 'setVisible (activate_tab, active)', { visible: shouldBeVisible })
      view.setVisible(shouldBeVisible)
      markViewVisibility(tabId, shouldBeVisible)
      if (returningFromHidden) shownFromHidden.add(tabId)
    }
    if (view?.webContents && !view.webContents.isDestroyed?.()) {
      view.webContents.setBackgroundThrottling?.(!shouldBeVisible)
      view.webContents.setAudioMuted?.(!shouldBeVisible)
    }
  } catch (err) {
    console.error(`[activate_tab] Failed to set active view bounds/visibility for ${tabId}:`, err)
  }

  restartActiveArenaTitleSync()
  reconcileViewPresentation()

  // 4. Handle Wake / Restoration vs Initial Load
  const wasEvicted = tabDiscardManager.isTabEvicted(tabId)
  const savedState = tabDiscardManager.getEvictedTabState(tabId)
  const currentUrl = view.webContents?.getURL?.() || ''

  // A URL the user asked for outranks the URL an activation carries.
  //
  // An activation carries the tab's *stored* URL, and on a restored (evicted) tab the wake path below
  // loads the URL saved with the discarded tab. If the user navigated from the address bar a moment
  // earlier, that wake would load the old page over the new one: the user's navigation is aborted and
  // the tab looks like it ignored it — "it only works on new tabs, not on the ones I had before I
  // restarted". While a user navigation is in flight for this tab, the activation defers to it.
  const userNavigation = navigationIntent.pendingUrl(tabId)
  if (userNavigation) {
    console.log(
      `[activate_tab] ${tabId} deferring to the navigation the user asked for: ${userNavigation}`
    )
  }

  // Determine restore target URL: use valid saved URL, falling back to tab's supplied URL
  let targetRestoreUrl: string | null = null
  if (wasEvicted && savedState) {
    if (isUsableRestoreUrl(savedState.url)) {
      targetRestoreUrl = savedState.url
    } else if (isUsableRestoreUrl(url)) {
      targetRestoreUrl = url
    }
  }
  // The user's own request wins over the tab's restore state.
  if (userNavigation) targetRestoreUrl = userNavigation

  if (wasEvicted && targetRestoreUrl) {
    const existingWake = activeWakeOperations.get(tabId)
    if (existingWake && existingWake.targetUrl === targetRestoreUrl) {
      // If a wake is already actively loading this exact target URL, reuse it to avoid duplicate loadURL calls
      console.log('[activate_tab] Reusing in-flight wake for:', tabId, 'token=', existingWake.token)
    } else {
      const myWakeToken = (wakeTokens.get(tabId) || 0) + 1
      wakeTokens.set(tabId, myWakeToken)
      activeWakeOperations.set(tabId, {
        token: myWakeToken,
        targetUrl: targetRestoreUrl
      })
      console.log(
        '[activate_tab] RESTORING evicted tab:',
        tabId,
        targetRestoreUrl,
        'token=',
        myWakeToken
      )

      void (async () => {
        try {
          traceNav(tabId, 'load', 'loadURL (wake / restore)', { url: targetRestoreUrl, evicted: wasEvicted })
          await view.webContents.loadURL(targetRestoreUrl!)

          // Verify this wake is still the current navigation attempt and view wasn't destroyed
          if (
            wakeTokens.get(tabId) !== myWakeToken ||
            !view.webContents ||
            view.webContents.isDestroyed()
          ) {
            return
          }

          // Restore scroll only for this matching successful load
          if (savedState && typeof savedState.scrollY === 'number' && savedState.scrollY > 0) {
            await view.webContents
              .executeJavaScript(`window.scrollTo(0, ${savedState.scrollY})`)
              .catch(() => {})
          }

          // Re-verify token after asynchronous executeJavaScript before consuming state
          if (
            wakeTokens.get(tabId) !== myWakeToken ||
            !view.webContents ||
            view.webContents.isDestroyed()
          ) {
            return
          }

          // Consume evicted tab state only after restoration succeeded
          tabDiscardManager.consumeEvictedTabState(tabId)

          // Only focus if tab is still active and visible
          if (
            mainWindow &&
            !mainWindow.isDestroyed() &&
            !view.webContents.isDestroyed() &&
            activeViewId === tabId &&
            activeViewVisible &&
            !overlaysOpen
          ) {
            view.webContents.focus()
            focusPromptInView(view)
          }
        } catch (err) {
          console.warn(`[activate_tab] Failed to restore evicted tab ${tabId}:`, err)
          // Do NOT consume evicted tab state on error so user can retry
        } finally {
          if (activeWakeOperations.get(tabId)?.token === myWakeToken) {
            activeWakeOperations.delete(tabId)
          }
        }
      })()
    }
  } else if (userNavigation && !currentUrl) {
    // The view is empty and the user has already asked for a page: that page is the one to load. Doing
    // nothing here would leave an empty view until the app is reopened.
    const existingWake = activeWakeOperations.get(tabId)
    if (existingWake && existingWake.targetUrl === userNavigation) {
      console.log('[activate_tab] In-flight load already in progress for empty view:', tabId)
    } else if (!view.webContents.isLoading()) {
      console.log('[activate_tab] LOADING the page the user asked for:', userNavigation)
      const myWakeToken = (wakeTokens.get(tabId) || 0) + 1
      wakeTokens.set(tabId, myWakeToken)
      activeWakeOperations.set(tabId, { token: myWakeToken, targetUrl: userNavigation })
      void view.webContents
        .loadURL(userNavigation)
        .catch((err) => {
          if (err?.code === 'ERR_ABORTED' || err?.errno === -3) return
          console.warn(`[activate_tab] Failed to load the user's page for ${tabId}:`, err)
        })
        .finally(() => {
          if (activeWakeOperations.get(tabId)?.token === myWakeToken) {
            activeWakeOperations.delete(tabId)
          }
        })
    }
  } else if (url && !currentUrl && isUsableRestoreUrl(url) && !userNavigation) {
    const existingWake = activeWakeOperations.get(tabId)
    if (existingWake && existingWake.targetUrl === url) {
      console.log('[activate_tab] In-flight load already in progress for empty view:', tabId)
    } else if (view.webContents.isLoading()) {
      console.log('[activate_tab] View is already loading, skipping duplicate loadURL:', tabId)
    } else {
      console.log('[activate_tab] LOADING empty view:', url)
      traceNav(tabId, 'load', 'loadURL (empty view)', { url })
      const myWakeToken = (wakeTokens.get(tabId) || 0) + 1
      wakeTokens.set(tabId, myWakeToken)
      activeWakeOperations.set(tabId, {
        token: myWakeToken,
        targetUrl: url
      })
      void view.webContents
        .loadURL(url)
        .catch((err) => {
          if (err?.code === 'ERR_ABORTED' || err?.errno === -3) return
          console.warn(`[activate_tab] Failed to load empty view for ${tabId}:`, err)
        })
        .finally(() => {
          if (activeWakeOperations.get(tabId)?.token === myWakeToken) {
            activeWakeOperations.delete(tabId)
          }
        })
    }
  }

  // Immediate focus for tabs that are already resident/loaded
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    view.webContents &&
    !view.webContents.isDestroyed() &&
    activeViewVisible &&
    !overlaysOpen
  ) {
    view.webContents.focus()
    focusPromptInView(view)
  }
})

// "This tab has gone blank" without closing it. Same repairs the reconcile path runs, on demand.
ipcMain.handle('repair_view', (_event, tabId?: string) => {
  const target = tabId || activeViewId
  if (!target) return { repaired: false, reason: 'no active tab' }
  const view = aiViews.get(target)
  if (!view || view.webContents.isDestroyed()) return { repaired: false, reason: 'no view' }
  repairTabSurface(target, 'requested from the app', activeViewId === target && activeViewVisible)
  return { repaired: true }
})

/**
 * Which request for a tab is the current one.
 *
 * The retry below has to answer "did something newer replace this load, or did we abort it ourselves?".
 * It used to ask the navigation-intent tracker, and that was the bug: every `did-fail-load` for the tab
 * cleared the tracker — including the `ERR_ABORTED` that *is* the abort being judged — so the retry
 * concluded "superseded" and gave up while the request was still exactly what the user wanted. This
 * counter cannot be cleared by an event: only a newer `navigate_tab` moves it.
 */
const navRequestSeq = new Map<string, number>()
/**
 * Attempts per navigation request, and the pause between them.
 *
 * Four attempts rather than three, and — much more importantly — each one waits for the tab to go quiet
 * first (see `settle()` in the handler). Retrying on a fixed 150 ms timer was retrying into the middle
 * of Chromium restoring the previous page, which aborted the new load again, every time.
 */
const NAV_LOAD_ATTEMPTS = 4
/**
 * One last ask, four seconds after the attempts are spent.
 *
 * A page that reloads itself takes a moment to settle, and every attempt so far has been inside that
 * window (see the build-28 trace: four attempts, all aborted within 300 ms, then the old page committed
 * and stopped loading). Rather than leave the tab showing a page the user did not ask for, the request
 * gets one unhurried retry once the noise has died down.
 */
const NAV_LAST_RESORT_DELAY_MS = 4000
const NAV_SETTLE_TIMEOUT_MS = 2500
/** How long a navigation waits for the address-bar overlay to close before loading anyway. */
const OVERLAY_CLOSE_TIMEOUT_MS = 1200
const NAV_RETRY_DELAY_MS = [120, 250, 500]
/** How long to let an aborted load unwind before the tab is rebuilt around a new page. */
const NAV_REBUILD_DELAY_MS = 250

/**
 * Give the tab a different *page*, not just a different URL.
 *
 * The build-31 trace ends the way every previous one did: four loads, four `did-start-navigation` lines
 * naming the page we were leaving five milliseconds later, four `ERR_ABORTED (-3)`, a `history.clear()`
 * and a last `loadURL` on the *same* webContents — which the old document aborted as well. The one thing
 * none of those attempts changed was the document doing the aborting. Every retry, every defence and
 * every history wipe still ran inside the renderer process that had already proved it would not let go.
 *
 * So the last resort is no longer another request to the same contents. The contents is closed (a real
 * unload, with `waitForBeforeUnload: false` — the same teardown the discard manager uses) and the tab is
 * rebuilt through `ensureAiView`, which installs a fresh renderer with the same container partition (the
 * cookies that matter are in the partition, not in the document) and re-wires every listener: trace tap,
 * navigation defence, `will-navigate` guard, status observer. Then the user's URL is loaded there.
 *
 * A page cannot abort a navigation in a process that no longer exists. That is not a theory about what
 * deepseek does — it is a statement about what is left running.
 */
async function rebuildTabView(
  tabId: string,
  reason: string
): Promise<Electron.WebContentsView | null> {
  const old = aiViews.get(tabId)
  let leaving = ''
  let oldWc = 0
  try {
    leaving = old?.webContents?.getURL() || ''
    oldWc = old?.webContents?.id ?? 0
  } catch {
    leaving = ''
  }
  traceNav(tabId, 'load', 'rebuilding the tab — the old page would not let go', {
    reason,
    leaving,
    wc: oldWc
  })

  // Same order the discard teardown uses: stop the repair machinery first, so nothing re-attaches the
  // view while it is being closed, then detach, then close the contents.
  surfaceRepair.forget(tabId)
  const pendingRepair = repairDeferrals.get(tabId)
  if (pendingRepair) {
    clearTimeout(pendingRepair)
    repairDeferrals.delete(tabId)
  }
  aiViews.delete(tabId)
  presentedVisible.delete(tabId)
  if (mainWindow && !mainWindow.isDestroyed() && old) {
    try {
      mainWindow.contentView.removeChildView(old)
    } catch {
      /* already detached */
    }
  }
  if (old) {
    try {
      await closeWebContents(old.webContents as unknown as Parameters<typeof closeWebContents>[0])
      traceNav(tabId, 'note', 'the old page is gone', { wc: oldWc })
    } catch (err) {
      // A close that timed out has still been requested; the rebuild continues either way.
      traceNav(tabId, 'note', 'the old page did not confirm the close', { error: describeLoadError(err) })
    }
  }

  const container = tabContainers.get(tabId)
  let fresh: Electron.WebContentsView | null = null
  try {
    fresh = ensureAiView(tabId, container ?? undefined)
  } catch (err) {
    // `registerView` refuses to replace a live view, so a close that timed out lands here rather than
    // half-way through a rebuild: the request then gives up honestly instead of breaking the loop.
    traceNav(tabId, 'abort', 'the rebuild could not register a new view', {
      error: describeLoadError(err)
    })
    return null
  }
  if (!fresh || fresh.webContents.isDestroyed()) {
    traceNav(tabId, 'abort', 'the rebuild produced no usable view', {})
    return null
  }
  const bounds = lastRealBounds.get(tabId)
  if (bounds) {
    try {
      fresh.setBounds(bounds)
    } catch {
      /* bounds are re-sent by the renderer on the next resize */
    }
  }
  try {
    const shouldShow = activeViewId === tabId && activeViewVisible && !overlaysOpen
    fresh.setVisible(shouldShow)
  } catch {
    /* visibility is reconciled by the next reveal */
  }
  traceNav(tabId, 'note', 'fresh page ready — loading the request in it', {
    wc: fresh.webContents.id,
    url: leaving
  })
  return fresh
}

ipcMain.on('navigate_tab', async (_event, tabId: string, url: string, modelKey?: string, containerId?: string) => {
  rememberTabContainer(tabId, containerId)
  await tabDiscardManager.waitForClose(tabId)
  wakeTokens.set(tabId, (wakeTokens.get(tabId) || 0) + 1)
  activeWakeOperations.delete(tabId)
  tabDiscardManager.onExplicitNavigation(tabId)
  let view = ensureAiView(tabId, containerId)
  // `let`, because the last resort (see `rebuildTabView`) can put a different renderer behind this
  // tab mid-request, and every helper below must then look at the new one.
  resolveModelKey(tabId, url, modelKey)
  applyWebviewTheme(view, viewModelKeys.get(tabId))

  const token = (navRequestSeq.get(tabId) ?? 0) + 1
  navRequestSeq.set(tabId, token)
  traceNav(tabId, 'request', 'navigate_tab', {
    url,
    model: viewModelKeys.get(tabId),
    token,
    current: (() => {
      try {
        return view.webContents.getURL() || '(empty)'
      } catch {
        return '(gone)'
      }
    })()
  })

  // The user's request, recorded where no event can clear it, plus the page we are leaving.
  navWanted.set(tabId, { url, token, at: Date.now() })
  try {
    const leaving = view.webContents.getURL()
    if (leaving) navLeaveFrom.set(tabId, leaving)
  } catch {
    /* ignore */
  }
  navDefences.delete(tabId)

  // A tab that has already been caught re-navigating itself gets its history cleared *before* the load,
  // while nothing is in flight. That is the difference between undoing a bounce and preventing one: with
  // no previous entry, `history.back()` from the page cannot resurrect the old URL.
  if (navBouncedTabs.has(tabId)) {
    try {
      let leaving = ''
      try {
        leaving = view.webContents.getURL() || ''
      } catch {
        leaving = ''
      }
      const history = view.webContents.navigationHistory as unknown as { clear?: () => void } | undefined
      if (leaving && !sameSiteUrl(leaving, url) && history && typeof history.clear === 'function') {
        history.clear()
        traceNav(tabId, 'prog', 'history cleared before the load — this tab re-navigates itself', {
          from: leaving,
          wc: view.webContents.id
        })
      }
    } catch (err) {
      traceNav(tabId, 'note', 'history clear skipped', { error: describeLoadError(err) })
    }
  }

  if (!navigationIntent.claim(tabId, url)) {
    traceNav(tabId, 'request', 'duplicate request ignored', { url })
    console.log(`[navigate_tab] ${tabId} is already loading ${url} — duplicate request ignored`)
    return
  }
  console.log('[navigate_tab]', tabId, 'url=', url)

  const isStillWanted = (): boolean => navRequestSeq.get(tabId) === token
  const committedUrl = (): string => {
    try {
      return view.webContents.getURL() || ''
    } catch {
      return ''
    }
  }

  /**
   * Wait until the tab stops loading, or `timeoutMs`, whichever comes first.
   *
   * This is the fix the trace pointed at. Every retry used to start 150-450 ms after the previous abort
   * — which is *during* the restore of the page the tab was already on. The trace shows the pattern
   * exactly: `loadURL google.com` → `did-start-navigation google.com` → 130 ms later
   * `did-start-navigation <the old page>` → `load aborted`, three times, then "giving up". Asking again
   * while Chromium is still putting the old document back loses every time. Ask after it has finished.
   */
  const settle = (timeoutMs: number): Promise<void> =>
    new Promise<void>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        try {
          view.webContents.off('did-stop-loading', finish)
        } catch {
          /* the contents is gone; nothing to detach */
        }
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      try {
        view.webContents.once('did-stop-loading', finish)
      } catch {
        finish()
      }
    })

  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  /**
   * Wait for the shell overlay to close.
   *
   * Ctrl+L *is* an overlay: the address bar owns the keyboard, and the AI view is hidden while it is up.
   * `navigate_tab` arrives before the overlay closes, so every navigation from the URL bar started on a
   * hidden view and was then made visible ~6 ms later. The trace shows the consequence — the load is
   * cancelled right after that flip and the previous page is restored. Starting the load once the view
   * is on screen again removes the race instead of retrying into it.
   */
  const waitForOverlayClosed = async (timeoutMs: number): Promise<boolean> => {
    const startedAt = Date.now()
    while (overlaysOpen && Date.now() - startedAt < timeoutMs) {
      await wait(25)
    }
    return !overlaysOpen
  }

  const run = async (): Promise<void> => {
    if (overlaysOpen) {
      traceNav(tabId, 'note', 'waiting for the address bar overlay to close', { url })
      const closed = await waitForOverlayClosed(OVERLAY_CLOSE_TIMEOUT_MS)
      traceNav(tabId, 'note', closed ? 'overlay closed — starting the load' : 'overlay still open — starting the load anyway', {
        url
      })
    }

    // Set when the navigation defence saw the old page take the frame back during this request. It
    // short-circuits the retry loop: the trace has already answered "will this page let go?".
    let foughtBack = false

    for (let attempt = 1; attempt <= NAV_LOAD_ATTEMPTS; attempt += 1) {
      if (!isStillWanted()) {
        traceNav(tabId, 'abort', 'stopped — a newer request took over', { url, attempt })
        return
      }
      if (view.webContents.isDestroyed()) {
        traceNav(tabId, 'abort', 'view was destroyed before the load started', { url, attempt })
        return
      }

      traceNav(tabId, 'load', 'loadURL', { url, attempt, token, from: committedUrl() })
      let failed = false
      let failureReason = ''

      try {
        await view.webContents.loadURL(url)
      } catch (err) {
        failed = true
        const aborted =
          (err as { code?: string })?.code === 'ERR_ABORTED' || (err as { errno?: number })?.errno === -3
        failureReason = aborted ? 'aborted' : describeLoadError(err)
        traceNav(tabId, 'abort', aborted ? 'load aborted' : 'load failed', {
          url,
          attempt,
          error: failureReason,
          stillWanted: isStillWanted(),
          committed: committedUrl()
        })
      }

      // The load either finished or was aborted — but "finished" is not the same as "arrived". The
      // commit is what the user sees, so that is what is checked.
      if (!failed && sameSiteUrl(committedUrl(), url)) {
        navigationIntent.forget(tabId)
        if (navWanted.get(tabId)?.token === token) navWanted.delete(tabId)
        traceNav(tabId, 'settle', 'landed on the requested page', {
          url,
          attempt,
          committed: committedUrl()
        })
        return
      }
      if (!failed) {
        traceNav(tabId, 'abort', 'load finished, but the tab is on another page', {
          url,
          attempt,
          committed: committedUrl()
        })
      }

      if (!isStillWanted()) {
        traceNav(tabId, 'abort', 'stopped — a newer request took over', { url, attempt })
        return
      }

      // Let the tab finish restoring whatever it restored, then ask again.
      await settle(NAV_SETTLE_TIMEOUT_MS)
      if (!isStillWanted()) return
      if (sameSiteUrl(committedUrl(), url)) {
        navigationIntent.forget(tabId)
        if (navWanted.get(tabId)?.token === token) navWanted.delete(tabId)
        traceNav(tabId, 'settle', 'the tab arrived at the requested page while waiting', {
          url,
          attempt,
          committed: committedUrl()
        })
        return
      }
      // The defence already caught this page taking the frame back. Retrying the same contents is
      // the loop builds 27-31 were stuck in — one renderer, four refusals — so stop asking it and
      // go straight to the rebuild below instead of spending three more attempts and four seconds.
      if (navBouncedTabs.has(tabId)) {
        traceNav(tabId, 'note', 'the page took the frame back — this tab gets a fresh renderer, not another retry', {
          url,
          attempt
        })
        foughtBack = true
        break
      }

      await wait(NAV_RETRY_DELAY_MS[Math.min(attempt - 1, NAV_RETRY_DELAY_MS.length - 1)])
    }

    if (isStillWanted() && !sameSiteUrl(committedUrl(), url)) {
      if (!foughtBack) {
        traceNav(tabId, 'note', 'waiting out the noise before the last resort', { url })
        await wait(NAV_LAST_RESORT_DELAY_MS)
      } else {
        // The page is already known to refuse; the only thing a longer wait buys is a longer wait.
        await wait(NAV_REBUILD_DELAY_MS)
      }
      if (!isStillWanted()) return
      if (!view.webContents.isDestroyed() && sameSiteUrl(committedUrl(), url)) return

      const rebuilt = await rebuildTabView(tabId, foughtBack ? 'the page fought every load' : 'attempts exhausted')
      if (!rebuilt) {
        /* fall through to the give-up line */
      } else {
        view = rebuilt
        traceNav(tabId, 'load', 'last resort — the request, in the rebuilt tab', {
          url,
          committed: committedUrl(),
          wc: view.webContents.id
        })
        try {
          await view.webContents.loadURL(url)
        } catch (err) {
          traceNav(tabId, 'abort', 'the rebuilt tab refused too', {
            url,
            error: describeLoadError(err),
            committed: committedUrl()
          })
        }
        if (isStillWanted() && sameSiteUrl(committedUrl(), url)) {
          navigationIntent.forget(tabId)
          if (navWanted.get(tabId)?.token === token) navWanted.delete(tabId)
          traceNav(tabId, 'settle', 'landed in the rebuilt tab', { url, committed: committedUrl() })
          return
        }
      }
    }

    navigationIntent.forget(tabId)
    if (navWanted.get(tabId)?.token === token) navWanted.delete(tabId)
    traceNav(tabId, 'abort', 'giving up on this load', {
      url,
      attempt: NAV_LOAD_ATTEMPTS,
      reason: 'attempts exhausted',
      committed: committedUrl()
    })
    console.log(`[navigate_tab] ${tabId} gave up after ${NAV_LOAD_ATTEMPTS} attempts: ${url}`)
  }

  void run()
})

ipcMain.handle('history_go_back', () => {
  if (!activeViewId) return false
  const activeView = aiViews.get(activeViewId)
  if (!activeView || activeView.webContents.isDestroyed()) return false
  if (activeView.webContents.navigationHistory.canGoBack()) {
    activeView.webContents.navigationHistory.goBack()
    sendToMainWindow('history-nav-hud', { action: 'back', message: '← Back' })
    return true
  } else {
    sendToMainWindow('history-nav-hud', { action: 'boundary', message: 'Start of History' })
    return false
  }
})

ipcMain.handle('history_go_forward', () => {
  if (!activeViewId) return false
  const activeView = aiViews.get(activeViewId)
  if (!activeView || activeView.webContents.isDestroyed()) return false
  if (activeView.webContents.navigationHistory.canGoForward()) {
    activeView.webContents.navigationHistory.goForward()
    sendToMainWindow('history-nav-hud', { action: 'forward', message: '→ Forward' })
    return true
  } else {
    sendToMainWindow('history-nav-hud', { action: 'boundary', message: 'End of History' })
    return false
  }
})

ipcMain.on('destroy_tab_view', async (_event, tabId: string) => {
  wakeTokens.delete(tabId)
  activeWakeOperations.delete(tabId)
  if (activeViewId === tabId) {
    activeViewId = null
    activationRevision++
    arenaTitleSync.stop()
  }
  const closed = await tabDiscardManager.closeTab(tabId)
  if (closed && lastNotifiedTabId === tabId) lastNotifiedTabId = null
  if (!closed) console.error('[close] WebContents remains tracked:', tabId)
})

// Ctrl+R: full reload of the active AI view (like a browser reload)
ipcMain.on('reload_active_view', () => {
  const view = activeViewId ? aiViews.get(activeViewId) : null
  if (view) {
    traceNav(activeViewId || '', 'load', 'reload (reload_active_view)', {})
    view.webContents.reload()
  }
})

ipcMain.handle(
  'provider_clear_session',
  async (event, providerKey: string, providerUrl?: string) => {
    if (!isValidMainWindowSender(event)) return { success: false, message: 'Unauthorized' }
    const sess = session.fromPartition('persist:ai-shared')
    try {
      if (providerUrl) {
        try {
          const u = new URL(providerUrl)
          await sess.clearStorageData({
            origin: u.origin,
            storages: ['cookies', 'localstorage', 'cachestorage']
          })
        } catch {
          await sess.clearStorageData({
            storages: ['cookies', 'localstorage', 'cachestorage']
          })
        }
      } else {
        await sess.clearStorageData({
          storages: ['cookies', 'localstorage', 'cachestorage']
        })
      }
      // Reload open view for this provider to reflect signed-out state
      for (const [tabId, view] of aiViews.entries()) {
        if (viewModelKeys.get(tabId) === providerKey && !view.webContents.isDestroyed()) {
          traceNav(tabId, 'load', 'reload (provider_clear_session)', { provider: providerKey })
          view.webContents.reload()
        }
      }
      return { success: true }
    } catch (err) {
      return { success: false, message: String(err) }
    }
  }
)

// On a successful Google session import, reload Gemini views only so the
// embedded page picks up the newly-imported session; forward events to renderer.
function forwardGoogleSignInEvent(ev: import('./googleAuth').GoogleSignInEvent): void {
  if (ev.stage === 'success') {
    reloadProviderViews(aiViews, viewModelKeys, ['gemini'])
  }
  sendToMainWindow('google-signin-event', ev)
}
const GEMINI_LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?hl=en&passive=true&continue=' +
  encodeURIComponent(
    'https://gemini.google.com/signin?continue=https%3A%2F%2Fgemini.google.com%2Fapp'
  ) +
  '&flowName=GlifWebSignIn&flowEntry=ServiceLogin'
const googleAccountStore = new GoogleAccountStore(
  joinPath(app.getPath('userData'), 'google-accounts.json')
)

const containerStore = new ContainerStore(joinPath(app.getPath('userData'), 'containers.json'))

/** Where Google's sign-in page keeps local state; cleared when a profile signs in again. */
const GOOGLE_ACCOUNT_ORIGINS = [
  'https://accounts.google.com',
  'https://myaccount.google.com',
  'https://gemini.google.com'
]

/**
 * Which container each tab belongs to. The renderer owns the durable tab records; main only needs
 * this to pick a partition *before* a view is created, and to know which colour to paint its aura.
 * It is filled by the IPC calls that open tabs (so it is always set before `ensureAiView` runs) and
 * kept in sync in bulk whenever the tab list changes.
 */
const tabContainers = new Map<string, string>()

function containerForTab(tabId: string): ReturnType<ContainerStore['get']> {
  const containerId = tabContainers.get(tabId)
  return containerId ? containerStore.get(containerId) : null
}

function rememberTabContainer(tabId: string, containerId: unknown): void {
  if (typeof containerId !== 'string' || !containerId) return
  tabContainers.set(tabId, containerId)
}

function partitionForTab(tabId: string): string {
  const container = containerForTab(tabId)
  // A container that has since been deleted falls back to the default store rather than to an
  // empty partition nobody signed into.
  return containerPartition(container ?? { accountId: 'default' })
}

ipcMain.handle('containers_list', () => {
  // Asking for the list is also the moment to notice a Google account that has no container yet:
  // people add accounts first and expect to find them here, not to build a container by hand.
  const { containers, created } = containerStore.syncWithAccounts(googleAccountStore.list())
  if (created.length > 0) {
    console.log(`[containers] Created ${created.length} container(s) for existing accounts`)
  }
  return containers
})

ipcMain.handle('containers_save', (_event, input: unknown) => {
  const payload = (input && typeof input === 'object' ? input : {}) as {
    id?: string
    name?: string
    color?: string | null
    accountId?: string
  }
  // The store cannot know which accounts exist; this is the one place that can, and a container
  // pointing at a missing account would silently sign into an empty cookie store.
  if (payload.accountId && payload.accountId !== 'default' && !googleAccountStore.get(payload.accountId)) {
    return { error: 'That account no longer exists. Pick another one.' }
  }
  const result = containerStore.save(payload)
  if (result.container) {
    // Recolour live views of that container: the aura is painted from the container, not the tab.
    for (const [tabId, containerId] of tabContainers.entries()) {
      if (containerId !== result.container.id) continue
      const view = aiViews.get(tabId)
      if (view && !view.webContents.isDestroyed()) {
        applyWebviewTheme(view, resolveModelKey(tabId, view.webContents.getURL()))
      }
    }
    sendToMainWindow('containers-changed', containerStore.list())
  }
  return result
})

ipcMain.handle('containers_delete', (_event, containerId: string) => {
  const result = containerStore.remove(containerId)
  if (!result.removed) return result
  // Tabs that lived there fall back to the default container (and its store) without losing their
  // view: the partition was already fixed at creation, so only the label and aura change.
  for (const [tabId, id] of [...tabContainers.entries()]) {
    if (id === containerId) tabContainers.delete(tabId)
  }
  sendToMainWindow('containers-changed', containerStore.list())
  return result
})

/**
 * The order the user chose for the containers.
 *
 * Order is not cosmetic: the switcher lists them in this order and `Ctrl+Alt+N` opens the Nth, so the
 * list is written down rather than derived from creation time.
 */
ipcMain.handle('containers_reorder', (_event, orderedIds: unknown) => {
  if (!Array.isArray(orderedIds)) return { error: 'Expected the containers in their new order.' }
  const list = containerStore.reorder(
    orderedIds.filter((id): id is string => typeof id === 'string')
  )
  sendToMainWindow('containers-changed', list)
  return { containers: list }
})

/**
 * Sign one profile in again from the beginning: wipe that account's store, reload its tabs so the
 * sign-out is visible, then open Google's account chooser on the same partition. The chooser is also
 * where "Use another account" lives, which is how a profile gets a different account than before.
 *
 * One partition per account is what makes the wipe safe: nothing else lives in it.
 */
ipcMain.handle('containers_reconnect', async (_event, containerId: unknown) => {
  const id = typeof containerId === 'string' && containerId ? containerId : DEFAULT_CONTAINER_ID
  const container = containerStore.get(id)
  if (!container) return { ok: false, error: 'No such container.' }

  // Every tab on that account, not just this container's: two containers may share one Google
  // account, and clearing the store signs both of them out whether they are reloaded or not.
  const tabIds = [...tabContainers.entries()]
    .filter(([, containerOfTab]) => {
      const owner = containerStore.get(containerOfTab)
      return (owner?.accountId ?? 'default') === container.accountId
    })
    .map(([tabId]) => tabId)
  const reloadContainer = (): void => {
    for (const tabId of tabIds) {
      const view = aiViews.get(tabId)
      if (view && !view.webContents.isDestroyed()) {
        // This reloads every tab in the container — including one the user just navigated. It is
        // named in the trace so "the page reloaded itself" has an owner.
        traceNav(tabId, 'load', 'reload (account reconnect)', {})
        view.webContents.reload()
      }
    }
  }

  return reconnectAccount(
    reconnectTargetFor(container),
    {
      clearSession: async (accountId) => {
        const sess = session.fromPartition(partitionForAccount(accountId))
        // Google only. The same partition holds this profile's Gemini, ChatGPT and Claude sessions,
        // and choosing a different Google account is not a reason to sign out of those.
        const removed = await clearGoogleSessionCookies(sess.cookies)
        // accounts.google.com keeps a little storage of its own; a stale copy reopens the chooser
        // already signed in.
        for (const origin of GOOGLE_ACCOUNT_ORIGINS) {
          try {
            await sess.clearStorageData({
              origin,
              storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
            })
          } catch (err) {
            console.warn('[containers] Could not clear %s for %s:', origin, accountId, err)
          }
        }
        try {
          await sess.cookies.flushStore()
        } catch (err) {
          console.warn('[containers] Could not flush the cleared cookie store:', err)
        }
        console.log(`[containers] Signed Google out of ${accountId}: ${removed} cookie(s) removed`)
      },
      reloadContainer,
      startSignIn: async (accountId, url) => {
        await startGoogleSignIn(url, {
          accountId,
          onEvent: (ev) => {
            forwardGoogleSignInEvent(ev)
            // The new account is in the store now: the tabs have to load again to see it.
            if (ev.stage === 'success') reloadContainer()
            sendToMainWindow('container-reconnect-event', {
              containerId: container.id,
              containerName: container.name,
              stage: ev.stage,
              ...('message' in ev && ev.message ? { message: ev.message } : {})
            })
          },
          openAuthWindow: (target, partition, onBlocked) =>
            openInAppSignInWindow(target, { partition, parent: mainWindow, onBlocked })
        })
      },
      report: (ev) =>
        sendToMainWindow('container-reconnect-event', {
          containerId: container.id,
          containerName: container.name,
          ...ev
        })
    },
    GEMINI_LOGIN_URL
  )
})

/** Bulk sync from the renderer: the tab list is the source of truth for who belongs where. */
ipcMain.on('set_tab_containers', (_event, map: unknown) => {
  if (!map || typeof map !== 'object') return
  tabContainers.clear()
  for (const [tabId, containerId] of Object.entries(map as Record<string, unknown>)) {
    if (typeof containerId === 'string' && containerId) tabContainers.set(tabId, containerId)
  }
})

ipcMain.handle('google_signin_accounts', () => googleAccountStore.list())
ipcMain.handle('google_signin_add_account', (_event, label: string) => {
  const result = googleAccountStore.add(label)
  if (result.account) {
    // A new account is a new workspace: give it a container straight away, coloured and ready.
    const { created } = containerStore.syncWithAccounts(googleAccountStore.list())
    if (created.length > 0) sendToMainWindow('containers-changed', containerStore.list())
  }
  return result
})
ipcMain.handle('google_signin_remove_account', (_event, accountId: string) =>
  googleAccountStore.remove(accountId)
)

ipcMain.handle('google_signin_start', (_event, accountId?: string) => {
  // Sign-in happens in a window Nexus owns, on the AI tab partition: the cookies are where they are
  // needed the moment they are set, so nothing has to be read out of another browser afterwards.
  void startGoogleSignIn(GEMINI_LOGIN_URL, {
    accountId: accountId || 'default',
    onEvent: forwardGoogleSignInEvent,
    openAuthWindow: (url, partition, onBlocked) => {
      // The window signs in on the same partition its tabs will use, so that partition needs the
      // identity hook — otherwise the header could disagree with the page inside the one window where
      // it matters most. It deliberately does *not* get the rest of the AI treatment: a partition used
      // to sign in should behave like a browser on Google's pages. Where the partition is already a
      // tab partition (the default account's, a container's) the full policy is already installed and
      // this is a no-op.
      installSignInSessionPolicy(partition)
      return openInAppSignInWindow(url, { partition, parent: mainWindow, onBlocked })
    }
  })
})
ipcMain.handle('google_signin_pick_profile', (_event, profileId: string) => {
  void startGoogleSignIn(GEMINI_LOGIN_URL, { profileId, onEvent: forwardGoogleSignInEvent })
})
ipcMain.handle('google_signin_status', async (_event, accountId?: string) => {
  // Whether Nexus itself already holds a Google session — the state the UI should show first.
  return { signedIn: await hasGoogleSessionInNexus(accountId || 'default') }
})
ipcMain.handle('google_signin_profiles', () => listProfiles())
ipcMain.on('google_signin_cancel', () => {
  cancelGoogleSignIn()
  closeInAppSignInWindow()
})

ipcMain.handle('sessions_sync_all', async (event) => {
  if (!isValidMainWindowSender(event)) return { success: false, message: 'Unauthorized' }
  const result = await syncAllSessionsFromBrowsers()
  if (result.success && result.detectedProviders?.length) {
    reloadProviderViews(aiViews, viewModelKeys, result.detectedProviders)
  }
  return result
})

ipcMain.handle('sessions_sync_profile', async (event, profileId: string) => {
  if (!isValidMainWindowSender(event)) return { success: false, message: 'Unauthorized' }
  const result = await syncSessionFromProfile(profileId)
  if (result.success && result.affectedProviders?.length) {
    reloadProviderViews(aiViews, viewModelKeys, result.affectedProviders)
  }
  return result
})

ipcMain.handle('sessions_get_profiles', (event) => {
  if (!isValidMainWindowSender(event)) return []
  return listProfiles()
})

ipcMain.handle('sessions_pick_custom_folder', async (event) => {
  if (!isValidMainWindowSender(event)) return { success: false, message: 'Unauthorized' }
  if (!mainWindow || mainWindow.isDestroyed())
    return { success: false, message: 'Window unavailable' }
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Browser Profile Folder',
    properties: ['openDirectory']
  })
  if (res.canceled || !res.filePaths[0]) {
    return { canceled: true }
  }
  const folder = res.filePaths[0]
  try {
    const { profile, cookies } = await readCookiesFromCustomDirectory(folder)
    if (cookies.length === 0) {
      return { success: false, message: `No active AI session cookies found in "${folder}".` }
    }
    const report = await injectCookies(cookies)
    if (report.count > 0 && report.affectedProviders?.length) {
      reloadProviderViews(aiViews, viewModelKeys, report.affectedProviders)
    }
    return {
      success: report.count > 0,
      count: report.count,
      errorCount: report.errorCount,
      profileName: profile.name,
      detectedProviders: profile.detectedAiSessions,
      affectedProviders: report.affectedProviders,
      message:
        report.errorCount > 0
          ? `Imported ${report.count} cookie(s) from "${profile.name}" but ${report.errorCount} failed.`
          : `Successfully imported ${report.count} cookie(s) from "${profile.name}".`
    }
  } catch (err: any) {
    return { success: false, message: err?.message || String(err) }
  }
})

ipcMain.handle('cookies_import_json', async (event, jsonStr: string) => {
  if (!isValidMainWindowSender(event)) return { success: false, message: 'Unauthorized' }
  const result = await importCookiesFromJson(jsonStr)
  if (result.success && result.affectedProviders?.length) {
    reloadProviderViews(aiViews, viewModelKeys, result.affectedProviders)
  }
  return result
})

ipcMain.on('resize_view', (_event, bounds) => {
  // Apply UI zoom factor to convert DOM pixels back to physical DIPs for BrowserView
  if (currentUiZoom !== 1.0) {
    bounds = {
      x: Math.round(bounds.x * currentUiZoom),
      y: Math.round(bounds.y * currentUiZoom),
      width: Math.round(bounds.width * currentUiZoom),
      height: Math.round(bounds.height * currentUiZoom)
    }
  }

  const hidden = bounds.width === 0 && bounds.height === 0

  // A native view is painted above the DOM, so re-showing it while an overlay is up puts the AI page
  // on top of the panel the user is looking at — the panel is still there, just invisible, and every
  // click lands on the page. The renderer's own bounds sender already refuses to fire during an
  // overlay, so a real-bounds message here means the two disagree; three in a row means main's flag is
  // the stale one and it is cleared rather than letting the window stay covered.
  if (!hidden && overlaysOpen) {
    boundsWhileOverlay += 1
    if (boundsWhileOverlay <= 2) {
      console.log('[view] ignoring a bounds restore while an overlay is open')
      return
    }
    console.warn(
      '[overlay] the renderer keeps reporting view bounds while main thinks an overlay is open — clearing the stale overlay flag'
    )
    overlaysOpen = false
    containerMenuOpen = false
    boundsWhileOverlay = 0
    overlayWatchdog = disarmWatchdog()
  }

  const wasViewVisible = activeViewVisible
  activeViewVisible = !hidden
  if (wasViewVisible !== activeViewVisible) restartActiveArenaTitleSync()

  if (hidden) {
    for (const [id, view] of aiViews) {
      if (!view.webContents.isDestroyed()) {
        view.setVisible(false)
        // Recorded so the next reconcile treats the return as "coming back from hidden" and asks for
        // a strong repaint, instead of trusting geometry that never changed.
        markViewVisibility(id, false)
        view.webContents.setBackgroundThrottling(true)
        view.webContents.setAudioMuted(true)
      }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus()
      mainWindow.focusOnWebView()
      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.focus()
      }
    }
    return
  }

  // Not hidden: record real bounds for all views so newly activated tabs have accurate geometry
  for (const [tabId] of aiViews) {
    lastRealBounds.set(tabId, bounds)
  }

  const activeView = activeViewId ? aiViews.get(activeViewId) : null
  if (activeView && !activeView.webContents.isDestroyed()) {
    const prev = activeView.getBounds()
    if (
      prev.x !== bounds.x ||
      prev.y !== bounds.y ||
      prev.width !== bounds.width ||
      prev.height !== bounds.height
    ) {
      activeView.setBounds(bounds)
    }
    const shouldBeVisible = !hidden && !overlaysOpen
    if (typeof activeView?.setVisible === 'function') activeView.setVisible(shouldBeVisible)
    if (activeView?.webContents && !activeView.webContents.isDestroyed?.()) {
      activeView.webContents.setBackgroundThrottling?.(!shouldBeVisible)
      activeView.webContents.setAudioMuted?.(!shouldBeVisible)
    }

    // Re-theme only when active view width or height actually changed.
    // Debounced: window resize fires ~60 events/sec; settle once at the end.
    if (Math.abs(prev.width - bounds.width) > 1 || Math.abs(prev.height - bounds.height) > 1) {
      if (resizeThemeTimer) clearTimeout(resizeThemeTimer)
      resizeThemeTimer = setTimeout(() => {
        if (activeViewId) {
          const v = aiViews.get(activeViewId)
          if (v && !v.webContents.isDestroyed()) {
            applyWebviewTheme(v, viewModelKeys.get(activeViewId))
          }
        }
      }, 120)
    }
  }

  // Ensure inactive views remain hidden without triggering unwanted background layout thrashing
  for (const [tabId, view] of aiViews) {
    if (tabId !== activeViewId && !view.webContents.isDestroyed()) {
      view.setVisible(false)
      markViewVisibility(tabId, false)
      view.webContents.setBackgroundThrottling(true)
      view.webContents.setAudioMuted(true)
    }
  }
  if (hidden) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus()
      mainWindow.focusOnWebView()
      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.focus()
      }
    }
  } else {
    const view = activeViewId ? aiViews.get(activeViewId) : null
    if (view && !view.webContents.isDestroyed() && mainWindow && !mainWindow.isDestroyed()) {
      view.webContents.focus()
      focusPromptInView(view)
    }
  }
  // Reconcile to ensure consistency across all state sources
  reconcileViewPresentation()
})

ipcMain.on('toggle_focus_mode', (_event, enabled) => {
  const view = activeViewId ? aiViews.get(activeViewId) : null
  if (!view) return
  const wc = view.webContents
  const old = focusCssKeys.get(wc)
  if (enabled) {
    if (old) wc.removeInsertedCSS(old).catch(() => {})
    wc.insertCSS('header, nav, aside, .sidebar { display: none !important; }')
      .then((k) => focusCssKeys.set(wc, k))
      .catch(() => {})
  } else if (old) {
    wc.removeInsertedCSS(old).catch(() => {})
    focusCssKeys.delete(wc)
  }
})

const lastThumbnailFiles = new Map<string, string>()

/**
 * Ctrl+V typed into the shell, routed to the prompt.
 *
 * The composer is not in this window: it lives in the tab's `WebContentsView`, which only receives
 * keystrokes while it owns the keyboard. So with the sidebar, a panel or the tab strip focused, Ctrl+V
 * did nothing at all — the clipboard event was delivered to a renderer with no editable target, and the
 * AI page never heard about it. The renderer forwards that event here (see the capture-phase `paste`
 * listener in App.tsx) and this handler does the three things a paste into the page actually needs:
 * hand the keyboard over, put the caret back in the composer without moving it, then paste.
 */
let lastPasteRouteAt = 0

/**
 * Paste the clipboard into the active tab's composer.
 *
 * Two callers, because a paste can be reported twice: the shell's `before-input-event` (the keystroke
 * itself, which is what happens when nothing in the shell is focused enough to produce a DOM paste
 * event) and the renderer's capture-phase `paste` listener (the DOM event, when there is one). One
 * function with a 300 ms debounce, so whichever arrives first wins and the other is a no-op — a double
 * paste would be worse than the bug.
 */
/**
 * Is the active tab's page the thing that currently has the keyboard?
 *
 * Asked of the webContents rather than of the remembered `keyboardOwner`: the flag records intent, and
 * the intent that matters for a paste is where the keystroke is actually going. Clicking the sidebar does
 * not necessarily flip the flag, but it does take the keyboard away from the page, and that is exactly
 * the case a Ctrl+V has to be intercepted in.
 */
function activeViewHasKeyboard(): boolean {
  const view = activeViewId ? aiViews.get(activeViewId) : null
  try {
    return Boolean(view && view.webContents && !view.webContents.isDestroyed() && view.webContents.isFocused())
  } catch {
    return false
  }
}

function pasteIntoActiveView(source: string): void {
  const now = Date.now()
  if (now - lastPasteRouteAt < 300) {
    traceNav(activeViewId || '', 'view', `paste ignored (${source}, duplicate)`, {})
    return
  }
  // An overlay is on screen and has the keyboard on purpose; its own paste is the right one.
  if (overlaysOpen) return
  const tabId = activeViewId
  const view = tabId ? aiViews.get(tabId) : null
  if (!tabId || !view || view.webContents.isDestroyed()) return
  lastPasteRouteAt = now
  traceNav(tabId, 'view', `paste → composer (${source})`, {})
  giveKeyboardToView(view, 'paste', tabId)
  focusPromptInView(view, viewModelKeys.get(tabId))
  // The page focuses its composer inside `executeJavaScript`, which resolves a frame later. Pasting in
  // the same tick would land nowhere; 60 ms is well under a frame of human perception.
  setTimeout(() => {
    try {
      if (!view.webContents.isDestroyed() && !overlaysOpen) view.webContents.paste()
    } catch {
      /* the view went away between the focus and the paste */
    }
  }, 60)
}

ipcMain.on('paste_to_active_view', () => pasteIntoActiveView('renderer'))

ipcMain.handle('clipboard_write', (_, text) => {
  try {
    const electron = require('electron')
    electron.clipboard.writeText(text || '')
    return { success: true }
  } catch (err: any) {
    console.error('clipboard_write error:', err)
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle(
  'extract_context',
  async (_event, options?: CompressionOptions & { expectedTabId?: string }) => {
    const targetTabId = options?.expectedTabId || activeViewId
    if (!targetTabId) return { success: false, error: 'No active tab' }
    const view = aiViews.get(targetTabId)
    if (!view) return { success: false, error: 'Tab view not found' }

    // Bind immutable capture context before await (preventing race condition when switching tabs)
    const capturedTabId = targetTabId
    const modelKey = viewModelKeys.get(capturedTabId) || 'ai-session'
    const modelLabels: Record<string, string> = {
      gemini: 'Google Gemini',
      chatgpt: 'OpenAI ChatGPT',
      claude: 'Anthropic Claude',
      deepseek: 'DeepSeek AI',
      kimi: 'Kimi Moonshot',
      qwen: 'Qwen AI',
      mistral: 'Mistral Le Chat',
      grok: 'xAI Grok',
      copilot: 'Microsoft Copilot',
      perplexity: 'Perplexity AI',
      arena: 'Arena Agent Mode'
    }
    const providerLabel =
      (modelKey && modelLabels[modelKey.toLowerCase()]) || modelKey.toUpperCase()

    try {
      const script = buildContextExtractorScript()

      // Bounded execution with timeout (7500ms)
      const timeoutPromise = new Promise<RawExtractionPayload>((_, reject) => {
        setTimeout(() => reject(new Error('Extraction timed out after 7500ms')), 7500)
      })

      const executionPromise = view.webContents.executeJavaScript(
        script
      ) as Promise<RawExtractionPayload>
      const rawPayload = await Promise.race([executionPromise, timeoutPromise])

      // Verify view has not been destroyed while waiting
      if (!aiViews.has(capturedTabId) || view.webContents.isDestroyed()) {
        return { success: false, error: 'Tab was closed or navigated during capture' }
      }

      if (!rawPayload || !rawPayload.success) {
        const errMsg = rawPayload?.error || 'Extraction failed in guest page'
        return { success: false, error: errMsg, prompt: errMsg, rawText: errMsg }
      }

      const title = viewTitles.get(capturedTabId) || view.webContents.getTitle() || providerLabel
      const snapshot = buildSnapshotFromRawPayload({
        payload: rawPayload,
        tabId: capturedTabId,
        providerKey: providerLabel,
        origin: view.webContents.getURL() || '',
        title,
        contextRevision: `rev-${Date.now().toString(16)}`
      })

      // Project snapshot to initial continuation brief / markdown
      const projection = projectSnapshotToMarkdown({
        snapshot,
        options: {
          mode:
            options?.mode === 'clean'
              ? 'transcript'
              : options?.mode === 'compact'
                ? 'compact'
                : 'brief',
          stripPleasantries: options?.stripPleasantries,
          deduplicateExactCode: options?.deduplicateCode,
          includeThinkingSummary: !options?.excludeThinking,
          userObjectiveOverride: options?.userObjectiveOverride,
          userNextActionOverride: options?.userNextActionOverride
        }
      })

      return {
        success: true,
        snapshot,
        modelKey,
        providerName: providerLabel,
        title,
        capturedAt: snapshot.capturedAt,
        prompt: projection.prompt,
        rawText: projection.rawText,
        stats: projection.stats,
        currentObjective: projection.currentObjective,
        nextActionCandidate: projection.nextActionCandidate,
        ledger: projection.ledger,
        artifacts: projection.artifacts,
        omissions: projection.omissions,
        coverageWarnings: projection.coverageWarnings
      }
    } catch (err: any) {
      console.error('Failed to extract context:', err)
      return {
        success: false,
        error: err?.message || 'Failed to extract context from active session'
      }
    }
  }
)
ipcMain.handle('capture_tab_snapshot', async (_event, tabId?: string) => {
  const id = tabId ?? activeViewId
  if (!id) return null
  const view = id ? aiViews.get(id) : null
  if (!view) return null
  try {
    const image = await view.webContents.capturePage()
    const resized = image.resize({ width: 800 })
    const jpeg = resized.toJPEG(80)
    const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '')
    const filename = `${safeId}-${Date.now()}.jpg`
    const filepath = join(thumbnailsDir, filename)
    writeFileSync(filepath, jpeg)

    const oldFilename = lastThumbnailFiles.get(safeId)
    if (oldFilename && oldFilename !== filename) {
      fs.unlink(join(thumbnailsDir, oldFilename), () => {})
    }
    lastThumbnailFiles.set(safeId, filename)

    return 'thumb://' + filename
  } catch (err) {
    console.error('Failed to capture snapshot:', err)
    return null
  }
})

// Live preview stream: one single-flight capture/second while
// the Settings → Webview tab is open, so theme knobs reflect instantly.
function findPreviewView(providerKey: string | null): [string, Electron.WebContentsView] | null {
  if (providerKey) {
    if (
      activeViewId &&
      viewModelKeys.get(activeViewId) === providerKey &&
      aiViews.has(activeViewId)
    ) {
      return [activeViewId, aiViews.get(activeViewId)!]
    }
    for (const [tabId, view] of aiViews) {
      if (viewModelKeys.get(tabId) === providerKey) return [tabId, view]
    }
    // Named provider with no open tab: do NOT show an unrelated view — the
    // renderer shows an "open this provider first" message instead.
    return null
  }
  if (!activeViewId) return null
  const active = aiViews.get(activeViewId)
  return active ? [activeViewId, active] : null
}

function capturePreviewFrame(): void {
  previewLoop.request()
}

function stopWebviewPreview(): void {
  previewLoop.stop()
  if (previewViewId && previewRestoreBounds) {
    const view = aiViews.get(previewViewId)
    if (view && !view.webContents.isDestroyed()) {
      view.setBounds(previewRestoreBounds)
      view.setVisible(previewViewId === activeViewId && activeViewVisible && !overlaysOpen)
    }
  }
  previewViewId = null
  previewRestoreBounds = null
}

ipcMain.handle('start_webview_preview', (_event, providerKey: string | null) => {
  stopWebviewPreview()
  const found = findPreviewView(providerKey)
  if (!found) {
    previewViewId = null
    previewRestoreBounds = null
    return false
  }
  const [tabId, view] = found
  previewViewId = tabId
  const b = view.getBounds()
  if (b.width === 0 && b.height === 0) {
    // Hidden under the settings overlay: give it real bounds so capturePage
    // renders, but keep it invisible (native view would cover the modal).
    previewRestoreBounds = { x: b.x, y: b.y, width: b.width, height: b.height }
    view.setBounds(lastRealBounds.get(tabId) ?? { x: 0, y: 0, width: 900, height: 700 })
    view.setVisible(false)
    markViewVisibility(tabId, false)
  } else {
    previewRestoreBounds = null
  }
  previewLoop.start(tabId)
  return true
})

ipcMain.on('stop_webview_preview', stopWebviewPreview)

import fs from 'fs'
import path from 'path'

// Load from Nexus userData directory (~/.config/nexus on Linux)
const dataDir = app.getPath('userData')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

// Auto-migration from legacy ~/.config/vicinae if present
const legacyDataDir = path.join(app.getPath('appData'), 'vicinae')
if (fs.existsSync(legacyDataDir)) {
  try {
    const legacyHistory = path.join(legacyDataDir, 'history.json')
    const newHistory = path.join(dataDir, 'history.json')
    if (fs.existsSync(legacyHistory)) {
      const legacySize = fs.statSync(legacyHistory).size
      const newSize = fs.existsSync(newHistory) ? fs.statSync(newHistory).size : 0
      if (legacySize > newSize) {
        fs.copyFileSync(legacyHistory, newHistory)
      }
    }
    const legacyPatterns = path.join(legacyDataDir, 'patterns.json')
    const newPatterns = path.join(dataDir, 'patterns.json')
    if (fs.existsSync(legacyPatterns)) {
      const legacySize = fs.statSync(legacyPatterns).size
      const newSize = fs.existsSync(newPatterns) ? fs.statSync(newPatterns).size : 0
      if (legacySize > newSize) {
        fs.copyFileSync(legacyPatterns, newPatterns)
      }
    }
    const legacySkills = path.join(legacyDataDir, 'skills')
    const newSkills = path.join(dataDir, 'skills')
    if (fs.existsSync(legacySkills) && !fs.existsSync(newSkills)) {
      fs.cpSync(legacySkills, newSkills, { recursive: true })
    }
    const legacyModels = path.join(legacyDataDir, 'models.json')
    const newModels = path.join(dataDir, 'models.json')
    if (fs.existsSync(legacyModels) && !fs.existsSync(newModels)) {
      fs.copyFileSync(legacyModels, newModels)
    }
    const legacyProviders = path.join(legacyDataDir, 'providers.json')
    const newProviders = path.join(dataDir, 'providers.json')
    if (fs.existsSync(legacyProviders)) {
      const legacySize = fs.statSync(legacyProviders).size
      const newSize = fs.existsSync(newProviders) ? fs.statSync(newProviders).size : 0
      if (legacySize > newSize && newSize <= 5) {
        fs.copyFileSync(legacyProviders, newProviders)
      } else if (!fs.existsSync(newProviders)) {
        fs.copyFileSync(legacyProviders, newProviders)
      }
    }
  } catch (e: any) {
    console.error('Migration error from legacy vicinae directory:', e)
  }
}

const historyFile = path.join(dataDir, 'history.json')
let pendingHistoryData: string | null = null
let historySaveTimer: NodeJS.Timeout | null = null

function flushPendingHistorySync(): void {
  if (historySaveTimer) {
    clearTimeout(historySaveTimer)
    historySaveTimer = null
  }
  if (pendingHistoryData !== null) {
    try {
      const parsed = JSON.parse(pendingHistoryData)
      atomicWriteJson(historyFile, parsed)
      pendingHistoryData = null
    } catch (err) {
      console.error('[History] Failed to flush history atomically:', err)
    }
  }
}

app.on('before-quit', () => {
  flushPendingHistorySync()
})

ipcMain.handle('read_history', (event) => {
  if (!isValidMainWindowSender(event)) return '[]'
  try {
    return fs.readFileSync(historyFile, 'utf-8')
  } catch {
    return '[]'
  }
})

ipcMain.handle('get_history', (event) => {
  if (!isValidMainWindowSender(event)) return '[]'
  try {
    return fs.readFileSync(historyFile, 'utf-8')
  } catch {
    return '[]'
  }
})

ipcMain.handle('save_history', (event, dataStr: string) => {
  if (!isValidMainWindowSender(event)) return false
  if (typeof dataStr !== 'string') return false
  pendingHistoryData = dataStr
  if (historySaveTimer) clearTimeout(historySaveTimer)
  historySaveTimer = setTimeout(() => {
    flushPendingHistorySync()
  }, 1000)
  return true
})

ipcMain.handle('list_history', (event) => {
  if (!isValidMainWindowSender(event)) return []
  try {
    return JSON.parse(fs.readFileSync(historyFile, 'utf-8'))
  } catch {
    return []
  }
})

ipcMain.handle('nexus-update-status', () => {
  if (autoUpdateService) {
    return autoUpdateService.getStatus()
  }
  return unsupportedUpdateStatus()
})

ipcMain.handle('nexus-update-check', () => {
  if (autoUpdateService) {
    return autoUpdateService.check()
  }
  return Promise.resolve()
})

ipcMain.handle('nexus-update-install', () => {
  autoUpdateService?.installNow()
  return autoUpdateService ? autoUpdateService.getStatus() : unsupportedUpdateStatus()
})

ipcMain.handle('nexus-update-defer', () => {
  autoUpdateService?.defer()
  return autoUpdateService ? autoUpdateService.getStatus() : unsupportedUpdateStatus()
})

// Universal file-backed app state (tabs, pinned, models, providers, interface-settings, theme)
// is registered with the Session Write Barrier and Atomic Write Engine in registerStateIpc().
