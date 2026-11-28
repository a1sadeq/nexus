import type { Tab } from './tabs'
import { sanitiseTabColors } from './tabColors'

/**
 * What a tab *was*, remembered by address.
 *
 * Pinned state, both colours and a place in the list belong to the thing the tab points at — "my
 * Claude review tab, violet, third from the top" — not to the row that happens to be on screen. Closing
 * a tab and opening the same conversation again used to produce a brand new row: unpinned, uncoloured,
 * at the bottom of the list. The same was true after a restart for any tab whose row was recreated.
 *
 * So the state is stored against the tab's address, not its id (ids are per-session and deliberately
 * random), and applied whenever a tab with that address appears. Addresses are normalised first: the
 * same conversation reached from history, from a restored session and from a pasted link has to land on
 * the same key, or the memory is only ever right by luck.
 *
 * Nothing here is allowed to invent state: a colour from disk is re-validated through the same gate the
 * picker uses, a position outside the list is ignored, and a missing entry changes nothing at all.
 */

export const TAB_MEMORY_STORAGE_KEY = 'nexus.tabMemory.v1'

/** How many remembered addresses to keep. The oldest fall off the end. */
export const TAB_MEMORY_LIMIT = 300

export interface TabMemoryEntry {
  /** The normalised address this entry describes. Stored so the record is self-describing. */
  key: string
  pinned: boolean
  accentColor?: string
  auraColor?: string
  /** Zero-based place in the flat tab list, as it was when the tab was last seen. */
  position: number
  updatedAt: number
}

export type TabMemory = Record<string, TabMemoryEntry>

/**
 * The address without the parts that vary between two visits to the same page.
 *
 * Fragment dropped (it is where a page puts its own state), trailing slash dropped, scheme and host
 * lower-cased, `www.` dropped. Query strings are kept — providers do use them to identify a
 * conversation, and losing that would merge two different chats into one memory.
 */
export function memoryKeyForUrl(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return ''
  let text = raw.trim()
  if (!text) return ''
  const hash = text.indexOf('#')
  if (hash >= 0) text = text.slice(0, hash)
  try {
    const url = new URL(text)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = url.pathname.replace(/\/+$/, '')
    const search = url.search
    return `${url.protocol.toLowerCase()}//${host}${path}${search}`
  } catch {
    // Not a URL we can parse — keep something stable rather than dropping the memory.
    return text.toLowerCase().replace(/\/+$/, '')
  }
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

/** Read the stored memory, discarding anything that does not survive validation. */
export function readTabMemory(raw: string | null | undefined): TabMemory {
  if (!raw || typeof raw !== 'string') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: TabMemory = {}
  for (const [rawKey, rawEntry] of Object.entries(parsed as Record<string, unknown>)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue
    const entry = rawEntry as Record<string, unknown>
    const key = memoryKeyForUrl(typeof entry.key === 'string' ? entry.key : rawKey)
    if (!key) continue
    const colours = sanitiseTabColors({
      accentColor: typeof entry.accentColor === 'string' ? entry.accentColor : undefined,
      auraColor: typeof entry.auraColor === 'string' ? entry.auraColor : undefined
    })
    const record: TabMemoryEntry = {
      key,
      pinned: entry.pinned === true,
      position: asCount(entry.position),
      updatedAt: typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0
    }
    if (colours.accentColor) record.accentColor = colours.accentColor
    if (colours.auraColor) record.auraColor = colours.auraColor
    out[key] = record
  }
  return out
}

export function serializeTabMemory(memory: TabMemory): string {
  return JSON.stringify(memory)
}

/**
 * Fold the tabs that are open now into the memory.
 *
 * Entries for addresses that are not open are kept — that is the whole point, since the state has to
 * outlive the row — and the oldest are trimmed once the map grows past {@link TAB_MEMORY_LIMIT}.
 */
export function rememberTabs(
  memory: TabMemory,
  tabs: Tab[],
  pinnedIds: string[],
  now: number = Date.now()
): TabMemory {
  const next: TabMemory = { ...memory }
  const pinned = new Set(pinnedIds)
  tabs.forEach((tab, index) => {
    const key = memoryKeyForUrl(tab.url)
    if (!key) return
    const entry: TabMemoryEntry = {
      key,
      pinned: pinned.has(tab.id),
      position: index,
      updatedAt: now
    }
    const colours = sanitiseTabColors(tab)
    // A tab with no colour of its own must not erase a colour it has not been given yet — a freshly
    // restored row is colourless for a moment before the effect that adopts the memory runs.
    const previous = next[key]
    const accentColor = colours.accentColor ?? previous?.accentColor
    const auraColor = colours.auraColor ?? previous?.auraColor
    if (accentColor) entry.accentColor = accentColor
    if (auraColor) entry.auraColor = auraColor
    next[key] = entry
  })

  const entries = Object.values(next)
  if (entries.length <= TAB_MEMORY_LIMIT) return next
  const trimmed: TabMemory = {}
  entries
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, TAB_MEMORY_LIMIT)
    .forEach((entry) => {
      trimmed[entry.key] = entry
    })
  return trimmed
}

/**
 * What a newly seen tab should inherit: its colours, and whether it belongs in the pinned list.
 *
 * Returns a *new* tab object (never mutates) and reports `pinned` separately, because pinning is kept in
 * its own list keyed by tab id.
 */
export function adoptTabMemory(
  tab: Tab,
  memory: TabMemory
): { tab: Tab; pinned: boolean; position: number | null } {
  const entry = memory[memoryKeyForUrl(tab.url)]
  if (!entry) return { tab, pinned: false, position: null }
  const colours = sanitiseTabColors({
    accentColor: entry.accentColor ?? tab.accentColor,
    auraColor: entry.auraColor ?? tab.auraColor
  })
  const next: Tab = { ...tab }
  if (colours.accentColor) next.accentColor = colours.accentColor
  if (colours.auraColor) next.auraColor = colours.auraColor
  return { tab: next, pinned: entry.pinned, position: entry.position }
}

/**
 * Put a tab back where it was, if that place still exists.
 *
 * Moving is a splice: the position is clamped to the list, so a tab remembered at 7 in a list that is
 * now three long goes to the end rather than nowhere. Pinned tabs are hoisted by the sidebar itself, so
 * their position is only meaningful against the tab array.
 */
export function applyRememberedPosition(tabs: Tab[], tabId: string, position: number | null): Tab[] {
  if (position === null || !Number.isFinite(position)) return tabs
  const from = tabs.findIndex((tab) => tab.id === tabId)
  if (from < 0) return tabs
  const target = Math.max(0, Math.min(Math.floor(position), tabs.length - 1))
  if (target === from) return tabs
  const next = [...tabs]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return next
}
