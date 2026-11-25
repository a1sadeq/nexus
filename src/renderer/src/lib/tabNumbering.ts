/**
 * Tab numbering — the number printed on a tab is the digit that reaches it.
 *
 * The strips render pinned tabs first and the rest after them, so the numbering does the same:
 * pinned tabs take 1, 2, 3… and the normal tabs continue from there. `Ctrl+1` then means "the first
 * tab I can see", whichever strip it is in, instead of two separate numbering schemes (Ctrl+N for
 * normal tabs, Alt+N for pinned) that had to be remembered.
 *
 * Only the first nine tabs get a number, because only nine digits exist. A tenth tab is still
 * reachable with Ctrl+Tab and by clicking it — it just does not claim a key it cannot have, which is
 * why numbering stops instead of printing "11" next to a tab nothing can jump to.
 */

export const MAX_TAB_SHORTCUT_NUMBER = 9

export interface NumberableTab {
  id: string
}

/**
 * Pinned tabs first, then everything else, each group in the order it is drawn. This is the one
 * ordering shared by the badges, `Ctrl+1…9` and the switcher, so they can never disagree.
 */
export function numberedTabOrder<T extends NumberableTab>(
  tabs: T[],
  pinnedIds: string[] = []
): T[] {
  const pinned = tabs.filter((tab) => pinnedIds.includes(tab.id))
  const unpinned = tabs.filter((tab) => !pinnedIds.includes(tab.id))
  return [...pinned, ...unpinned]
}

/** Just the tabs a digit can reach, in that same order. */
export function numberableTabs<T extends NumberableTab>(
  tabs: T[],
  pinnedIds: string[] = []
): T[] {
  return numberedTabOrder(tabs, pinnedIds).slice(0, MAX_TAB_SHORTCUT_NUMBER)
}

/** tab id -> the number printed on it (1…9). Tabs past the ninth are absent, not zero. */
export function tabNumberMap(
  tabs: NumberableTab[],
  pinnedIds: string[] = []
): Record<string, number> {
  const map: Record<string, number> = {}
  numberableTabs(tabs, pinnedIds).forEach((tab, index) => {
    map[tab.id] = index + 1
  })
  return map
}

/**
 * tab id -> number for a list that is *already in the order it is drawn*.
 *
 * The sidebar groups tabs by state: pinned, then active sessions, then sleeping/discarded ones at the
 * bottom. Numbering off the raw `tabs` array meant the badges froze the moment a tab was discarded —
 * the list read 1, 2, 3, 5, 7, 8, 4, 6 — while the digits still resolved against the same stale map,
 * so the keys worked but the numbers looked broken. Numbering the drawn order fixes both at once: the
 * list always reads 1…N downwards, and the digit that reaches a tab is the number printed on it.
 */
export function tabNumbersForOrder<T extends NumberableTab>(
  orderedTabs: T[],
  max: number = MAX_TAB_SHORTCUT_NUMBER
): Record<string, number> {
  const map: Record<string, number> = {}
  orderedTabs.slice(0, max).forEach((tab, index) => {
    map[tab.id] = index + 1
  })
  return map
}

/** The tab a digit opens from a list that is already in drawn order. */
export function tabForShortcutNumberInOrder<T extends NumberableTab>(
  orderedTabs: T[],
  number: number
): T | null {
  if (!Number.isFinite(number) || number < 1 || number > MAX_TAB_SHORTCUT_NUMBER) return null
  return orderedTabs[number - 1] ?? null
}

/**
 * The tab a digit opens. `number` is 1-based and already checked against the list length, so a
 * stray `Ctrl+7` with five tabs open returns null and the caller can say why.
 */
export function tabForShortcutNumber<T extends NumberableTab>(
  tabs: T[],
  pinnedIds: string[],
  number: number
): T | null {
  if (!Number.isFinite(number) || number < 1 || number > MAX_TAB_SHORTCUT_NUMBER) return null
  // `null` (not `undefined`) is spelled out because callers may pass a list with holes.
  return numberableTabs(tabs, pinnedIds)[number - 1] ?? null
}

/** Same, but restricted to pinned tabs — `Alt+1…9` keeps its old meaning. */
export function pinnedTabForShortcutNumber<T extends NumberableTab>(
  tabs: T[],
  pinnedIds: string[],
  number: number
): T | null {
  if (!Number.isFinite(number) || number < 1) return null
  return tabs.filter((tab) => pinnedIds.includes(tab.id))[number - 1] ?? null
}

/** "Ctrl+4" — used on badges, tooltips and the too-few-tabs hint. */
export function shortcutLabelForTab(number: number): string {
  return `Ctrl+${number}`
}

/** How many tabs a digit can reach right now; the hint quotes it when a digit lands on nothing. */
export function shortcutTabCount(tabs: NumberableTab[], pinnedIds: string[] = []): number {
  return numberableTabs(tabs, pinnedIds).length
}
