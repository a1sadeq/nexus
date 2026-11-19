import { describe, expect, it } from 'vitest'
import { AgentHistory, type HistoryStore } from './agentHistory'

class MemoryStore implements HistoryStore {
  data: unknown = null
  writes = 0
  fail = false
  read(): unknown | null {
    return structuredClone(this.data)
  }
  write(value: unknown): void {
    if (this.fail) throw new Error('write failed')
    this.writes++
    this.data = structuredClone(value)
  }
}
const DAY = 86400000

describe('local history core', () => {
  it('defaults to all categories and 15 day retention', () => {
    const history = new AgentHistory(new MemoryStore(), () => 20 * DAY)
    expect(history.policy()).toEqual({
      retentionDays: 15,
      categories: ['conversation', 'actions', 'commands', 'reviews']
    })
  })
  it('stores sensitive transfers as strict metadata, rejecting any content or path', () => {
    const store = new MemoryStore(),
      history = new AgentHistory(store, () => DAY)
    expect(() =>
      history.append({
        kind: 'sensitive-transfer',
        direction: 'to-provider',
        outcome: 'approved',
        byteCount: 3,
        text: 'SECRET'
      } as never)
    ).toThrow()
    expect(store.writes).toBe(0)
    history.append({
      kind: 'sensitive-transfer',
      direction: 'to-provider',
      outcome: 'approved',
      byteCount: 3
    })
    const json = JSON.stringify(store.data)
    expect(json).not.toContain('SECRET')
    expect(history.records()[0]).toMatchObject({
      category: 'actions',
      kind: 'sensitive-transfer',
      byteCount: 3
    })
  })
  it('records ordinary text only in selected categories and does not retroactively delete old categories', () => {
    const history = new AgentHistory(new MemoryStore(), () => DAY)
    history.append({ kind: 'content', category: 'conversation', text: 'hello' })
    history.configure({ retentionDays: 15, categories: ['reviews'] })
    expect(history.append({ kind: 'content', category: 'commands', text: 'not saved' })).toBe(false)
    expect(history.append({ kind: 'content', category: 'reviews', text: 'review' })).toBe(true)
    expect(history.records().map((record) => record.category)).toEqual(['conversation', 'reviews'])
  })
  it('retains only the configured time window on append and startup', () => {
    const store = new MemoryStore()
    let now = DAY
    const history = new AgentHistory(store, () => now)
    history.append({ kind: 'content', category: 'actions', text: 'old' })
    now = 17 * DAY
    history.append({ kind: 'content', category: 'actions', text: 'new' })
    expect(history.records()).toHaveLength(1)
    now = 40 * DAY
    const reopened = new AgentHistory(store, () => now)
    expect(reopened.records()).toEqual([])
    expect((store.data as { records: unknown[] }).records).toEqual([])
  })
  it('rejects backwards clocks instead of silently pruning history', () => {
    const store = new MemoryStore()
    let now = 10 * DAY
    const history = new AgentHistory(store, () => now)
    history.append({ kind: 'content', category: 'actions', text: 'keep' })
    now = 9 * DAY
    expect(() => history.prune()).toThrow('backwards')
    expect(() => new AgentHistory(store, () => now)).toThrow('backwards')
    expect((store.data as { records: unknown[] }).records).toHaveLength(1)
  })
  it('does not mutate internal state when a write fails', () => {
    const store = new MemoryStore(),
      history = new AgentHistory(store, () => DAY)
    store.fail = true
    expect(() => history.append({ kind: 'content', category: 'actions', text: 'x' })).toThrow()
    expect(history.records()).toEqual([])
    expect(() => history.configure({ retentionDays: 2, categories: [] })).toThrow()
    expect(history.policy().retentionDays).toBe(15)
  })
  it('rejects corrupt snapshots and unknown fields on sensitive records', () => {
    const store = new MemoryStore()
    store.data = {
      version: 1,
      policy: { retentionDays: 15, categories: ['actions'] },
      records: [
        {
          id: 'a'.repeat(36),
          timestamp: 1,
          kind: 'sensitive-transfer',
          category: 'actions',
          direction: 'to-agent',
          outcome: 'approved',
          byteCount: 1,
          text: 'secret'
        }
      ]
    }
    expect(() => new AgentHistory(store, () => DAY)).toThrow('Invalid history record')
    expect(JSON.stringify(store.data)).toContain('secret') // corrupt file is not silently overwritten
  })
  it('returns defensive copies of records and policy', () => {
    const history = new AgentHistory(new MemoryStore(), () => DAY)
    history.append({ kind: 'content', category: 'actions', text: 'original' })
    history.records()[0].category = 'reviews'
    history.policy().categories.length = 0
    expect(history.records()[0].category).toBe('actions')
    expect(history.policy().categories).toHaveLength(4)
  })
  it('rejects invalid policies, invalid input and oversized text', () => {
    const history = new AgentHistory(new MemoryStore(), () => DAY)
    expect(() => history.configure({ retentionDays: 0, categories: [] })).toThrow()
    expect(() =>
      history.configure({ retentionDays: 15, categories: ['actions', 'actions'] })
    ).toThrow()
    expect(() =>
      history.append({ kind: 'content', category: 'actions', text: 'x'.repeat(100001) })
    ).toThrow()
    expect(() => history.append({ kind: 'unknown' } as never)).toThrow()
  })
})
