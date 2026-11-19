import { spawn, type ChildProcess } from 'child_process'
import { describeTools } from '../shared/agentTools'

/**
 * A small MCP client that talks to a server process over its stdin/stdout.
 *
 * Two reasons this exists rather than being inlined into tests:
 *
 *  1. OpenCode spawns the bridge, but *Nexus* also needs a client later — the terminal panel
 *     drives OpenCode, and the same handshake (`initialize` → `tools/list` → `tools/call`)
 *     has to be exercised against the real binary, not a mock.
 *  2. The interesting failures here are transport failures: a process that dies mid-call, a
 *     reply that never arrives, a server that refuses the token. Only a real child process
 *     produces those.
 *
 * Limits are deliberate: one request in flight per id, a hard timeout per call, and the
 * child's stderr is captured into a bounded buffer for diagnostics — never forwarded to a
 * log that might contain the token.
 */

export interface McpClientOptions {
  command: string
  args?: string[]
  env?: Record<string, string | undefined>
  cwd?: string
  /** Sent as `_meta.nexusClientSecret` on every request. Never logged. */
  secret: string
  /** Per-request deadline. */
  timeoutMs?: number
  /** Replies longer than this are treated as protocol failures. */
  maxLineBytes?: number
}

export type McpToolDescription = ReturnType<typeof describeTools>[number]

export interface McpCallResult {
  ok: boolean
  /** Present when `ok`: the JSON the tool returned. */
  data?: unknown
  /** Present when the tool refused. */
  code?: string
  message?: string
}

export class McpClientError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'McpClientError'
  }
}

export interface McpClient {
  initialize(): Promise<{ protocolVersion: string; serverInfo: Record<string, unknown> }>
  listTools(): Promise<McpToolDescription[]>
  callTool(name: string, args?: Record<string, unknown>): Promise<McpCallResult>
  /** Everything the child wrote to stderr, bounded. */
  stderr(): string
  /** Resolves when the child exits; never rejects. */
  exited(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  close(): Promise<void>
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT = 10_000
const DEFAULT_MAX_LINE = 1024 * 1024
const STDERR_CAP = 8 * 1024

export function createMcpClient(options: McpClientOptions): McpClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  const maxLine = options.maxLineBytes ?? DEFAULT_MAX_LINE
  if (typeof options.secret !== 'string' || options.secret.length < 16) {
    throw new McpClientError('bad-secret', 'The client needs the per-session token to correlate itself.')
  }

  const child: ChildProcess = spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe']
  })

  let buffer = ''
  let stderrText = ''
  let nextId = 1
  let closed = false
  const pending = new Map<number, Pending>()

  const failAll = (error: Error): void => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      if (line.trim().length === 0) continue
      if (line.length > maxLine) {
        failAll(new McpClientError('oversized-reply', 'The server sent a reply larger than the limit.'))
        continue
      }
      let message: Record<string, unknown>
      try {
        message = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      const id = typeof message.id === 'number' ? message.id : null
      if (id === null) continue
      const entry = pending.get(id)
      if (!entry) continue
      pending.delete(id)
      clearTimeout(entry.timer)
      const error = message.error as { code?: number; message?: string } | undefined
      if (error) {
        const code = error.code === -32001
          ? 'unauthorized'
          : error.code === -32602
            ? 'invalid-params'
            : error.code === -32002
              ? 'too-large'
              : 'server-error'
        entry.reject(new McpClientError(code, error.message ?? 'The server refused the request.'))
      } else {
        entry.resolve(message.result)
      }
    }
  })

  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    if (stderrText.length < STDERR_CAP) {
      stderrText += chunk.slice(0, STDERR_CAP - stderrText.length)
    }
  })

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('exit', (code, signal) => {
      closed = true
      failAll(new McpClientError('child-exited', `The bridge process exited (code ${String(code)}).`))
      resolve({ code, signal })
    })
    child.on('error', (error) => {
      closed = true
      failAll(new McpClientError('spawn-failed', error.message))
      resolve({ code: null, signal: null })
    })
  })

  const request = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    new Promise<unknown>((resolve, reject) => {
      if (closed) {
        reject(new McpClientError('child-exited', 'The bridge process is no longer running.'))
        return
      }
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new McpClientError('timeout', `No reply to ${method} within ${timeoutMs} ms.`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      const envelope = {
        jsonrpc: '2.0',
        id,
        method,
        params: { ...params, _meta: { nexusClientSecret: options.secret } }
      }
      child.stdin?.write(`${JSON.stringify(envelope)}\n`)
    })

  const parseToolResult = (result: unknown): McpCallResult => {
    const content = (result as { content?: { type: string; text?: string }[]; isError?: boolean })
    const first = content?.content?.[0]
    let payload: unknown = undefined
    if (first && typeof first.text === 'string') {
      try {
        payload = JSON.parse(first.text)
      } catch {
        payload = first.text
      }
    }
    if (content?.isError === true) {
      const refused = payload as { code?: string; message?: string } | undefined
      return {
        ok: false,
        code: typeof refused?.code === 'string' ? refused.code : 'refused',
        message: typeof refused?.message === 'string' ? refused.message : 'The tool refused the call.'
      }
    }
    return { ok: true, data: payload }
  }

  return {
    async initialize(): Promise<{ protocolVersion: string; serverInfo: Record<string, unknown> }> {
      const result = (await request('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'nexus-client', version: '0.1.0' },
        capabilities: {}
      })) as { protocolVersion?: string; serverInfo?: Record<string, unknown> }
      return {
        protocolVersion: result?.protocolVersion ?? 'unknown',
        serverInfo: result?.serverInfo ?? {}
      }
    },

    async listTools(): Promise<McpToolDescription[]> {
      const result = (await request('tools/list', {})) as { tools?: McpToolDescription[] }
      return result?.tools ?? []
    },

    async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpCallResult> {
      const result = await request('tools/call', { name, arguments: args })
      return parseToolResult(result)
    },

    stderr(): string {
      return stderrText
    },

    exited(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
      return exited
    },

    async close(): Promise<void> {
      if (closed) return
      child.stdin?.end()
      const killTimer = setTimeout(() => {
        if (!closed) child.kill('SIGKILL')
      }, 2_000)
      await exited
      clearTimeout(killTimer)
    }
  }
}
