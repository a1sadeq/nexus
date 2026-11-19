import { describe, it, expect, vi } from 'vitest'
import { PassThrough } from 'stream'
import { createMcpServer, resolveSecret, serveStdio } from './agentMcpServer'
import type { AgentToolCall } from '../shared/agentTools'

const SECRET = 'test-secret-value-1234567890'

const server = (
  options: { handler?: (call: AgentToolCall) => Promise<unknown>; maxLineBytes?: number } = {}
): ReturnType<typeof createMcpServer> =>
  createMcpServer({
    secret: SECRET,
    maxLineBytes: options.maxLineBytes,
    handler: async (call) => {
      if (options.handler) return (await options.handler(call)) as never
      return { ok: true, result: { phase: 'ready', grantRevision: 1 } }
    }
  })

const request = (
  method: string,
  params: Record<string, unknown> = {},
  secret: string | null = SECRET,
  id = 1
): string => {
  const body: Record<string, unknown> = { jsonrpc: '2.0', id, method, params }
  if (secret !== null) body.secret = secret
  return JSON.stringify(body)
}

const callParams = (
  name: string,
  args: Record<string, unknown> = {},
  sessionId = 'session-1'
): Record<string, unknown> => ({
  name,
  sessionId,
  arguments: args
})

describe('authentication', () => {
  it('refuses a request with no secret', async () => {
    const response = await server().handleLine(request('tools/list', {}, null))
    expect(response?.error?.code).toBe(-32001)
    expect(response?.result).toBeUndefined()
  })

  it('refuses a wrong secret with the same message as a missing one', async () => {
    const wrong = await server().handleLine(request('tools/list', {}, 'wrong-secret-value-000000'))
    const missing = await server().handleLine(request('tools/list', {}, null))
    expect(wrong?.error?.message).toBe(missing?.error?.message)
  })

  it('refuses a secret that is merely a prefix of the real one', async () => {
    const response = await server().handleLine(request('tools/list', {}, SECRET.slice(0, -1)))
    expect(response?.error?.code).toBe(-32001)
  })

  it('never echoes the secret back in a rejection', async () => {
    const response = await server().handleLine(request('tools/list', {}, 'another-wrong-secret-123'))
    expect(JSON.stringify(response)).not.toContain('another-wrong-secret-123')
  })

  it('accepts the secret carried in params._meta instead of the envelope', async () => {
    const line = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
      params: { _meta: { nexusClientSecret: SECRET } }
    })
    const response = await server().handleLine(line)
    expect(response?.result).toEqual({})
  })

  it('checks authentication before it inspects the payload', async () => {
    const onReject = vi.fn()
    const guarded = createMcpServer({
      secret: SECRET,
      handler: async () => ({ ok: true, result: {} }),
      onReject
    })
    // An unauthenticated caller must not learn whether the tool name is valid.
    const response = await guarded.handleLine(
      request('tools/call', { name: 'nexus_does_not_exist', sessionId: 's', arguments: {} }, null)
    )
    expect(response?.error?.code).toBe(-32001)
    expect(onReject).toHaveBeenCalledWith('missing or wrong client secret')
  })
})

describe('protocol', () => {
  it('answers initialize with its own identity, not the caller’s claims', async () => {
    const response = await server().handleLine(request('initialize', {}))
    const result = response?.result as { serverInfo: { name: string }; protocolVersion: string }
    expect(result.serverInfo.name).toBe('nexus-agent-bridge')
    expect(result.protocolVersion).toBeTruthy()
  })

  it('lists the tools with their schemas', async () => {
    const response = await server().handleLine(request('tools/list', {}))
    const tools = (response?.result as { tools: { name: string }[] }).tools
    expect(tools.map((tool) => tool.name)).toContain('nexus_dispatch_message')
    expect(tools.map((tool) => tool.name)).toContain('nexus_prepare_edit')
  })

  it('rejects malformed JSON and unknown methods', async () => {
    const broken = await server().handleLine('{not json')
    expect(broken?.error?.code).toBe(-32700)
    const unknown = await server().handleLine(request('tools/delete_everything', {}))
    expect(unknown?.error?.code).toBe(-32601)
  })

  it('rejects a non-object and a wrong jsonrpc version', async () => {
    expect((await server().handleLine('[1,2,3]'))?.error?.code).toBe(-32600)
    const wrongVersion = await server().handleLine(
      JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'ping', secret: SECRET })
    )
    expect(wrongVersion?.error?.code).toBe(-32600)
  })

  it('ignores blank lines', async () => {
    expect(await server().handleLine('   ')).toBeNull()
    expect(await server().handleLine('')).toBeNull()
  })

  it('refuses an oversized line without parsing it', async () => {
    const onReject = vi.fn()
    const small = createMcpServer({ secret: SECRET, maxLineBytes: 100, handler: async () => ({ ok: true, result: {} }), onReject })
    const response = await small.handleLine(request('ping', { padding: 'x'.repeat(500) }))
    expect(response?.error?.code).toBe(-32002)
    expect(onReject).toHaveBeenCalledWith('request exceeded the size cap')
  })
})

describe('tool calls', () => {
  it('routes a valid call to the handler and wraps the result as MCP content', async () => {
    const seen: AgentToolCall[] = []
    const s = server({
      handler: async (call) => {
        seen.push(call)
        return { ok: true, result: { phase: 'ready' } }
      }
    })
    const response = await s.handleLine(request('tools/call', callParams('nexus_status')))
    expect(seen).toHaveLength(1)
    expect(seen[0].tool).toBe('nexus_status')
    const result = response?.result as { content: { text: string }[] }
    expect(JSON.parse(result.content[0].text)).toEqual({ phase: 'ready' })
  })

  it('turns a policy refusal into a tool error the model can read, not a protocol error', async () => {
    const s = server({
      handler: async () => ({ ok: false, code: 'grant-revoked', message: 'This grant was revoked.' })
    })
    const response = await s.handleLine(request('tools/call', callParams('nexus_status')))
    expect(response?.error).toBeUndefined()
    const result = response?.result as { isError: boolean; content: { text: string }[] }
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toEqual({
      code: 'grant-revoked',
      message: 'This grant was revoked.'
    })
  })

  it('rejects an unknown key before the handler sees anything', async () => {
    const handler = vi.fn(async () => ({ ok: true as const, result: {} }))
    const s = server({ handler: handler as never })
    const response = await s.handleLine(
      request('tools/call', callParams('nexus_status', { bypassApproval: true }))
    )
    expect(handler).not.toHaveBeenCalled()
    expect(response?.error?.code).toBe(-32602)
    expect(response?.error?.message).toContain('bypassApproval')
  })

  it('rejects an effect call without an idempotency key', async () => {
    const response = await server().handleLine(
      request('tools/call', callParams('nexus_dispatch_message', { requestId: 'r', prepareId: 'p' }))
    )
    expect(response?.error?.code).toBe(-32602)
  })

  it('reports a handler crash as a tool error without leaking internals', async () => {
    const s = server({
      handler: async () => {
        throw new Error('database at /home/user/secret.db exploded')
      }
    })
    const response = await s.handleLine(request('tools/call', callParams('nexus_status')))
    const result = response?.result as { isError: boolean; content: { text: string }[] }
    expect(result.isError).toBe(true)
    // The message is passed through to the agent, so it must not be a stack trace.
    const text = result.content[0].text
    expect(text).toContain('handler-failed')
    expect(text).not.toContain('at Object.<anonymous>')
  })

  it('logs the tool name only, never the arguments', async () => {
    const onCall = vi.fn()
    const s = createMcpServer({
      secret: SECRET,
      handler: async () => ({ ok: true, result: {} }),
      onCall
    })
    await s.handleLine(
      request('tools/call', callParams('nexus_consult', { question: 'secret business plan', requestId: 'r' }))
    )
    expect(onCall).toHaveBeenCalledWith('nexus_consult')
    expect(JSON.stringify(onCall.mock.calls)).not.toContain('secret business plan')
  })
})

describe('stdio framing', () => {
  it('answers each newline-delimited request once', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const responses: string[] = []
    output.on('data', (chunk: Buffer) => responses.push(chunk.toString()))

    const stop = serveStdio(server(), { input, output })
    input.write(`${request('ping', {}, SECRET, 1)}\n${request('ping', {}, SECRET, 2)}\n`)
    await new Promise((resolve) => setTimeout(resolve, 20))
    stop()

    const parsed = responses.join('').trim().split('\n').map((line) => JSON.parse(line))
    expect(parsed).toHaveLength(2)
    expect(parsed.map((entry) => entry.id)).toEqual([1, 2])
  })

  it('handles a request split across two chunks', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const responses: string[] = []
    output.on('data', (chunk: Buffer) => responses.push(chunk.toString()))
    const stop = serveStdio(server(), { input, output })

    const line = request('ping', {}, SECRET, 7)
    input.write(line.slice(0, 10))
    await new Promise((resolve) => setTimeout(resolve, 5))
    input.write(`${line.slice(10)}\n`)
    await new Promise((resolve) => setTimeout(resolve, 20))
    stop()

    expect(responses.join('')).toContain('"id":7')
  })

  it('refuses a line that exceeds the framing cap', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const responses: string[] = []
    output.on('data', (chunk: Buffer) => responses.push(chunk.toString()))
    const stop = serveStdio(server(), { input, output, maxLineBytes: 50 })
    input.write(`${'y'.repeat(200)}\n`)
    await new Promise((resolve) => setTimeout(resolve, 20))
    stop()
    expect(responses.join('')).toContain('-32002')
  })
})

describe('construction', () => {
  it('refuses to start without a real per-process secret', () => {
    expect(() => createMcpServer({ secret: 'short', handler: async () => ({ ok: true, result: {} }) })).toThrow(
      /at least 16 characters/
    )
  })
})

describe('session bound to the process', () => {
  const bound = (
    options: { sessionId?: string; handler?: (call: AgentToolCall) => Promise<unknown> } = {}
  ): ReturnType<typeof createMcpServer> =>
    createMcpServer({
      secret: SECRET,
      sessionId: options.sessionId ?? 'sess-bound',
      handler: async (call) => {
        if (options.handler) return (await options.handler(call)) as never
        return { ok: true, result: { session: call.sessionId } }
      }
    })

  it('does not ask the client for a session id it cannot have', async () => {
    const response = await bound().handleLine(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { nexusClientSecret: SECRET } } })
    )
    const tools = (response?.result as { tools: { inputSchema: { properties: object } }[] }).tools
    for (const tool of tools) {
      expect(Object.keys(tool.inputSchema.properties)).not.toContain('sessionId')
    }
  })

  it('fills the session from the process, so a client that sends nothing still works', async () => {
    const response = await bound().handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'nexus_status', arguments: {}, _meta: { nexusClientSecret: SECRET } }
      })
    )
    const text = (response?.result as { content: { text: string }[] }).content[0].text
    expect(JSON.parse(text)).toEqual({ session: 'sess-bound' })
  })

  it('rejects a call that claims another session', async () => {
    const response = await bound().handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'nexus_status',
          arguments: {},
          sessionId: 'sess-intruder',
          _meta: { nexusClientSecret: SECRET }
        }
      })
    )
    expect(response?.error?.code).toBe(-32602)
    expect(response?.error?.message).toContain('decided when the process starts')
  })

  it('accepts the token from the environment, which is how OpenCode will supply it', () => {
    expect(resolveSecret({ NEXUS_BRIDGE_TOKEN: 'token-from-the-environment' })).toEqual({
      ok: true,
      secret: 'token-from-the-environment'
    })
  })

  it('still reads the older variable name so a half-migrated config starts', () => {
    expect(resolveSecret({ NEXUS_BRIDGE_SECRET: 'legacy-token-value-here' })).toEqual({
      ok: true,
      secret: 'legacy-token-value-here'
    })
  })

  it('explains a missing token instead of starting unauthenticated', () => {
    const result = resolveSecret({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('NEXUS_BRIDGE_TOKEN')
  })

  it('refuses a token too short to be meaningful', () => {
    const result = resolveSecret({ NEXUS_BRIDGE_TOKEN: 'abc' })
    expect(result.ok).toBe(false)
  })
})
