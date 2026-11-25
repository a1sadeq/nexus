import { normaliseHexColor, TAB_COLOR_PRESETS } from './tabColors'

/**
 * Containers, as the UI understands them.
 *
 * A container is a named, coloured workspace bound to one Google account, so two accounts are never
 * mixed and every tab says where it belongs. This module holds the parts that can be reasoned about
 * without Electron: which container a tab is in, what colour to paint, how a shortcut maps to a
 * container, and how the aura ring is sized.
 */

export const DEFAULT_CONTAINER_ID = 'default'

export interface ContainerInfo {
  id: string
  name: string
  color?: string
  accountId: string
  createdAt: number
}

export function defaultContainerInfo(): ContainerInfo {
  return { id: DEFAULT_CONTAINER_ID, name: 'Default', accountId: 'default', createdAt: 0 }
}

/** Same palette as tabs: one set of colours to learn, and all of them safe in CSS. */
export const CONTAINER_COLOR_PRESETS = TAB_COLOR_PRESETS

export function containerColorOf(container: ContainerInfo | null | undefined): string | undefined {
  return normaliseHexColor(container?.color)
}

export function containerNameOf(container: ContainerInfo | null | undefined): string {
  return container?.name?.trim() || 'Default'
}

/** The container a tab belongs to, falling back to the default one for older tabs. */
export function containerIdOf(tab: { containerId?: string } | null | undefined): string {
  const id = tab?.containerId
  return typeof id === 'string' && id ? id : DEFAULT_CONTAINER_ID
}

export function findContainer(
  containers: ContainerInfo[],
  containerId: string | null | undefined
): ContainerInfo {
  const id = containerId || DEFAULT_CONTAINER_ID
  return containers.find((c) => c.id === id) ?? defaultContainerInfo()
}

/**
 * Shortcut numbering: container 1 is the first in the list (the default one), and the list order is
 * what `Ctrl+Alt+N` uses. 0 is accepted as "the first container" so both habits work.
 */
/**
 * Moves one container up or down the list, for the containers section.
 *
 * The list *is* the numbering — `Ctrl+Alt+N` opens the Nth — so moving a row also changes which key
 * reaches it, and the panel says so rather than hiding it. A move that would fall off either end
 * returns the list unchanged, so the caller can call this without checking first.
 */
export function moveContainerInList(
  containers: ContainerInfo[],
  containerId: string,
  delta: number
): ContainerInfo[] {
  const from = containers.findIndex((c) => c.id === containerId)
  if (from < 0 || !Number.isFinite(delta) || delta === 0) return containers
  const to = from + Math.trunc(delta)
  if (to < 0 || to >= containers.length || to === from) return containers
  const next = containers.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** Whether the row has somewhere to go, so the buttons can be disabled instead of doing nothing. */
export function canMoveContainerInList(
  containers: ContainerInfo[],
  containerId: string,
  delta: number
): boolean {
  const from = containers.findIndex((c) => c.id === containerId)
  if (from < 0) return false
  const to = from + Math.trunc(delta)
  return Number.isFinite(to) && to >= 0 && to < containers.length && to !== from
}

export function containerForShortcutIndex(
  containers: ContainerInfo[],
  index: number
): ContainerInfo | null {
  if (!Number.isFinite(index) || index < 1) return null
  return containers[index - 1] ?? null
}

export function shortcutLabelForIndex(index: number): string {
  return index === 1 ? 'Ctrl+Alt+1 (or 0)' : `Ctrl+Alt+${index}`
}

/** How many containers a shortcut can reach: nine digits plus the zero alias. */
export const MAX_SHORTCUT_CONTAINERS = 9

export function tabCountsByContainer(
  tabs: Array<{ containerId?: string }>
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const tab of tabs) {
    const id = containerIdOf(tab)
    counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
}

/**
 * The ring is drawn in the space the native view does not cover, so the view has to be inset by the
 * ring's width. Returning a rect keeps that arithmetic in one tested place instead of in JSX.
 */
export const AURA_RING_INSET = 6

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Aura strength, as a percentage of the default ring.
 *
 * 0 turns the ring off entirely (the page goes flush to the window edge), 100 is the ring as it always
 * looked, and the range keeps going to 300 so a container can be made obviously louder than the others.
 * Above 100 the ring grows *outwards* — a wider band of colour and a longer glow — instead of only
 * getting more opaque, because a fully opaque 6px line is still a thin line.
 */
export const DEFAULT_CONTAINER_AURA_STRENGTH = 100
export const MAX_CONTAINER_AURA_STRENGTH = 300

export function normaliseAuraStrength(strength: number | undefined | null): number {
  if (typeof strength !== 'number' || !Number.isFinite(strength)) return DEFAULT_CONTAINER_AURA_STRENGTH
  return Math.max(0, Math.min(MAX_CONTAINER_AURA_STRENGTH, Math.round(strength)))
}

/** How wide the ring is, in px, at the requested strength. 0 means "no ring at all". */
export function auraRingWidth(strength: number | undefined | null): number {
  const pct = normaliseAuraStrength(strength)
  if (pct === 0) return 0
  // 100% → the historical 6 px. Below that it thins out; above it it grows, but sub-linearly so 300%
  // frames the page instead of eating it.
  const scaled = pct <= 100 ? (AURA_RING_INSET * pct) / 100 : AURA_RING_INSET + (pct - 100) * 0.06
  return Math.max(pct === 0 ? 0 : 1, Math.round(scaled))
}

/**
 * The rect the native view gets. The ring is drawn in the space the view leaves free, so a stronger
 * ring means a smaller view — that arithmetic stays here, in one tested place, instead of in JSX.
 */
export function insetRectForAura(
  rect: Rect,
  hasColor: boolean,
  strength: number | undefined | null = DEFAULT_CONTAINER_AURA_STRENGTH
): Rect {
  if (!hasColor) return rect
  const inset = auraRingWidth(strength)
  if (inset <= 0) return rect
  // Never produce a negative or vanishing area: a tiny window would otherwise hide the view.
  const width = Math.max(1, rect.width - inset * 2)
  const height = Math.max(1, rect.height - inset * 2)
  return {
    x: rect.x + inset,
    y: rect.y + inset,
    width,
    height
  }
}

/**
 * The ring itself: a border plus an inner glow in the container's colour.
 *
 * Two alphas were hardcoded here (0.34 and 0.12) and again, differently, in `App.tsx` — so the veil the
 * user saw and the helper the tests covered were not the same thing. Both now come from this function,
 * scaled by the same strength that decides the width.
 */
export function auraRingStyle(
  color: string | undefined,
  strength: number | undefined | null = DEFAULT_CONTAINER_AURA_STRENGTH
): Record<string, string> {
  const hex = normaliseHexColor(color)
  if (!hex) return {}
  const pct = normaliseAuraStrength(strength)
  if (pct === 0) return {}
  const width = auraRingWidth(pct)
  const factor = pct / 100
  const glow = hexToRgba(hex, Math.min(0.9, 0.34 * factor))
  const soft = hexToRgba(hex, Math.min(0.6, 0.12 * factor))
  const spread = Math.max(1, Math.round(width * 4.3))
  return {
    boxShadow: `inset 0 0 0 ${Math.max(1, Math.round(width * 0.17))}px ${glow}, inset 0 0 ${spread}px ${soft}`,
    borderColor: glow,
    backgroundImage: `radial-gradient(circle at 50% 0%, ${soft}, transparent 70%)`
  }
}

export function hexToRgba(hex: string, alpha: number): string {
  const value = normaliseHexColor(hex)
  if (!value) return `rgba(0, 0, 0, ${alpha})`
  const r = parseInt(value.slice(1, 3), 16)
  const g = parseInt(value.slice(3, 5), 16)
  const b = parseInt(value.slice(5, 7), 16)
  const a = Math.min(1, Math.max(0, alpha))
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** What a tab strip prints next to a tab: colour dot plus the container's name. */
export function tabContainerMark(
  tab: { containerId?: string },
  containers: ContainerInfo[]
): { color?: string; name: string; isDefault: boolean } {
  const id = containerIdOf(tab)
  const container = findContainer(containers, id)
  return {
    color: containerColorOf(container),
    name: containerNameOf(container),
    isDefault: id === DEFAULT_CONTAINER_ID
  }
}
