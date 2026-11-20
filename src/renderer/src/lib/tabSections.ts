import type { Tab } from './tabs'
import { orderDiscardedTabs } from './tabs'
import type { TabAiStatus } from './tabStatus'

/**
 * How the sidebar list is split into sections.
 *
 * Pulled out of the component because the interesting part is not the JSX — it is the rule that
 * decides which section a tab belongs to, and that rule has to agree with the keyboard
 * navigation order. When pinned tabs get their own section they must not also appear at the top
 * of Active Sessions, or the same tab shows up twice and arrow-key navigation visits it twice.
 *
 * Kept pure so it can be tested without a DOM.
 */

export interface TabSectionsInput {
  tabs: Tab[]
  activeId: string | null
  pinnedIds: string[]
  tabStatuses?: Record<string, TabAiStatus>
  /** Tabs whose view is still in memory. When omitted, active-or-pinned counts as resident. */
  residentTabIds?: string[]
  /** Least-recently-used order for the discarded group. */
  discardedTabIds?: string[]
  /** Pinned tabs get their own section instead of being sorted to the top of Active. */
  pinnedSection?: boolean
}

export interface TabSections {
  pinned: Tab[]
  active: Tab[]
  discarded: Tab[]
  /** What the arrow keys walk through, in render order. */
  order: Tab[]
}

const isResident = (
  tab: Tab,
  activeId: string | null,
  pinnedIds: string[],
  residentTabIds?: string[]
): boolean =>
  residentTabIds
    ? residentTabIds.includes(tab.id)
    : tab.id === activeId || pinnedIds.includes(tab.id)

export function partitionTabSections({
  tabs,
  activeId,
  pinnedIds,
  tabStatuses = {},
  residentTabIds,
  discardedTabIds,
  pinnedSection = false
}: TabSectionsInput): TabSections {
  const pinned: Tab[] = []
  const active: Tab[] = []
  const discarded: Tab[] = []

  for (const tab of tabs) {
    if (pinnedSection && pinnedIds.includes(tab.id)) {
      pinned.push(tab)
      continue
    }

    const isActiveTab = tab.id === activeId
    const isWorkingOrWaiting =
      tabStatuses[tab.id] === 'working' || tabStatuses[tab.id] === 'waiting-input'

    if (isActiveTab || isWorkingOrWaiting || isResident(tab, activeId, pinnedIds, residentTabIds)) {
      active.push(tab)
    } else {
      discarded.push(tab)
    }
  }

  const pinnedFirst = (list: Tab[]): Tab[] => [
    ...list.filter((tab) => pinnedIds.includes(tab.id)),
    ...list.filter((tab) => !pinnedIds.includes(tab.id))
  ]

  const discardedOrdered =
    discardedTabIds && discardedTabIds.length > 0
      ? orderDiscardedTabs(discarded, discardedTabIds)
      : pinnedFirst(discarded)

  return {
    pinned: pinnedFirst(pinned),
    active: pinnedFirst(active),
    discarded: discardedOrdered,
    order: [...pinnedFirst(pinned), ...pinnedFirst(active), ...discardedOrdered]
  }
}
