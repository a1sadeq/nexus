import { join } from 'path'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs'
import {
  type TabDiscardPolicy,
  type TabDiscardStatus,
  DEFAULT_TAB_DISCARD_POLICY,
  validateTabDiscardPolicy,
  validatePartialTabDiscardPolicy
} from '../shared/tabDiscardPolicy'

export interface DiscardableWebContents {
  getURL(): string
  isLoading?(): boolean
  executeJavaScript(code: string): Promise<unknown>
  destroy(): void
  isDestroyed?(): boolean
}

export interface DiscardableView {
  webContents: DiscardableWebContents
  setBounds?(bounds: unknown): void
  setVisible?(visible: boolean): void
}

export interface EvictionTicket {
  id: string
  tabId: string
  viewGeneration: number
  activityRevision: number
  policyRevision: number
  reason: 'idle-timeout' | 'capacity'
  createdAt: number
}

export interface EvictedTabState {
  url: string
  scrollY: number
  timestamp: number
}

export interface TabDiscardManagerOptions {
  getUserDataDir: () => string
  isPinned?: (tabId: string) => boolean
  onTeardown?: (tabId: string, view: DiscardableView) => void
  snapshotTimeoutMs?: number
  idleCheckIntervalMs?: number
  clock?: () => number
}

export class TabDiscardManager {
  private policy: TabDiscardPolicy = { ...DEFAULT_TAB_DISCARD_POLICY }
  private policyRevision = 1
  private activeViewId: string | null = null

  private views = new Map<string, DiscardableView>()
  private lastActivatedAt = new Map<string, number>()
  private backgroundSince = new Map<string, number | null>()
  private viewGenerations = new Map<string, number>()
  private activityRevisions = new Map<string, number>()
  private pendingTickets = new Map<string, EvictionTicket>()
  private evictedTabStates = new Map<string, EvictedTabState>()

  private lastEviction: {
    tabId: string
    reason: 'idle-timeout' | 'capacity'
    timestamp: number
  } | null = null

  private readonly getUserDataDir: () => string
  private readonly isPinned: (tabId: string) => boolean
  private readonly onTeardown: (tabId: string, view: DiscardableView) => void
  private readonly snapshotTimeoutMs: number
  private readonly clock: () => number

  private idleIntervalTimer: NodeJS.Timeout | null = null

  constructor(options: TabDiscardManagerOptions) {
    this.getUserDataDir = options.getUserDataDir
    this.isPinned = options.isPinned || (() => false)
    this.onTeardown = options.onTeardown || ((_id, v) => {
      try {
        if (!v.webContents.isDestroyed?.()) v.webContents.destroy()
      } catch {}
    })
    this.snapshotTimeoutMs = options.snapshotTimeoutMs ?? 1500
    this.clock = options.clock || (() => Date.now())
  }

  public getPolicyFilePath(): string {
    return join(this.getUserDataDir(), 'tab-discard-policy.json')
  }

  public init(): void {
    this.loadPolicyFromDisk()
    this.startIdleTimer()
  }

  public stop(): void {
    if (this.idleIntervalTimer) {
      clearInterval(this.idleIntervalTimer)
      this.idleIntervalTimer = null
    }
  }

  public loadPolicyFromDisk(): void {
    try {
      const filePath = this.getPolicyFilePath()
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, 'utf-8')
        const parsed: unknown = JSON.parse(raw)
        const validated = validateTabDiscardPolicy(parsed)
        if (validated.valid) {
          this.policy = validated.policy
          this.policyRevision++
          return
        }
      }
    } catch (err) {
      console.warn('[TabDiscardManager] Failed to load policy from disk, using defaults:', err)
    }

    this.policy = { ...DEFAULT_TAB_DISCARD_POLICY }
    this.policyRevision++
  }

  public savePolicyToDisk(): boolean {
    try {
      const dir = this.getUserDataDir()
      mkdirSync(dir, { recursive: true })
      const filePath = this.getPolicyFilePath()
      const tempPath = `${filePath}.tmp.${Date.now()}`
      const json = JSON.stringify(this.policy, null, 2)
      writeFileSync(tempPath, json, 'utf-8')
      renameSync(tempPath, filePath)
      return true
    } catch (err) {
      console.error('[TabDiscardManager] Failed to save policy to disk:', err)
      return false
    }
  }

  public getPolicy(): { policy: TabDiscardPolicy; revision: number } {
    return {
      policy: { ...this.policy },
      revision: this.policyRevision
    }
  }

  public setPolicy(
    partial: unknown,
    expectedRevision?: number
  ): { success: boolean; policy: TabDiscardPolicy; revision: number; reason?: string } {
    if (expectedRevision !== undefined && expectedRevision !== this.policyRevision) {
      return {
        success: false,
        policy: { ...this.policy },
        revision: this.policyRevision,
        reason: 'revision_conflict'
      }
    }

    const validated = validatePartialTabDiscardPolicy(partial)
    if (!validated.valid || !validated.updates) {
      return {
        success: false,
        policy: { ...this.policy },
        revision: this.policyRevision,
        reason: validated.error || 'invalid_policy'
      }
    }

    const previousPolicy = { ...this.policy }
    this.policy = {
      ...this.policy,
      ...validated.updates
    }

    const saved = this.savePolicyToDisk()
    if (!saved) {
      this.policy = previousPolicy
      return {
        success: false,
        policy: { ...this.policy },
        revision: this.policyRevision,
        reason: 'disk_write_failed'
      }
    }

    this.policyRevision++

    // If maxActiveTabs was lowered or enabled, reconcile capacity immediately
    if (this.policy.maxActiveTabs > 0) {
      this.reconcileCapacity()
    }

    // If tabDiscardMinutes was changed, check idle timeout
    if (this.policy.tabDiscardMinutes > 0) {
      this.checkIdleTimeout()
    } else {
      // Idle timeout disabled: cancel any pending idle tickets
      for (const [tabId, ticket] of this.pendingTickets.entries()) {
        if (ticket.reason === 'idle-timeout') {
          this.pendingTickets.delete(tabId)
        }
      }
    }

    return {
      success: true,
      policy: { ...this.policy },
      revision: this.policyRevision
    }
  }

  public getStatus(): TabDiscardStatus {
    const residentCount = this.views.size
    const discardedCount = this.evictedTabStates.size
    const pendingCount = this.pendingTickets.size

    let protectedCount = 0
    let eligibleCount = 0

    for (const [tabId, view] of this.views) {
      const isAct = tabId === this.activeViewId
      const isLoad = !!(view.webContents.isLoading && view.webContents.isLoading())
      const isPin = this.isPinned(tabId)
      if (isAct || isLoad || isPin) {
        protectedCount++
      } else {
        eligibleCount++
      }
    }

    let effectiveCapExceeded = false
    let exceededReason: string | undefined

    if (this.policy.maxActiveTabs > 0 && residentCount > this.policy.maxActiveTabs) {
      if (eligibleCount === 0) {
        effectiveCapExceeded = true
        exceededReason = 'All resident background tabs are protected (pinned, loading, or active)'
      }
    }

    return {
      residentCount,
      discardedCount,
      pendingCount,
      protectedCount,
      effectiveCapExceeded,
      exceededReason,
      lastEviction: this.lastEviction ? { ...this.lastEviction } : null,
      policy: { ...this.policy },
      revision: this.policyRevision
    }
  }

  public registerView(tabId: string, view: DiscardableView): void {
    const prevView = this.views.get(tabId)
    if (prevView && prevView !== view) {
      try {
        if (!prevView.webContents.isDestroyed?.()) prevView.webContents.destroy()
      } catch {}
    }

    this.views.set(tabId, view)
    const nextGen = (this.viewGenerations.get(tabId) || 0) + 1
    this.viewGenerations.set(tabId, nextGen)

    const now = this.clock()
    this.lastActivatedAt.set(tabId, now)

    if (tabId === this.activeViewId) {
      this.backgroundSince.set(tabId, null)
    } else {
      this.backgroundSince.set(tabId, now)
    }

    this.activityRevisions.set(tabId, (this.activityRevisions.get(tabId) || 0) + 1)

    // Reconcile capacity
    if (this.policy.maxActiveTabs > 0) {
      this.reconcileCapacity()
    }
  }

  public activateTab(tabId: string): void {
    const prev = this.activeViewId
    const now = this.clock()

    if (prev && prev !== tabId) {
      this.backgroundSince.set(prev, now)
      this.activityRevisions.set(prev, (this.activityRevisions.get(prev) || 0) + 1)
    }

    this.activeViewId = tabId
    this.backgroundSince.set(tabId, null)
    this.lastActivatedAt.set(tabId, now)
    this.activityRevisions.set(tabId, (this.activityRevisions.get(tabId) || 0) + 1)

    // Critical: If the activating tab has an in-flight eviction, cancel it immediately
    if (this.pendingTickets.has(tabId)) {
      this.pendingTickets.delete(tabId)
    }

    if (this.policy.maxActiveTabs > 0) {
      this.reconcileCapacity()
    }
  }

  public onExplicitNavigation(tabId: string): void {
    // Explicit navigation supersedes stale restore state
    this.evictedTabStates.delete(tabId)
    if (this.pendingTickets.has(tabId)) {
      this.pendingTickets.delete(tabId)
    }
  }

  public closeTab(tabId: string): void {
    this.pendingTickets.delete(tabId)
    this.evictedTabStates.delete(tabId)
    this.views.delete(tabId)
    this.lastActivatedAt.delete(tabId)
    this.backgroundSince.delete(tabId)
    this.viewGenerations.delete(tabId)
    this.activityRevisions.delete(tabId)

    if (this.activeViewId === tabId) {
      this.activeViewId = null
    }
  }

  public getEvictedTabState(tabId: string): EvictedTabState | undefined {
    return this.evictedTabStates.get(tabId)
  }

  public consumeEvictedTabState(tabId: string): EvictedTabState | undefined {
    const state = this.evictedTabStates.get(tabId)
    if (state) {
      this.evictedTabStates.delete(tabId)
    }
    return state
  }

  public isTabEvicted(tabId: string): boolean {
    return this.evictedTabStates.has(tabId)
  }

  public getView(tabId: string): DiscardableView | undefined {
    return this.views.get(tabId)
  }

  public hasView(tabId: string): boolean {
    return this.views.has(tabId)
  }

  public getActiveViewId(): string | null {
    return this.activeViewId
  }

  public reconcileCapacity(): void {
    if (this.policy.maxActiveTabs <= 0) return

    // Actual live resident count: views in memory
    const totalResident = this.views.size
    if (totalResident <= this.policy.maxActiveTabs) return

    // Find candidates
    const eligible: Array<{ tabId: string; ts: number }> = []

    for (const [tabId, view] of this.views) {
      // 1. NEVER evict active tab
      if (tabId === this.activeViewId) continue
      // 2. Skip already pending evictions
      if (this.pendingTickets.has(tabId)) continue
      // 3. Skip pinned tabs if possible
      if (this.isPinned(tabId)) continue
      // 4. Skip loading tabs
      if (view.webContents.isLoading && view.webContents.isLoading()) continue

      eligible.push({
        tabId,
        ts: this.lastActivatedAt.get(tabId) || 0
      })
    }

    // Sort oldest first (LRU)
    eligible.sort((a, b) => a.ts - b.ts)

    // Number of tabs to evict = totalResident - maxActiveTabs - currently pending
    const needed = totalResident - this.policy.maxActiveTabs - this.pendingTickets.size
    for (let i = 0; i < needed && i < eligible.length; i++) {
      this.requestEviction(eligible[i].tabId, 'capacity')
    }
  }

  public checkIdleTimeout(): void {
    if (this.policy.tabDiscardMinutes <= 0) return

    const now = this.clock()
    const thresholdMs = this.policy.tabDiscardMinutes * 60 * 1000

    for (const [tabId, view] of this.views) {
      // 1. Never evict active view
      if (tabId === this.activeViewId) continue
      // 2. Never re-evict if pending
      if (this.pendingTickets.has(tabId)) continue
      // 3. Skip loading
      if (view.webContents.isLoading && view.webContents.isLoading()) continue
      // 4. Skip pinned
      if (this.isPinned(tabId)) continue

      const bgSince = this.backgroundSince.get(tabId)
      if (bgSince === null || bgSince === undefined) continue

      const idleDuration = now - bgSince
      if (idleDuration >= thresholdMs) {
        this.requestEviction(tabId, 'idle-timeout')
      }
    }
  }

  public requestEviction(tabId: string, reason: 'idle-timeout' | 'capacity'): boolean {
    const view = this.views.get(tabId)
    if (!view) return false
    if (tabId === this.activeViewId) return false
    if (this.pendingTickets.has(tabId)) return false

    const ticket: EvictionTicket = {
      id: `ticket_${tabId}_${this.clock()}_${Math.random().toString(36).slice(2, 7)}`,
      tabId,
      viewGeneration: this.viewGenerations.get(tabId) || 1,
      activityRevision: this.activityRevisions.get(tabId) || 0,
      policyRevision: this.policyRevision,
      reason,
      createdAt: this.clock()
    }

    this.pendingTickets.set(tabId, ticket)

    // Bounded snapshot promise
    let timer: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<number>((resolve) => {
      timer = setTimeout(() => resolve(0), this.snapshotTimeoutMs)
    })

    let snapshotPromise: Promise<number>
    try {
      snapshotPromise = Promise.resolve(view.webContents.executeJavaScript('window.scrollY'))
        .then((val) => Number(val) || 0)
        .catch(() => 0)
    } catch {
      snapshotPromise = Promise.resolve(0)
    }

    Promise.race([snapshotPromise, timeoutPromise])
      .then((scrollY) => {
        if (timer) clearTimeout(timer)
        this.commitEviction(ticket, view, scrollY)
      })
      .catch(() => {
        if (timer) clearTimeout(timer)
        this.commitEviction(ticket, view, 0)
      })

    return true
  }

  public commitEviction(ticket: EvictionTicket, view: DiscardableView, scrollY: number): boolean {
    const tabId = ticket.tabId

    // 1. Revalidate ticket ownership
    const currentTicket = this.pendingTickets.get(tabId)
    if (!currentTicket || currentTicket.id !== ticket.id) {
      return false
    }

    // 2. CRITICAL: Revalidate that tab is NOT active
    if (tabId === this.activeViewId) {
      this.pendingTickets.delete(tabId)
      return false
    }

    // 3. Revalidate view mapping
    const mappedView = this.views.get(tabId)
    if (!mappedView || mappedView !== view) {
      this.pendingTickets.delete(tabId)
      return false
    }

    // 4. Revalidate generation and activity revision
    const curGen = this.viewGenerations.get(tabId)
    const curAct = this.activityRevisions.get(tabId)
    if (curGen !== ticket.viewGeneration || curAct !== ticket.activityRevision) {
      this.pendingTickets.delete(tabId)
      return false
    }

    // 5. Revalidate policy relevance
    if (ticket.reason === 'idle-timeout' && this.policy.tabDiscardMinutes <= 0) {
      this.pendingTickets.delete(tabId)
      return false
    }
    if (ticket.reason === 'capacity') {
      if (this.policy.maxActiveTabs <= 0 || this.views.size <= this.policy.maxActiveTabs) {
        this.pendingTickets.delete(tabId)
        return false
      }
    }

    // Commit eviction: save state and teardown
    let url = ''
    try {
      url = view.webContents.getURL()
    } catch {}

    this.evictedTabStates.set(tabId, {
      url,
      scrollY,
      timestamp: this.clock()
    })

    // Execute teardown
    try {
      this.onTeardown(tabId, view)
    } catch (err) {
      console.warn(`[TabDiscardManager] Teardown warning for ${tabId}:`, err)
    }

    // Clean up tracking
    this.views.delete(tabId)
    this.lastActivatedAt.delete(tabId)
    this.backgroundSince.delete(tabId)
    this.pendingTickets.delete(tabId)

    this.lastEviction = {
      tabId,
      reason: ticket.reason,
      timestamp: this.clock()
    }

    return true
  }

  private startIdleTimer(): void {
    if (this.idleIntervalTimer) return
    this.idleIntervalTimer = setInterval(() => {
      this.checkIdleTimeout()
    }, 30000)
    // unref so timer doesn't prevent process exit if running in node
    if (typeof this.idleIntervalTimer.unref === 'function') {
      this.idleIntervalTimer.unref()
    }
  }
}
