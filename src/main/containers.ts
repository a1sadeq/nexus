import { existsSync, fsyncSync, openSync, closeSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

import { sanitiseAccountId, partitionForAccount, DEFAULT_ACCOUNT_ID } from './googleAccounts'

/**
 * Containers: named, coloured, and each bound to one Google account.
 *
 * A container is the unit the user sees — "Work", "Personal", "Client X" — and its cookie store is
 * the one belonging to the account it points at. Two containers may share an account (same sign-in,
 * separate workspaces); the partition is per account, so that costs nothing.
 *
 * The default container is implicit and keeps the historical partition (`persist:ai-shared`), so
 * every tab that existed before containers still lands where it always did.
 */

export const DEFAULT_CONTAINER_ID = 'default'
export const MAX_CONTAINER_NAME = 40
/** Colours are injected into CSS in both processes; hex only, checked here as well as in the UI. */
export const CONTAINER_COLOR_PATTERN = /^#(?:[0-9a-f]{6})$/i

export interface ContainerRecord {
  id: string
  name: string
  /** Absent means "no colour": the view keeps the provider's aura and no ring is drawn. */
  color?: string
  /** Which Google account's cookie store this container uses. */
  accountId: string
  createdAt: number
}

export function normaliseContainerColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const raw = value.trim().toLowerCase()
  const body = raw.startsWith('#') ? raw.slice(1) : raw
  if (body.length === 3 && /^[0-9a-f]{3}$/.test(body)) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
  }
  if (body.length === 6 && /^[0-9a-f]{6}$/.test(body)) return `#${body}`
  if (body.length === 8 && /^[0-9a-f]{8}$/.test(body)) return `#${body.slice(0, 6)}`
  return undefined
}

/**
 * Colours handed to containers that were created for an account rather than by hand, in the order
 * accounts appear. Same hexes as the picker, so a generated colour is indistinguishable from a chosen
 * one and can be changed later without anything else moving.
 */
export const CONTAINER_PALETTE = [
  '#f43f5e', '#f59e0b', '#84cc16', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#6366f1',
  '#8b5cf6', '#d946ef', '#ec4899', '#ef4444', '#f97316', '#eab308', '#64748b', '#e2e8f0'
] as const

export function paletteColorAt(index: number): string {
  const palette = CONTAINER_PALETTE
  // Negative and absurd indexes still land inside the palette.
  const i = ((Math.trunc(index) % palette.length) + palette.length) % palette.length
  return palette[i]
}

export function defaultContainer(): ContainerRecord {
  return { id: DEFAULT_CONTAINER_ID, name: 'Default', accountId: DEFAULT_ACCOUNT_ID, createdAt: 0 }
}

/** Ids end up in partition names, so they are derived from the name and kept to the same alphabet. */
export function containerIdFromName(name: string): string | null {
  const id = sanitiseAccountId(name)
  if (!id || id === DEFAULT_CONTAINER_ID) return null
  return id
}

export function containerPartition(container: Pick<ContainerRecord, 'accountId'> | null | undefined): string {
  return partitionForAccount(container?.accountId ?? DEFAULT_ACCOUNT_ID)
}

/**
 * Which container a `Ctrl+Alt+<digit>` press means. 1-based, positionally, and `0` is an alias for
 * the first (the default container) so both habits work. Returns null for a digit with no container —
 * the caller tells the user rather than opening something they did not ask for.
 */
export function containerForShortcutDigit(
  list: ContainerRecord[],
  digit: string
): ContainerRecord | null {
  if (!/^\d$/.test(digit)) return null
  const wanted = digit === '0' ? 1 : Number(digit)
  return list[wanted - 1] ?? null
}

/** Position shown next to a container: the number its keyboard shortcut uses. 1-based. */
export function containerShortcutIndex(list: ContainerRecord[], containerId: string): number {
  const index = list.findIndex((c) => c.id === containerId)
  return index < 0 ? 0 : index + 1
}

interface ContainersFile {
  version: 1
  containers: Array<Pick<ContainerRecord, 'id' | 'name' | 'color' | 'accountId' | 'createdAt'>>
  /**
   * Accounts whose container the user deleted on purpose. Without this, a container that exists only
   * because its account does would be recreated on the next list — deleting it would look broken.
   */
  ignoredAccounts?: string[]
  /**
   * Display order, by id, and it may include `default` — the container the user drags to the top is
   * the one `Ctrl+Alt+1` opens, and that has to be true for Default as well or the numbering would
   * disagree with the list the user is looking at. Absent means "never reordered": Default first,
   * then creation order, which is exactly what every older file says.
   */
  order?: string[]
}

export class ContainerStore {
  constructor(
    private readonly filePath: string,
    private readonly now: () => number = () => Date.now()
  ) {}

  private readFile(): ContainersFile {
    if (!existsSync(this.filePath)) return { version: 1, containers: [], ignoredAccounts: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<ContainersFile>
      const list = Array.isArray(parsed?.containers) ? parsed.containers : []
      const seen = new Set<string>([DEFAULT_CONTAINER_ID])
      const kept: ContainersFile['containers'] = []
      for (const entry of list) {
        if (!entry || typeof entry.id !== 'string') continue
        const id = sanitiseAccountId(entry.id)
        // A stored default would duplicate the implicit one; a malformed id could not be a partition.
        if (!id || id === DEFAULT_CONTAINER_ID || seen.has(id)) continue
        seen.add(id)
        const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id
        const record: ContainersFile['containers'][number] = {
          id,
          name: name.slice(0, MAX_CONTAINER_NAME),
          accountId: sanitiseAccountId(entry.accountId ?? '') ?? DEFAULT_ACCOUNT_ID,
          createdAt: entry.createdAt ?? 0
        }
        // Only carry the key when there is a colour: a cleared colour must serialise like one that
        // was never set, and `'color' in record` is what the UI checks.
        const color = normaliseContainerColor(entry.color)
        if (color) record.color = color
        kept.push(record)
      }
      const ignored = Array.isArray(parsed?.ignoredAccounts)
        ? parsed.ignoredAccounts.filter(
            (id): id is string => typeof id === 'string' && !!sanitiseAccountId(id)
          )
        : []
      const order = Array.isArray(parsed?.order)
        ? parsed.order.filter((id): id is string => typeof id === 'string')
        : undefined
      const file: ContainersFile = { version: 1, containers: kept, ignoredAccounts: ignored }
      if (order) file.order = order
      return file
    } catch {
      // A corrupt file costs the extra containers, never the default one, and never a crash on boot.
      return { version: 1, containers: [], ignoredAccounts: [] }
    }
  }

  private writeFile(data: ContainersFile): void {
    const tmp = `${this.filePath}.tmp-${process.pid}`
    const fd = openSync(tmp, 'w', 0o600)
    try {
      writeFileSync(fd, JSON.stringify(data, null, 2), 'utf-8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, this.filePath)
  }

  private asRecord(entry: ContainersFile['containers'][number]): ContainerRecord {
    return { ...entry, accountId: entry.accountId ?? DEFAULT_ACCOUNT_ID }
  }

  /**
   * The stored order, completed: ids the file does not mention are appended in the order they were
   * created, so a container added on another day can never be dropped by an older order array.
   */
  private normaliseOrder(order: string[] | undefined, ids: string[]): string[] {
    const known = new Set(ids)
    const out: string[] = []
    for (const raw of order ?? []) {
      const id = sanitiseAccountId(raw)
      if (!id || !known.has(id) || out.includes(id)) continue
      out.push(id)
    }
    for (const id of ids) {
      if (!out.includes(id)) out.push(id)
    }
    return out
  }

  list(): ContainerRecord[] {
    const file = this.readFile()
    const extra = file.containers.map((c) => this.asRecord(c))
    const byId = new Map(extra.map((c) => [c.id, c]))
    const ids = [DEFAULT_CONTAINER_ID, ...extra.map((c) => c.id)]
    const defaultValue = this.loadDefault()
    return this.normaliseOrder(file.order, ids).map(
      (id) => (id === DEFAULT_CONTAINER_ID ? defaultValue : byId.get(id)!)
    )
  }

  /**
   * Puts the containers in the order the user chose. Only ids that exist are used and anything the
   * caller left out keeps its place at the end, so a stale list — a panel open while a container was
   * created elsewhere — cannot delete or hide an entry by omission.
   */
  reorder(orderedIds: string[]): ContainerRecord[] {
    const file = this.readFile()
    const ids = [DEFAULT_CONTAINER_ID, ...file.containers.map((c) => c.id)]
    const next = this.normaliseOrder(orderedIds, ids)
    const current = this.normaliseOrder(file.order, ids)
    if (next.join('\u0000') !== current.join('\u0000')) {
      this.writeFile({ ...file, order: next })
    }
    return this.list()
  }

  /** The default container can carry a colour of its own, so its overrides are persisted too. */
  private loadDefault(): ContainerRecord {
    if (!existsSync(this.defaultFile())) return defaultContainer()
    try {
      const parsed = JSON.parse(readFileSync(this.defaultFile(), 'utf8')) as Partial<ContainerRecord>
      const color = normaliseContainerColor(parsed?.color)
      const name =
        typeof parsed?.name === 'string' && parsed.name.trim()
          ? parsed.name.trim().slice(0, MAX_CONTAINER_NAME)
          : 'Default'
      const accountId = sanitiseAccountId(parsed?.accountId ?? '') ?? DEFAULT_ACCOUNT_ID
      const record: ContainerRecord = { id: DEFAULT_CONTAINER_ID, name, accountId, createdAt: 0 }
      if (color) record.color = color
      return record
    } catch {
      return defaultContainer()
    }
  }

  private defaultFile(): string {
    return `${this.filePath}.default`
  }

  private writeDefault(record: ContainerRecord): void {
    const body: Record<string, unknown> = { name: record.name, accountId: record.accountId }
    if (record.color) body.color = record.color
    const tmp = `${this.defaultFile()}.tmp-${process.pid}`
    const fd = openSync(tmp, 'w', 0o600)
    try {
      writeFileSync(fd, JSON.stringify(body, null, 2), 'utf-8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, this.defaultFile())
  }

  get(containerId: string): ContainerRecord | null {
    return this.list().find((c) => c.id === containerId) ?? null
  }

  /**
   * Creates or updates a container. Update keeps the id — tabs and their cookie stores are keyed by
   * it, so renaming a container must never move a tab to a different account behind the user's back.
   */
  save(input: {
    id?: string
    name?: string
    color?: string | null
    accountId?: string
  }): { container?: ContainerRecord; error?: string } {
    const name = (input.name ?? '').trim()
    if (!name) return { error: 'Give the container a name first.' }
    if (name.length > MAX_CONTAINER_NAME) {
      return { error: `Keep the name under ${MAX_CONTAINER_NAME} characters.` }
    }
    const accountId = sanitiseAccountId(input.accountId ?? '') ?? DEFAULT_ACCOUNT_ID

    if (input.id === DEFAULT_CONTAINER_ID) {
      const current = this.loadDefault()
      const next: ContainerRecord = { ...current, name, accountId }
      const color = normaliseContainerColor(input.color)
      if (color) next.color = color
      else delete next.color
      this.writeDefault(next)
      return { container: next }
    }

    const file = this.readFile()

    if (input.id) {
      const index = file.containers.findIndex((c) => c.id === input.id)
      if (index < 0) return { error: 'No such container.' }
      const existing = file.containers[index]
      const color = normaliseContainerColor(input.color)
      const updated = { ...existing, name, accountId }
      const next = color ? { ...updated, color } : (() => {
        const copy = { ...updated } as typeof updated & { color?: string }
        delete copy.color
        return copy
      })()
      file.containers[index] = next
      this.writeFile(file)
      return { container: this.asRecord(next) }
    }

    const base = containerIdFromName(name)
    if (!base) return { error: 'That name cannot be used for a container.' }
    const taken = new Set(this.list().map((c) => c.id))
    let id = base
    let suffix = 2
    while (taken.has(id)) {
      id = `${base}-${suffix}`
      suffix += 1
    }

    const created: ContainersFile['containers'][number] = {
      id,
      name,
      accountId,
      createdAt: this.now()
    }
    const color = normaliseContainerColor(input.color)
    if (color) created.color = color

    this.writeFile({
      version: 1,
      containers: [...file.containers, created],
      ignoredAccounts: file.ignoredAccounts ?? [],
      // A new container belongs at the end of a list the user has already ordered; without the id
      // here it would be appended by `normaliseOrder` anyway, but naming it keeps the file honest.
      ...(file.order ? { order: [...file.order, created.id] } : {})
    })
    return { container: this.asRecord(created) }
  }

  /** The default container cannot be deleted: it is where every older tab already lives. */
  remove(containerId: string): { removed: boolean; error?: string } {
    if (containerId === DEFAULT_CONTAINER_ID) {
      return { removed: false, error: 'The default container cannot be deleted.' }
    }
    const file = this.readFile()
    const target = file.containers.find((c) => c.id === containerId)
    const next = file.containers.filter((c) => c.id !== containerId)
    if (!target || next.length === file.containers.length) {
      return { removed: false, error: 'No such container.' }
    }
    // If this container only existed because its account does, remember that it was deleted — and
    // only if no other container still points at that account.
    const ignored = new Set(file.ignoredAccounts ?? [])
    const account = target.accountId ?? DEFAULT_ACCOUNT_ID
    if (account !== DEFAULT_ACCOUNT_ID && !next.some((c) => (c.accountId ?? '') === account)) {
      ignored.add(account)
    }
    this.writeFile({
      version: 1,
      containers: next,
      ignoredAccounts: [...ignored],
      ...(file.order ? { order: file.order.filter((id) => id !== containerId) } : {})
    })
    return { removed: true }
  }

  /**
   * The list the switcher shows: every container, plus one for each Google account that does not have
   * one yet.
   *
   * Accounts came first — people added several in Settings and then found a container list holding
   * nothing but "Default", because a container was something you had to make by hand. A signed-in
   * account is a workspace already; it just needed a name, a colour and a store to open in.
   */
  syncWithAccounts(
    accounts: Array<{ id: string; label: string }>
  ): { containers: ContainerRecord[]; created: ContainerRecord[] } {
    const created: ContainerRecord[] = []
    const file = this.readFile()
    const ignored = new Set(file.ignoredAccounts ?? [])
    let containers = file.containers
    let changed = false

    const existingAccountContainers = new Set(
      this.list().filter((c) => c.accountId !== DEFAULT_ACCOUNT_ID).map((c) => c.accountId)
    )

    for (const account of accounts) {
      const accountId = sanitiseAccountId(account.id)
      if (!accountId || accountId === DEFAULT_ACCOUNT_ID) continue
      if (ignored.has(accountId) || existingAccountContainers.has(accountId)) continue

      const taken = new Set([DEFAULT_CONTAINER_ID, ...containers.map((c) => c.id)])
      let id = accountId
      let suffix = 2
      while (taken.has(id)) {
        id = `${accountId}-${suffix}`
        suffix += 1
      }
      const label = (account.label || accountId).trim().slice(0, MAX_CONTAINER_NAME) || accountId
      const record = {
        id,
        name: label,
        color: paletteColorAt(containers.length + created.length),
        accountId,
        createdAt: this.now()
      }
      created.push(this.asRecord(record))
      containers = [...containers, record]
      changed = true
    }

    if (changed) {
      this.writeFile({
        version: 1,
        containers,
        ignoredAccounts: [...ignored],
        ...(file.order ? { order: [...file.order, ...created.map((c) => c.id)] } : {})
      })
    }
    return { containers: this.list(), created }
  }
}
