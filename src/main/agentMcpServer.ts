import { timingSafeEqual } from 'crypto'
import {
  describeTools,
  validateToolCall,
  type AgentToolCall,
  type ValidationLimits
} from '../shared/agentTools'

/**
 * MCP transport for the agent bridge (plan 01, steps 1–2).
 *
 * Deliberate limits, all of them structural rather than configurable:
 *
 *  - **stdio only.** No TCP listener, so there is no Host/Origin surface to get wrong and no
 *    port for another local process to discover. Nexus spawns the client and owns the pipe.
 *  - **Per-session secret, checked before anything else is parsed.** A message without the
 *    matching secret is rejected with a generic error; the secret is never echoed, logged or
 *    included in a response.
 *  - **The secret is a correlation value, not authentication.** The process that spawns this
 *    server chooses its environment, so holding the token proves only *which* session this
 *    pipe belongs to. Authorisation happens against broker state at the moment of effect.
 *  - **The session is bound at construction.** MCP clients do not send a Nexus session id, so
 *    it arrives once, from whoever started the process — never from a request.
 *  - **The secret may come from `NEXUS_BRIDGE_TOKEN`.** OpenCode spawns this file itself, so
 *    the token has to reach it through the environment rather than a config file.
 *  - **Bounded.** A line over the size cap is refused without being parsed, and tool results
 *    are summarised, not streamed.
 *
 * This module deliberately contains no policy: it validates and routes. Grants, the command
 * policy and the edit gate answer yes/no, and they are asked at the moment of the effect.
 */

export type McpToolHandler = (
  call: AgentToolCall
) => Promise<{ ok: true; result: unknown } | { ok: false; code: string; message: string }>

export interface McpServerOptions {
  /** Secret Nexus generated for this child process. Compared with timingSafeEqual. */
  secret: string
  /**
   * Session this process was started for. Required in practice: without it every call would
   * have to carry an identity the client does not have and should not be believed if it did.
   */
  sessionId?: string
  handler: McpToolHandler
  limits?: ValidationLimits
  /** Cap on one request line. 1 MiB is generous for a patch, small for a mistake. */
  maxLineBytes?: number
  /** Called for every rejected request so the UI can show attempted misuse. */
  onReject?: (reason: string) => void
  /** Called after every accepted call, with the tool name only — never the arguments. */
  onCall?: (tool: string) => void
}

export interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024
const PROTOCOL_VERSION = '2024-11-05'

const ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  unauthorized: -32001,
  tooLarge: -32002
} as const

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** The secret may travel in `params._meta.nexusClientSecret` or a top-level `secret`. */
function extractSecret(request: JsonRpcRequest): string | null {
  const params = request.params as Record<string, unknown> | undefined
  const meta = params?._meta as Record<string, unknown> | undefined
  const fromMeta = meta?.nexusClientSecret
  if (typeof fromMeta === 'string') return fromMeta
  const top = (request as Record<string, unknown>).secret
  if (typeof top === 'string') return top
  return null
}

export function createMcpServer(options: McpServerOptions): {
  handleLine(line: string): Promise<JsonRpcResponse | null>
  describe(): ReturnType<typeof describeTools>
} {
  const maxLine = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES
  if (typeof options.secret !== 'string' || options.secret.length < 16) {
    throw new Error('The MCP bridge needs a per-process secret of at least 16 characters.')
  }

  const unauthorized = (id: string | number | null): JsonRpcResponse => {
    options.onReject?.('missing or wrong client secret')
    // Deliberately identical for "no secret" and "wrong secret": no oracle.
    return {
      jsonrpc: '2.0',
      id,
      error: { code: ERROR.unauthorized, message: 'This process is not authorised for the Nexus bridge.' }
    }
  }

  async function handleLine(line: string): Promise<JsonRpcResponse | null> {
    if (typeof line !== 'string') return null
    const trimmed = line.trim()
    if (trimmed.length === 0) return null

    if (Buffer.byteLength(trimmed, 'utf8') > maxLine) {
      options.onReject?.('request exceeded the size cap')
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: ERROR.tooLarge, message: 'That request was too large to process.' }
      }
    }

    let request: JsonRpcRequest
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest
    } catch {
      options.onReject?.('unparseable JSON')
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: ERROR.parse, message: 'Malformed JSON.' }
      }
    }
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      return { jsonrpc: '2.0', id: null, error: { code: ERROR.invalidRequest, message: 'Invalid request.' } }
    }

    const id = request.id ?? null
    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return { jsonrpc: '2.0', id, error: { code: ERROR.invalidRequest, message: 'Invalid request.' } }
    }

    // Authentication first: nothing about the payload is inspected before this point.
    const presented = extractSecret(request)
    if (presented === null || !safeEqual(presented, options.secret)) {
      return unauthorized(id)
    }

    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            serverInfo: { name: 'nexus-agent-bridge', version: '0.1.0' },
            capabilities: { tools: {} }
          }
        }

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} }

      case 'tools/list':
        // With the session bound at spawn there is nothing for the caller to fill in, so the
        // schema does not advertise it. Advertising a field the client cannot supply invites
        // the model to invent one.
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: describeTools({ bindSessionAtSpawn: options.sessionId !== undefined }) }
        }

      case 'tools/call': {
        const params = request.params as Record<string, unknown> | undefined
        if (!params || typeof params !== 'object') {
          return { jsonrpc: '2.0', id, error: { code: ERROR.invalidParams, message: 'Missing parameters.' } }
        }
        // Any sessionId in the payload is only ever *compared* against the bound one.
        const claimed =
          params.sessionId ?? (params.arguments as Record<string, unknown>)?.sessionId ?? undefined
        const validation = validateToolCall(
          { tool: params.name, args: params.arguments ?? {}, sessionId: claimed },
          options.limits,
          options.sessionId
        )
        if (!validation.ok) {
          options.onReject?.(validation.code)
          return { jsonrpc: '2.0', id, error: { code: ERROR.invalidParams, message: validation.message } }
        }

        options.onCall?.(validation.call.tool)
        try {
          const outcome = await options.handler(validation.call)
          if (!outcome.ok) {
            // A policy refusal is a normal tool result, not a protocol error: the model must
            // be able to read *why* it was refused.
            return {
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: JSON.stringify({ code: outcome.code, message: outcome.message }) }]
              }
            }
          }
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: JSON.stringify(outcome.result) }] }
          }
        } catch (error) {
          options.onReject?.('handler threw')
          return {
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    code: 'handler-failed',
                    message: error instanceof Error ? error.message : 'The bridge failed to answer.'
                  })
                }
              ]
            }
          }
        }
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: ERROR.methodNotFound, message: `Unknown method "${request.method}".` }
        }
    }
  }

  return {
    handleLine,
    describe: options.sessionId === undefined
      ? describeTools
      : () => describeTools({ bindSessionAtSpawn: true })
  }
}

/**
 * Wire the server to newline-delimited JSON over a pair of streams. Kept separate from the
 * request logic so tests (and a future wrapper) can drive `handleLine` directly.
 */
export function serveStdio(
  server: ReturnType<typeof createMcpServer>,
  io: {
    input: NodeJS.ReadableStream
    output: NodeJS.WritableStream
    maxLineBytes?: number
  }
): () => void {
  const maxLine = io.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES
  let buffer = ''

  const onData = (chunk: Buffer | string): void => {
    buffer += chunk.toString()
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.length > maxLine) {
        io.output.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: ERROR.tooLarge, message: 'That request was too large to process.' }
          })}\n`
        )
      } else {
        void server.handleLine(line).then((response) => {
          if (response) io.output.write(`${JSON.stringify(response)}\n`)
        })
      }
      newline = buffer.indexOf('\n')
    }
  }

  io.input.on('data', onData)
  return () => {
    io.input.off?.('data', onData)
    buffer = ''
  }
}

/**
 * Read the bridge token from the environment.
 *
 * OpenCode spawns this server, so the token cannot live in a config file. Two names are
 * accepted because the config generator emits `NEXUS_BRIDGE_TOKEN`; keeping the older
 * `NEXUS_BRIDGE_SECRET` readable means a half-migrated config still starts, loudly.
 */
export function resolveSecret(
  env: Record<string, string | undefined> = process.env
): { ok: true; secret: string } | { ok: false; message: string } {
  const token = env.NEXUS_BRIDGE_TOKEN ?? env.NEXUS_BRIDGE_SECRET ?? ''
  if (token.length === 0) {
    return {
      ok: false,
      message:
        'No bridge token in the environment. The server was started without NEXUS_BRIDGE_TOKEN, so it cannot tell which session it belongs to.'
    }
  }
  if (token.length < 16) {
    return { ok: false, message: 'The bridge token is too short to be meaningful.' }
  }
  return { ok: true, secret: token }
}
