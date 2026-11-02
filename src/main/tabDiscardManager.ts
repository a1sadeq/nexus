import { closeWebContents, type ClosableContents } from './webContentsLifecycle'

import { join } from 'path'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs'
import {
  type TabDiscardPolicy,
  type TabDiscardStatus,
  DEFAULT_TAB_DISCARD_POLICY,
  validateTabDiscardPolicy,
  validatePartialTabDiscardPolicy,
  isUsableRestoreUrl
} from '../shared/tabDiscardPolicy'

export { isUsableRestoreUrl }

export interface DiscardableWebContents extends ClosableContents {
  getURL(): string
  isLoading?(): boolean
  executeJavaScript(code: string): Promise<unknown>
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
  onTeardown?: (tabId: string, view: DiscardableView, contents: DiscardableWebContents) => void | Promise<void>
  snapshotTimeoutMs?: number
  idleCheckIntervalMs?: number
  clock?: () => number
}

export class TabDiscardManager {
  private policy: TabDiscardPolicy = { ...DEFAULT_TAB_DISCARD_POLICY }
  private policyRevision = 1
  private activeViewId: string | null = null

  private views = new Map<string, DiscardableView>()
  // Native View accessors may become unavailable after WebContents closes.
  // Retain the exact owned contents until teardown/accounting has completed.
  private contents = new Map<string, DiscardableWebContents>()
  private unavailable = new Set<string>()
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
  private readonly onTeardown: (tabId: string, view: DiscardableView, contents: DiscardableWebContents) => void | Promise<void>
  private readonly snapshotTimeoutMs: number
  private readonly clock: () => number

  private readonly idleCheckIntervalMs: number
  private closing = new Map<string, Promise<void>>()
  private retryAfter = new Map<string, number>()
  private lastTeardownError: string | null = null

  private idleIntervalTimer: NodeJS.Timeout | null = null

  constructor(options: TabDiscardManagerOptions) {
    this.getUserDataDir = options.getUserDataDir
    this.isPinned = options.isPinned || (() => false)
    this.onTeardown = options.onTeardown || ((_id, _view, contents) => closeWebContents(contents))
    this.idleCheckIntervalMs = Math.max(1000, options.idleCheckIntervalMs ?? 30000)
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
      const isLoad = this.loadingOrUnavailable(tabId, view)
      const isPin = this.isPinned(tabId)
      const isNoRestore = !this.hasUsableRestoreUrl(tabId, view)
      if (isAct || isLoad || isPin || isNoRestore) {
        protectedCount++
      } else {
        eligibleCount++
      }
    }

    let effectiveCapExceeded = this.policy.maxActiveTabs > 0 && residentCount > this.policy.maxActiveTabs
    let exceededReason: string | undefined

    if (this.policy.maxActiveTabs > 0 && residentCount > this.policy.maxActiveTabs) {
      if (eligibleCount === 0) {
        effectiveCapExceeded = true
        exceededReason = 'All resident background tabs are protected (pinned, loading, active, or missing restore URL)'
      }
    }

    return {
      residentCount,
      discardedCount,
      pendingCount,
      protectedCount,
      effectiveCapExceeded,
      exceededReason,
      lastTeardownError: this.lastTeardownError,
      closingCount: this.closing.size,
      unavailableCount: this.unavailable.size,
      lastEviction: this.lastEviction ? { ...this.lastEviction } : null,
      policy: { ...this.policy },
      revision: this.policyRevision
    }
  }

  public registerView(tabId: string, view: DiscardableView): void {
    if (this.closing.has(tabId)) throw new Error('Wait for native close before registering a new view')
    const incoming = view?.webContents
    if (!incoming || incoming.isDestroyed()) throw new Error('Cannot register unavailable WebContents')
    const prevView = this.views.get(tabId)
    if (prevView && prevView !== view) {
      const previous = this.knownContents(tabId, prevView)
      if (!previous || !previous.isDestroyed()) {
        throw new Error('Close the previous live view before replacing it')
      }
    }

    this.views.set(tabId, view)
    this.contents.set(tabId, incoming)
    this.unavailable.delete(tabId)
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
    if (!this.closing.has(tabId)) this.pendingTickets.delete(tabId)

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

  public waitForClose(tabId: string): Promise<void> {
    return this.closing.get(tabId) || Promise.resolve()
  }

  public async closeTab(tabId: string): Promise<boolean> {
    const requestedView = this.views.get(tabId)
    this.pendingTickets.delete(tabId)
    if (this.activeViewId === tabId) {
      this.activeViewId = null
      this.backgroundSince.set(tabId, this.clock())
    }
    await this.waitForClose(tabId)
    if (this.closing.has(tabId)) return this.closeTab(tabId)
    const view = this.views.get(tabId)
    if (view !== requestedView) return true // A prior request already closed/replaced it.
    const forget = () => {
      this.evictedTabStates.delete(tabId)
      this.views.delete(tabId)
      this.contents.delete(tabId)
      this.unavailable.delete(tabId)
      this.lastActivatedAt.delete(tabId)
      this.backgroundSince.delete(tabId)
      this.viewGenerations.delete(tabId)
      this.activityRevisions.delete(tabId)
      this.retryAfter.delete(tabId)
      if (this.activeViewId === tabId) this.activeViewId = null
    }
    if (view) {
      if (!await this.teardown(tabId, view, forget)) return false
    } else forget()
    this.reconcileCapacity()
    return true
  }

  // Resolve waiters on either success or failure; failure retains resident state.
  private async teardown(tabId: string, view: DiscardableView, onSuccess: () => void): Promise<boolean> {
    let release!: () => void
    const completion = new Promise<void>((resolve) => { release = resolve })
    this.closing.set(tabId, completion)
    try {
      const contents = this.knownContents(tabId, view)
      if (!contents) throw new Error('WebContents unavailable; resource remains tracked')
      await this.onTeardown(tabId, view, contents)
      // Do not re-read view.webContents after close invalidates its accessor.
      if (!contents.isDestroyed()) {
        throw new Error('Teardown returned without destroying WebContents')
      }
      this.lastTeardownError = null
      onSuccess()
      return true
    } catch (error) {
      this.lastTeardownError = `Tab ${tabId}: ${String(error)}`
      this.retryAfter.set(tabId, this.clock() + 30000)
      console.warn('[TabDiscardManager]', this.lastTeardownError)
      return false
    } finally {
      this.pendingTickets.delete(tabId)
      this.closing.delete(tabId)
      release()
    }
  }

  private knownContents(tabId: string, view: DiscardableView | undefined): DiscardableWebContents | undefined {
    if (this.views.get(tabId) === view && this.contents.has(tabId)) return this.contents.get(tabId)
    try { return view?.webContents } catch { return undefined }
  }

  private loadingOrUnavailable(tabId: string, view: DiscardableView | undefined): boolean {
    try {
      const contents = this.knownContents(tabId, view)
      if (!contents || contents.isDestroyed()) {
        this.unavailable.add(tabId)
        return true
      }
      const loading = !!contents.isLoading?.()
      this.unavailable.delete(tabId)
      return loading
    } catch {
      // Native wrappers can become invalid during teardown. Skip this entry;
      // do not erase ownership or manufacture successful eviction state.
      this.unavailable.add(tabId)
      return true
    }
  }

  private hasUsableRestoreUrl(tabId: string, view: DiscardableView | undefined): boolean {
    try {
      const contents = this.knownContents(tabId, view)
      if (!contents || contents.isDestroyed()) return false
      const url = contents.getURL()
      return isUsableRestoreUrl(url)
    } catch {
      return false
    }
  }

  private protectedFromEviction(tabId: string, view: DiscardableView | undefined): boolean {
    return tabId === this.activeViewId || this.pendingTickets.has(tabId) ||
      this.closing.has(tabId) || this.isPinned(tabId) || this.loadingOrUnavailable(tabId, view) ||
      !this.hasUsableRestoreUrl(tabId, view) ||
      (this.retryAfter.get(tabId) ?? 0) > this.clock()
  }

  public getUsableRestoreUrl(tabId: string, fallbackUrl?: string | null): string | null {
    const saved = this.evictedTabStates.get(tabId)
    if (saved && isUsableRestoreUrl(saved.url)) {
      return saved.url
    }
    if (fallbackUrl && isUsableRestoreUrl(fallbackUrl)) {
      return fallbackUrl
    }
    return null
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
      if (this.protectedFromEviction(tabId, view)) continue

      eligible.push({
        tabId,
        ts: this.lastActivatedAt.get(tabId) || 0
      })
    }

    // Sort oldest first (LRU)
    eligible.sort((a, b) => a.ts - b.ts)

    // Number of tabs to evict = totalResident - maxActiveTabs - currently pending
    const reserved = new Set([...this.pendingTickets.keys(), ...this.closing.keys()])
    const pendingResident = [...reserved].filter(id => this.views.has(id)).length
    const needed = totalResident - this.policy.maxActiveTabs - pendingResident
    for (let i = 0; i < needed && i < eligible.length; i++) {
      this.requestEviction(eligible[i].tabId, 'capacity')
    }
  }

  public checkIdleTimeout(): void {
    if (this.policy.tabDiscardMinutes <= 0) return

    const now = this.clock()
    const thresholdMs = this.policy.tabDiscardMinutes * 60 * 1000

    for (const [tabId, view] of this.views) {
      if (this.protectedFromEviction(tabId, view)) continue

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
    if (!view || this.protectedFromEviction(tabId, view)) return false
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
      const contents = this.knownContents(tabId, view)
      if (!contents) throw new Error('WebContents unavailable during snapshot')
      snapshotPromise = Promise.resolve(contents.executeJavaScript('window.scrollY'))
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

    // Loading/pinning, unavailable wrapper, or unusable URL may change during the snapshot.
    const bgSince = this.backgroundSince.get(tabId)
    if (this.isPinned(tabId) || this.loadingOrUnavailable(tabId, view) ||
        !this.hasUsableRestoreUrl(tabId, view) ||
        (ticket.reason === 'idle-timeout' && (this.policy.tabDiscardMinutes <= 0 ||
         bgSince == null || this.clock() - bgSince < this.policy.tabDiscardMinutes * 60000))) {
      this.pendingTickets.delete(tabId)
      return false
    }
    if (ticket.reason === 'capacity') {
      const closingResident = [...this.closing.keys()].filter(id => this.views.has(id)).length
      if (this.policy.maxActiveTabs <= 0 || this.views.size - closingResident <= this.policy.maxActiveTabs) {
        this.pendingTickets.delete(tabId)
        return false
      }
    }

    // Commit eviction: save state and teardown
    let url = ''
    try {
      url = this.knownContents(tabId, view)?.getURL() || ''
    } catch {}

    if (!isUsableRestoreUrl(url)) {
      this.pendingTickets.delete(tabId)
      return false
    }

    const state = { url, scrollY, timestamp: this.clock() }
    void this.teardown(tabId, view, () => {
      if (this.views.get(tabId) !== view) return
      this.pendingTickets.delete(tabId)
      this.evictedTabStates.set(tabId, state)
      this.views.delete(tabId)
      this.contents.delete(tabId)
      this.unavailable.delete(tabId)
      this.lastActivatedAt.delete(tabId)
      this.backgroundSince.delete(tabId)
      this.retryAfter.delete(tabId)
      this.lastEviction = { tabId, reason: ticket.reason, timestamp: this.clock() }
      this.reconcileCapacity()
    })

    return true
  }

  private startIdleTimer(): void {
    if (this.idleIntervalTimer) return
    this.idleIntervalTimer = setInterval(() => {
      this.reconcileCapacity()
      this.checkIdleTimeout()
    }, this.idleCheckIntervalMs)
    // unref so timer doesn't prevent process exit if running in node
    if (typeof this.idleIntervalTimer.unref === 'function') {
      this.idleIntervalTimer.unref()
    }
  }
}

