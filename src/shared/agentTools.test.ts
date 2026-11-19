import { describe, it, expect } from 'vitest'
import {
  AGENT_TOOLS,
  describeTools,
  isSafeAgentPath,
  validateToolCall,
  type AgentToolName
} from './agentTools'

const ROOT = '/home/user/project'

const call = (
  tool: AgentToolName,
  args: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  tool,
  sessionId: 'session-1',
  args,
  ...extra
})

describe('tool surface', () => {
  it('separates prepare from effect, so preparing can never send', () => {
    expect(AGENT_TOOLS.nexus_consult.level).toBe('prepare')
    expect(AGENT_TOOLS.nexus_dispatch_message.level).toBe('effect')
    expect(AGENT_TOOLS.nexus_status.level).toBe('read-only')
    // No tool both prepares and sends.
    const levels = Object.values(AGENT_TOOLS).map((spec) => spec.level)
    expect(levels.filter((level) => level === 'effect')).toHaveLength(1)
  })

  it('describes every tool with a schema the agent can read', () => {
    const described = describeTools()
    expect(described).toHaveLength(Object.keys(AGENT_TOOLS).length)
    for (const tool of described) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.required).toContain('sessionId')
      expect(tool.description.length).toBeGreaterThan(20)
    }
  })
})

describe('validation', () => {
  it('accepts a well-formed read-only call', () => {
    const result = validateToolCall(call('nexus_status'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.call.level).toBe('read-only')
  })

  it('rejects an unknown tool by name', () => {
    const result = validateToolCall({ tool: 'nexus_write_anything', sessionId: 's', args: {} })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('unknown-tool')
      expect(result.message).toContain('nexus_status')
    }
  })

  it('rejects unknown keys instead of ignoring them', () => {
    const result = validateToolCall(call('nexus_status', { autoApprove: true }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('unknown-key')
  })

  it('requires the keys the tool declares', () => {
    const result = validateToolCall(call('nexus_consult', { question: 'what next?' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('missing-key')
  })

  it('requires a session id and does not treat it as authorisation', () => {
    const result = validateToolCall({ tool: 'nexus_status', args: {} })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('does not authorise')
  })

  it('enforces the size cap', () => {
    const result = validateToolCall(
      call('nexus_consult', { question: 'x'.repeat(50), requestId: 'r1' }),
      { maxStringLength: 10 }
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('too-long')
  })

  it('enforces the item cap on lists', () => {
    const result = validateToolCall(
      call('nexus_request_context', { paths: ['/a/1', '/a/2', '/a/3'], reason: 'x', requestId: 'r' }),
      { maxItems: 2, allowedRoots: ['/a'] }
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('too-many-items')
  })

  it('requires an idempotency key on effect tools, so a retry cannot send twice', () => {
    const result = validateToolCall(
      call('nexus_dispatch_message', { requestId: 'r1', prepareId: 'p1' })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('missing-key')

    const withEverything = validateToolCall(
      call('nexus_dispatch_message', { requestId: 'r1', prepareId: 'p1', idempotencyKey: 'k1' })
    )
    expect(withEverything.ok).toBe(true)
  })

  it('rejects a relative path that escapes the worktree', () => {
    const result = validateToolCall(
      call('nexus_prepare_edit', {
        requestId: 'r1',
        relativePath: '../../etc/passwd',
        content: 'x',
        baseRevision: 'abc'
      })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('unsafe-path')
  })
})

describe('path safety', () => {
  it('accepts a normalised path inside an allowed root', () => {
    expect(isSafeAgentPath(`${ROOT}/src/index.ts`, [ROOT])).toBe(true)
  })

  it('refuses traversal, relative paths, NUL bytes and other roots', () => {
    expect(isSafeAgentPath(`${ROOT}/../etc/passwd`, [ROOT])).toBe(false)
    expect(isSafeAgentPath('src/index.ts', [ROOT])).toBe(false)
    expect(isSafeAgentPath(`${ROOT}/a\0b`, [ROOT])).toBe(false)
    expect(isSafeAgentPath('/etc/passwd', [ROOT])).toBe(false)
    expect(isSafeAgentPath(`${ROOT}-evil/x`, [ROOT])).toBe(false)
  })

  it('allows nothing when no roots are supplied', () => {
    expect(isSafeAgentPath(`${ROOT}/a`, [])).toBe(false)
  })

  it('is applied to context paths during validation', () => {
    const ok = validateToolCall(
      call('nexus_request_context', { paths: [`${ROOT}/src/a.ts`], reason: 'review', requestId: 'r' }),
      { allowedRoots: [ROOT] }
    )
    expect(ok.ok).toBe(true)

    const outside = validateToolCall(
      call('nexus_request_context', { paths: ['/etc/shadow'], reason: 'review', requestId: 'r' }),
      { allowedRoots: [ROOT] }
    )
    expect(outside.ok).toBe(false)
    if (!outside.ok) expect(outside.code).toBe('unsafe-path')
  })
})

describe('session identity', () => {
  it('does not advertise a session id when the session is bound at spawn', () => {
    const tools = describeTools({ bindSessionAtSpawn: true })
    for (const tool of tools) {
      expect(Object.keys(tool.inputSchema.properties)).not.toContain('sessionId')
      expect(tool.inputSchema.required).not.toContain('sessionId')
    }
    // Still advertises the tool's own required keys.
    const review = tools.find((tool) => tool.name === 'nexus_submit_review')
    expect(review?.inputSchema.required).toEqual(['requestId', 'patch', 'baseRevision', 'targetWorktreeId'])
  })

  it('still advertises the session id when it has to arrive with the call', () => {
    const tool = describeTools().find((entry) => entry.name === 'nexus_status')
    expect(tool?.inputSchema.required).toContain('sessionId')
  })

  it('uses the bound session and ignores an absent claim from the caller', () => {
    const result = validateToolCall({ tool: 'nexus_status', args: {} }, {}, 'sess-bound')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.call.sessionId).toBe('sess-bound')
  })

  it('accepts a claim that agrees with the binding, because agreeing is not a risk', () => {
    const result = validateToolCall({ tool: 'nexus_status', sessionId: 'sess-bound', args: {} }, {}, 'sess-bound')
    expect(result.ok).toBe(true)
  })

  it('refuses a claim that disagrees, instead of silently substituting', () => {
    const result = validateToolCall(
      { tool: 'nexus_status', sessionId: 'someone-elses-session', args: {} },
      {},
      'sess-bound'
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('session-mismatch')
      expect(result.message).toContain('decided when the process starts')
    }
  })
})
