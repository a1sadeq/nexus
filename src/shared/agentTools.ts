/**
 * Typed MCP tool surface for the Nexus agent bridge (plan 01, step 2).
 *
 * Everything an agent can ask for is listed here, is a discriminated union member, and is
 * validated by one function. Three rules from the plan are encoded structurally:
 *
 *  - `prepare` and `dispatch` are DIFFERENT tools. Preparing a message can never send it.
 *  - every `effect` tool requires an `idempotencyKey`, so a retried transport cannot send
 *    twice.
 *  - validation accepts only what is described: unknown keys are rejected rather than
 *    ignored, because "ignored" is how a future field silently becomes an authorisation.
 *
 * Nothing here decides whether a call is *allowed* — that is the job of grants, the command
 * policy and the edit gate, each of which re-checks at the moment of the effect.
 */

export const AGENT_TOOL_NAMES = [
  'nexus_status',
  'nexus_consult',
  'nexus_result',
  'nexus_request_context',
  'nexus_submit_review',
  'nexus_prepare_edit',
  'nexus_dispatch_message'
] as const

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number]

/** read-only < prepare < effect. Higher levels need more checks before they can run. */
export type ToolLevel = 'read-only' | 'prepare' | 'effect'

export interface AgentToolSpec {
  name: AgentToolName
  level: ToolLevel
  description: string
  /** Keys the tool accepts, in addition to `sessionId`. */
  keys: string[]
  /** Keys that must be present and non-empty. */
  required: string[]
  maxStringLength: number
}

export const AGENT_TOOLS: Record<AgentToolName, AgentToolSpec> = {
  nexus_status: {
    name: 'nexus_status',
    level: 'read-only',
    description:
      'Report what Nexus can currently observe: session phase, grant revision, paused/stopped state. Never implies that a provider accepted or understood anything.',
    keys: [],
    required: [],
    maxStringLength: 256
  },
  nexus_consult: {
    name: 'nexus_consult',
    level: 'prepare',
    description:
      'Prepare a question for the user’s Arena conversation. Prepares only: the message is not sent until a separately approved dispatch.',
    keys: ['question', 'contextPaths', 'requestId'],
    required: ['question', 'requestId'],
    maxStringLength: 20_000
  },
  nexus_result: {
    name: 'nexus_result',
    level: 'read-only',
    description:
      'Read the latest observed Arena reply for this session, with its correlation state. A reply marked uncertain is not attributable to the request.',
    keys: ['requestId'],
    required: ['requestId'],
    maxStringLength: 256
  },
  nexus_request_context: {
    name: 'nexus_request_context',
    level: 'prepare',
    description:
      'Ask the user to approve reading specific project files as context. Returns a request id; the files are read only after the user approves them.',
    keys: ['paths', 'reason', 'requestId'],
    required: ['paths', 'reason', 'requestId'],
    maxStringLength: 4_096
  },
  nexus_submit_review: {
    name: 'nexus_submit_review',
    level: 'prepare',
    description:
      'Submit a proposed patch and its evidence for review. Submission is not approval; approval is bound to the exact content hash and base revision.',
    keys: ['requestId', 'patch', 'baseRevision', 'targetWorktreeId', 'evidence'],
    required: ['requestId', 'patch', 'baseRevision', 'targetWorktreeId'],
    maxStringLength: 200_000
  },
  nexus_prepare_edit: {
    name: 'nexus_prepare_edit',
    level: 'prepare',
    description:
      'Stage a proposed change in the sandbox and return its identity. Never writes to the real worktree.',
    keys: ['requestId', 'relativePath', 'content', 'baseRevision'],
    required: ['requestId', 'relativePath', 'content', 'baseRevision'],
    maxStringLength: 200_000
  },
  nexus_dispatch_message: {
    name: 'nexus_dispatch_message',
    level: 'effect',
    description:
      'Send a previously prepared message to the bound Arena conversation. Requires an approved grant, a matching prepare id and an idempotency key.',
    keys: ['requestId', 'prepareId', 'idempotencyKey'],
    required: ['requestId', 'prepareId', 'idempotencyKey'],
    maxStringLength: 256
  }
}

export interface AgentToolCall {
  tool: AgentToolName
  level: ToolLevel
  sessionId: string
  args: Record<string, unknown>
}

export type AgentToolErrorCode =
  | 'unknown-tool'
  | 'invalid-arguments'
  | 'unknown-key'
  | 'missing-key'
  | 'bad-type'
  | 'too-long'
  | 'too-many-items'
  | 'unsafe-path'
  | 'missing-idempotency-key'
  | 'session-mismatch'

export type ToolValidation =
  | { ok: true; call: AgentToolCall }
  | { ok: false; code: AgentToolErrorCode; message: string }

export interface ValidationLimits {
  /** Absolute directories an agent may name. Anything else is refused, not normalised into. */
  allowedRoots?: string[]
  maxItems?: number
  maxStringLength?: number
}

const DEFAULT_MAX_ITEMS = 200

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A path is accepted only if it is absolute, already normalised, and inside an allowed root.
 * Symlinks are deliberately not resolved here: resolution happens at use time, on the real
 * filesystem, by the component that opens the file.
 */
export function isSafeAgentPath(candidate: string, allowedRoots: string[]): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 4096) return false
  if (candidate.includes('\0')) return false
  if (!candidate.startsWith('/')) return false
  const segments = candidate.split('/')
  if (segments.some((segment) => segment === '..' || segment === '.')) return false
  if (allowedRoots.length === 0) return false
  return allowedRoots.some((root) => {
    const clean = root.replace(/\/+$/, '')
    return candidate === clean || candidate.startsWith(`${clean}/`)
  })
}

export function validateToolCall(
  raw: unknown,
  limits: ValidationLimits = {},
  /**
   * Session bound to this server *at spawn time*.
   *
   * MCP clients do not send a Nexus session id, so the only trustworthy source is the
   * process that was started for that session. When this is supplied the caller has no say
   * in the identity, and a caller that nevertheless sends a different one is refused rather
   * than silently ignored: a confused caller should be loud, not quietly corrected.
   */
  boundSessionId?: string
): ToolValidation {
  if (!isPlainObject(raw)) {
    return { ok: false, code: 'invalid-arguments', message: 'A tool call must be an object.' }
  }
  const tool = raw.tool
  if (typeof tool !== 'string' || !(AGENT_TOOL_NAMES as readonly string[]).includes(tool)) {
    return {
      ok: false,
      code: 'unknown-tool',
      message: `Unknown tool. Known tools: ${AGENT_TOOL_NAMES.join(', ')}.`
    }
  }
  const spec = AGENT_TOOLS[tool as AgentToolName]
  const args = raw.args ?? {}
  if (!isPlainObject(args)) {
    return { ok: false, code: 'invalid-arguments', message: 'Tool arguments must be an object.' }
  }

  const claimed = raw.sessionId
  let sessionId: string
  if (boundSessionId !== undefined) {
    if (claimed !== undefined && typeof claimed === 'string' && claimed.trim() !== boundSessionId) {
      return {
        ok: false,
        code: 'session-mismatch',
        message: 'This bridge is bound to a different session. The session is decided when the process starts, not by the caller.'
      }
    }
    sessionId = boundSessionId
  } else if (typeof claimed !== 'string' || claimed.trim().length === 0 || claimed.length > 256) {
    return {
      ok: false,
      code: 'invalid-arguments',
      message: 'A session id is required; it identifies the session, it does not authorise it.'
    }
  } else {
    sessionId = claimed
  }

  const maxString = Math.min(spec.maxStringLength, limits.maxStringLength ?? Infinity)
  const maxItems = limits.maxItems ?? DEFAULT_MAX_ITEMS

  for (const key of Object.keys(args)) {
    if (!spec.keys.includes(key)) {
      return {
        ok: false,
        code: 'unknown-key',
        message: `${spec.name} does not accept "${key}". Unknown keys are rejected so a new field cannot become an implicit permission.`
      }
    }
  }

  for (const key of spec.required) {
    if (!(key in args) || args[key] === undefined || args[key] === null) {
      return { ok: false, code: 'missing-key', message: `${spec.name} requires "${key}".` }
    }
  }

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      if (value.length > maxString) {
        return {
          ok: false,
          code: 'too-long',
          message: `"${key}" is too long (${value.length} > ${maxString} characters).`
        }
      }
      continue
    }
    if (Array.isArray(value)) {
      if (value.length > maxItems) {
        return { ok: false, code: 'too-many-items', message: `"${key}" has too many entries.` }
      }
      if (!value.every((entry) => typeof entry === 'string')) {
        return { ok: false, code: 'bad-type', message: `"${key}" must be a list of strings.` }
      }
      continue
    }
    if (isPlainObject(value)) continue
    if (typeof value === 'number' || typeof value === 'boolean') continue
    return { ok: false, code: 'bad-type', message: `"${key}" has an unsupported type.` }
  }

  if (spec.level === 'effect' && typeof args.idempotencyKey !== 'string') {
    return {
      ok: false,
      code: 'missing-idempotency-key',
      message: 'Effect tools require an idempotency key so a retried message cannot send twice.'
    }
  }

  // Paths are checked only where the caller supplied roots; without roots nothing is allowed.
  const pathLists: string[][] = []
  if (Array.isArray(args.paths)) pathLists.push(args.paths as string[])
  if (Array.isArray(args.contextPaths)) pathLists.push(args.contextPaths as string[])
  if (typeof args.relativePath === 'string') {
    if (args.relativePath.includes('..') || args.relativePath.startsWith('/')) {
      return {
        ok: false,
        code: 'unsafe-path',
        message: 'relativePath must be relative to the bound worktree and may not contain "..".'
      }
    }
  }
  for (const list of pathLists) {
    for (const candidate of list) {
      if (!isSafeAgentPath(candidate, limits.allowedRoots ?? [])) {
        return {
          ok: false,
          code: 'unsafe-path',
          message: `"${candidate}" is outside the paths this session may name.`
        }
      }
    }
  }

  return {
    ok: true,
    call: { tool: spec.name, level: spec.level, sessionId, args: { ...args } }
  }
}

/** Machine-readable list of what the agent is offered. Used by MCP `tools/list`. */
export function describeTools(options: { bindSessionAtSpawn?: boolean } = {}): {
  name: AgentToolName
  description: string
  inputSchema: { type: 'object'; properties: Record<string, { type: string }>; required: string[] }
}[] {
  const exposeSessionId = options.bindSessionAtSpawn !== true
  return AGENT_TOOL_NAMES.map((name) => {
    const spec = AGENT_TOOLS[name]
    const properties: Record<string, { type: string }> = exposeSessionId ? { sessionId: { type: 'string' } } : {}
    for (const key of spec.keys) {
      properties[key] = { type: key === 'paths' || key === 'contextPaths' ? 'array' : 'string' }
    }
    return {
      name,
      description: spec.description,
      inputSchema: {
        type: 'object',
        properties,
        required: exposeSessionId ? ['sessionId', ...spec.required] : [...spec.required]
      }
    }
  })
}
