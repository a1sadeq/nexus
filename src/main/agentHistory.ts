import { randomUUID } from 'node:crypto'

/**
 * Local history core; trusted main-process callers only. Classification of
 * content as non-sensitive is a caller responsibility, not a DLP guarantee.
 * A storage adapter and authenticated settings/UI must be supplied separately.
 */
export type HistoryCategory = 'conversation' | 'actions' | 'commands' | 'reviews'
export type HistoryInput =
  | { kind: 'content'; category: HistoryCategory; text: string }
  | {
      kind: 'sensitive-transfer'
      direction: 'to-provider' | 'to-agent'
      outcome: 'approved' | 'denied' | 'failed'
      byteCount: number
    }
export type HistoryRecord =
  | { id: string; timestamp: number; kind: 'content'; category: HistoryCategory; text: string }
  | {
      id: string
      timestamp: number
      kind: 'sensitive-transfer'
      category: 'actions'
      direction: 'to-provider' | 'to-agent'
      outcome: 'approved' | 'denied' | 'failed'
      byteCount: number
    }
export interface HistoryStore {
  read(): unknown | null
  /** Must atomically replace the active snapshot or throw without claiming success. */
  write(snapshot: unknown): void
}
export interface HistoryPolicy {
  retentionDays: number
  categories: HistoryCategory[]
}
interface Snapshot {
  version: 1
  policy: HistoryPolicy
  records: HistoryRecord[]
}
const categories: HistoryCategory[] = ['conversation', 'actions', 'commands', 'reviews']
const MAX_RECORDS = 10000
const MAX_TEXT = 100000
const DAY = 86400000
const DEFAULT_POLICY: HistoryPolicy = { retentionDays: 15, categories: [...categories] }

function validTime(time: unknown): time is number {
  return Number.isSafeInteger(time) && (time as number) >= 0
}
function clonePolicy(policy: HistoryPolicy): HistoryPolicy {
  if (
    !policy ||
    !Number.isInteger(policy.retentionDays) ||
    policy.retentionDays < 1 ||
    policy.retentionDays > 3650 ||
    !Array.isArray(policy.categories) ||
    policy.categories.length > categories.length ||
    !policy.categories.every((category) => categories.includes(category)) ||
    new Set(policy.categories).size !== policy.categories.length
  )
    throw new Error('Invalid history policy')
  return { retentionDays: policy.retentionDays, categories: [...policy.categories] }
}
function keysExactly(value: object, expected: string[]): boolean {
  const keys = Object.keys(value).sort(),
    sorted = [...expected].sort()
  return keys.length === sorted.length && keys.every((key, i) => key === sorted[i])
}
function validateRecord(value: unknown): HistoryRecord {
  if (!value || typeof value !== 'object') throw new Error('Invalid history record')
  const r = value as Record<string, unknown>
  if (typeof r.id !== 'string' || !/^[0-9a-f-]{36}$/.test(r.id) || !validTime(r.timestamp))
    throw new Error('Invalid history record')
  if (r.kind === 'content') {
    if (
      !keysExactly(r, ['id', 'timestamp', 'kind', 'category', 'text']) ||
      !categories.includes(r.category as HistoryCategory) ||
      typeof r.text !== 'string' ||
      r.text.length > MAX_TEXT
    )
      throw new Error('Invalid history record')
    return {
      id: r.id,
      timestamp: r.timestamp,
      kind: 'content',
      category: r.category as HistoryCategory,
      text: r.text
    }
  }
  if (r.kind === 'sensitive-transfer') {
    if (
      !keysExactly(r, [
        'id',
        'timestamp',
        'kind',
        'category',
        'direction',
        'outcome',
        'byteCount'
      ]) ||
      r.category !== 'actions' ||
      !['to-provider', 'to-agent'].includes(r.direction as string) ||
      !['approved', 'denied', 'failed'].includes(r.outcome as string) ||
      !Number.isSafeInteger(r.byteCount) ||
      (r.byteCount as number) < 0
    )
      throw new Error('Invalid history record')
    return {
      id: r.id,
      timestamp: r.timestamp,
      kind: 'sensitive-transfer',
      category: 'actions',
      direction: r.direction as 'to-provider' | 'to-agent',
      outcome: r.outcome as 'approved' | 'denied' | 'failed',
      byteCount: r.byteCount as number
    }
  }
  throw new Error('Invalid history record')
}
function validateSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== 'object' || !keysExactly(value, ['version', 'policy', 'records']))
    throw new Error('Invalid history snapshot')
  const snapshot = value as Snapshot
  if (
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.records) ||
    snapshot.records.length > MAX_RECORDS
  )
    throw new Error('Invalid history snapshot')
  const policy = clonePolicy(snapshot.policy)
  const records = snapshot.records.map(validateRecord)
  if (new Set(records.map((record) => record.id)).size !== records.length)
    throw new Error('Invalid history snapshot')
  return { version: 1, policy, records }
}

export class AgentHistory {
  private snapshot: Snapshot
  constructor(
    private readonly store: HistoryStore,
    private readonly clock: () => number = Date.now
  ) {
    const raw = store.read()
    this.snapshot =
      raw === null
        ? { version: 1, policy: clonePolicy(DEFAULT_POLICY), records: [] }
        : validateSnapshot(raw)
    this.prune()
  }
  private now(): number {
    const value = this.clock()
    if (!validTime(value)) throw new Error('Invalid history clock')
    if (this.snapshot.records.some((record) => record.timestamp > value))
      throw new Error('History clock moved backwards')
    return value
  }
  private commit(next: Snapshot): void {
    // Give the adapter a copy so it cannot retain/mutate internal references.
    if (Buffer.byteLength(JSON.stringify(next), 'utf8') > 8 * 1024 * 1024)
      throw new Error('History capacity reached')
    this.store.write(structuredClone(next))
    this.snapshot = next
  }
  policy(): HistoryPolicy {
    return clonePolicy(this.snapshot.policy)
  }
  records(): HistoryRecord[] {
    return structuredClone(this.snapshot.records)
  }

  /** Selection applies to new events; it does not retroactively delete history. */
  configure(policy: HistoryPolicy): void {
    const clean = clonePolicy(structuredClone(policy))
    const time = this.now(),
      cutoff = Math.max(0, time - clean.retentionDays * DAY)
    this.commit({
      version: 1,
      policy: clean,
      records: this.snapshot.records.filter((record) => record.timestamp >= cutoff)
    })
  }
  /** Returns false when the category was not selected, without persisting it. */
  append(input: HistoryInput): boolean {
    let value: HistoryInput
    try {
      value = structuredClone(input)
    } catch {
      throw new Error('Invalid history input')
    }
    if (!value || typeof value !== 'object') throw new Error('Invalid history input')
    const time = this.now()
    let record: HistoryRecord
    const id = randomUUID()
    if (value.kind === 'content') {
      if (
        !keysExactly(value, ['kind', 'category', 'text']) ||
        !categories.includes(value.category) ||
        typeof value.text !== 'string' ||
        value.text.length > MAX_TEXT
      )
        throw new Error('Invalid history input')
      record = { id, timestamp: time, kind: 'content', category: value.category, text: value.text }
    } else if (value.kind === 'sensitive-transfer') {
      if (
        !keysExactly(value, ['kind', 'direction', 'outcome', 'byteCount']) ||
        !['to-provider', 'to-agent'].includes(value.direction) ||
        !['approved', 'denied', 'failed'].includes(value.outcome) ||
        !Number.isSafeInteger(value.byteCount) ||
        value.byteCount < 0
      )
        throw new Error('Invalid history input')
      record = {
        id,
        timestamp: time,
        kind: 'sensitive-transfer',
        category: 'actions',
        direction: value.direction,
        outcome: value.outcome,
        byteCount: value.byteCount
      }
    } else throw new Error('Invalid history input')
    if (!this.snapshot.policy.categories.includes(record.category)) return false
    const cutoff = Math.max(0, time - this.snapshot.policy.retentionDays * DAY)
    const records = this.snapshot.records.filter((item) => item.timestamp >= cutoff)
    if (records.length >= MAX_RECORDS) throw new Error('History capacity reached')
    this.commit({
      version: 1,
      policy: clonePolicy(this.snapshot.policy),
      records: [...records, record]
    })
    return true
  }
  /** Explicit and startup retention pass; adapter must not preserve stale backups. */
  prune(): void {
    const time = this.now(),
      cutoff = Math.max(0, time - this.snapshot.policy.retentionDays * DAY)
    const records = this.snapshot.records.filter((record) => record.timestamp >= cutoff)
    if (records.length !== this.snapshot.records.length)
      this.commit({ version: 1, policy: clonePolicy(this.snapshot.policy), records })
  }
}
