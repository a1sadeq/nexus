/**
 * Every overlay, in one list.
 *
 * Two things have to agree about overlays, and they used to be written out separately: whether *any*
 * overlay is open (which decides if the native AI view is hidden and whether main routes shortcuts),
 * and what Escape closes. Keeping those as two hand-maintained lists is how a panel ends up open with
 * nobody able to close it — Escape closes a list that forgot it, while the view stays hidden because
 * the other list knows it is there.
 *
 * So: one list here, and both answers derive from it.
 */

/** Panels and dialogs that take over the window. Order is irrelevant; the list is a set. */
export const OVERLAY_KEYS = [
  'showHistory',
  'showTabOverview',
  'showSettings',
  'showNewTab',
  'showExport',
  'showUrlBar',
  'showGuide',
  'showSkillsPalette',
  'showBaseSkillsModal',
  'showSkillParamsModal',
  'showSkillEditorModal',
  'showCategoryManagerModal',
  'showBootSequence',
  'showDiagnosticsModal',
  'showTabColors',
  'showContainerMenu',
  'showContainerModal',
  'showContainerManager',
  'folderUploadData'
] as const

export type OverlayKey = (typeof OVERLAY_KEYS)[number]

export type OverlayFlags = Partial<Record<OverlayKey, boolean>>

/**
 * The boot sequence is the one overlay the user did not ask for and cannot dismiss: Escape must not
 * close it, or the app would come up with a half-run boot screen gone.
 */
const NOT_DISMISSABLE: ReadonlySet<OverlayKey> = new Set<OverlayKey>(['showBootSequence'])

/** True when a flag is set. `folderUploadData` is data, not a boolean, so `Boolean()` decides it. */
export function isOverlayOpen(flags: OverlayFlags, key: OverlayKey): boolean {
  return Boolean(flags[key])
}

/** The keys that are open right now, in list order. */
export function openOverlayKeys(flags: OverlayFlags): OverlayKey[] {
  return OVERLAY_KEYS.filter((key) => isOverlayOpen(flags, key))
}

/** Is anything covering the workspace? Drives view hiding and the main-process key guard. */
export function isAnyOverlayOpen(flags: OverlayFlags): boolean {
  return openOverlayKeys(flags).length > 0
}

/** What Escape should close: everything open except what cannot be dismissed. */
export function dismissibleOverlayKeys(flags: OverlayFlags): OverlayKey[] {
  return openOverlayKeys(flags).filter((key) => !NOT_DISMISSABLE.has(key))
}

/** A one-line description for the console, so a stuck overlay names itself. */
export function describeOverlays(flags: OverlayFlags): string {
  const open = openOverlayKeys(flags)
  return open.length === 0 ? 'none' : open.join(', ')
}
