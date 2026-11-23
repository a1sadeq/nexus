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

export function insetRectForAura(rect: Rect, hasColor: boolean): Rect {
  if (!hasColor) return rect
  // Never produce a negative or vanishing area: a tiny window would otherwise hide the view.
  const width = Math.max(1, rect.width - AURA_RING_INSET * 2)
  const height = Math.max(1, rect.height - AURA_RING_INSET * 2)
  return {
    x: rect.x + AURA_RING_INSET,
    y: rect.y + AURA_RING_INSET,
    width,
    height
  }
}

/** Inline styles for the ring — a border plus a soft outer glow in the container's colour. */
export function auraRingStyle(color: string | undefined): Record<string, string> {
  const hex = normaliseHexColor(color)
  if (!hex) return {}
  const glow = hexToRgba(hex, 0.34)
  const soft = hexToRgba(hex, 0.12)
  return {
    boxShadow: `inset 0 0 0 1px ${glow}, inset 0 0 ${AURA_RING_INSET * 3}px ${soft}`,
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
