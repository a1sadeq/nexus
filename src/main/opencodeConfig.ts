/**
 * OpenCode configuration fragment for the Nexus MCP bridge (plan 01, step 1).
 *
 * ## What changed after checking the docs
 *
 * OpenCode is the MCP **client**: *it* spawns the server, not the other way round. That
 * reverses the topology my earlier transport assumed, and it has a consequence I have to
 * state plainly: a shared secret checked inside the server proves nothing here, because the
 * process that spawns the server chose the environment it runs in. The real boundary is the
 * private socket the shim connects to (see `agentBrokerIpc`), where the OS tells us the peer
 * uid. The token below is a *correlation* value — it binds a connection to a Nexus session —
 * not authentication.
 *
 * ## Two config shapes, and why this matters
 *
 * OpenCode 2 (2.0.22 is what you have) moved to:
 *   - `mcp.servers.<name>` with `disabled: true` to park a server (v1 used `mcp.<name>` + `enabled`),
 *   - `permissions` as an **ordered array** where the last matching rule wins
 *     (v1 used a `permission` map per tool, and `bash` where v2 says `shell`).
 *
 * Writing the v1 shape into a v2 config fails silently — the server simply never appears —
 * which is exactly the class of bug plan 01 warns about. So this module emits one shape at a
 * time, says which it emitted, and refuses to merge a shape it cannot prove.
 *
 * Everything here is generated, never hand-edited: the paths are absolute, the token is an
 * `{env:…}` reference rather than a literal, and the caller writes the file.
 */

export type OpencodeConfigVersion = 'v2' | 'v1'

export interface McpEntryOptions {
  version: OpencodeConfigVersion
  /** Executable that runs the shim, e.g. /usr/bin/node. Must be absolute. */
  nodePath: string
  /** Absolute path to the shim script Nexus writes to its userData directory. */
  shimPath: string
  /** Unix socket the shim connects to. */
  socketPath: string
  /** Nexus session this entry is bound to. */
  sessionId: string
  /** Environment variable carrying the correlation token. Never the token itself. */
  tokenEnvVar?: string
  serverName?: string
  /** Milliseconds OpenCode waits for the server to answer. */
  timeoutMs?: number
}

export interface GeneratedFragment {
  version: OpencodeConfigVersion
  serverName: string
  /** The `mcp` portion to merge. */
  mcp: Record<string, unknown>
  /** The permission rules to merge (array in v2, map in v1). */
  permissions: unknown
  /** Things the user should know before this is written. */
  warnings: string[]
}

const DEFAULT_NAME = 'nexus'
const DEFAULT_TOKEN_ENV = 'NEXUS_BRIDGE_TOKEN'
const DEFAULT_TIMEOUT = 15_000

const isAbsolute = (value: string): boolean => typeof value === 'string' && value.startsWith('/')

/** Nexus tool names are namespaced, so a permission rule can target exactly them. */
export const NEXUS_TOOL_PREFIX = 'nexus_'

export function buildServerEntry(options: McpEntryOptions): Record<string, unknown> {
  const tokenEnvVar = options.tokenEnvVar ?? DEFAULT_TOKEN_ENV
  const entry: Record<string, unknown> = {
    type: 'local',
    command: [options.nodePath, options.shimPath],
    environment: {
      NEXUS_BRIDGE_SOCKET: options.socketPath,
      NEXUS_BRIDGE_SESSION: options.sessionId,
      // `{env:VAR}` is interpolated by OpenCode; the token itself never touches the file.
      [tokenEnvVar]: `{env:${tokenEnvVar}}`
    },
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT
  }
  if (options.version === 'v2') {
    entry.disabled = false
  } else {
    entry.enabled = true
  }
  return entry
}

/**
 * Permission rules as defence in depth. They are **not** the security boundary — an agent
 * with a shell can rewrite the config — but they keep the obvious mistakes in front of the
 * user instead of behind them.
 */
export function buildPermissionRules(options: McpEntryOptions): unknown {
  const rules = [
    // Every Nexus tool asks. The bridge re-checks grants regardless of what OpenCode allows.
    { action: `${NEXUS_TOOL_PREFIX}*`, resource: '*', effect: 'ask' },
    // Shell is the agent's widest authority; Nexus never grants it implicitly.
    { action: 'shell', resource: '*', effect: 'ask' },
    { action: 'edit', resource: '*', effect: 'ask' },
    { action: 'external_directory', resource: '*', effect: 'deny' }
  ]
  if (options.version === 'v2') return rules
  // v1 shape: a map keyed by tool, `shell` spelled `bash`.
  return {
    [`${NEXUS_TOOL_PREFIX}*`]: 'ask',
    bash: 'ask',
    edit: 'ask',
    external_directory: 'deny'
  }
}

export function buildFragment(options: McpEntryOptions): { ok: true; fragment: GeneratedFragment } | { ok: false; message: string } {
  const serverName = options.serverName ?? DEFAULT_NAME
  if (!isAbsolute(options.nodePath) || !isAbsolute(options.shimPath) || !isAbsolute(options.socketPath)) {
    return {
      ok: false,
      message:
        'The executable, the shim and the socket must all be absolute paths: OpenCode starts the server from an unknown working directory.'
    }
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(serverName)) {
    return { ok: false, message: `"${serverName}" is not a valid MCP server name.` }
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(options.sessionId)) {
    return { ok: false, message: 'The session id must be an environment-safe identifier.' }
  }

  const entry = buildServerEntry({ ...options, serverName })
  const mcp = options.version === 'v2' ? { servers: { [serverName]: entry } } : { [serverName]: entry }
  const warnings = [
    `This is the OpenCode ${options.version} config shape. OpenCode silently ignores the other one: on v2 the server must be under "mcp.servers", on v1 directly under "mcp".`,
    'Nexus has not verified this file against a running OpenCode on your machine. If the server does not appear, the shape is the first thing to check.'
  ]
  if (options.version === 'v1') {
    warnings.push('OpenCode 2.0.22 expects the v2 shape; v1 output is only for older binaries.')
  }

  return {
    ok: true,
    fragment: {
      version: options.version,
      serverName,
      mcp,
      permissions: buildPermissionRules({ ...options, serverName }),
      warnings
    }
  }
}

export type MergeResult =
  | { ok: true; config: Record<string, unknown>; changes: string[] }
  | { ok: false; message: string }

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Merge the fragment into an existing config without touching anything else.
 *
 * Refuses instead of overwriting when:
 *  - a `nexus` entry already exists with a different command (someone else's definition),
 *  - the existing config is the other version's shape (`mcp.<name>` when we are writing v2),
 *  - the root is not an object.
 */
export function mergeIntoConfig(existing: unknown, fragment: GeneratedFragment): MergeResult {
  const config = existing === undefined || existing === null ? {} : existing
  if (!isPlainObject(config)) {
    return { ok: false, message: 'The existing OpenCode config is not a JSON object; refusing to replace it.' }
  }

  const changes: string[] = []
  const existsV1 = isPlainObject(config.mcp) && fragment.serverName in (config.mcp as Record<string, unknown>)
  const existsV2 =
    isPlainObject(config.mcp) &&
    isPlainObject((config.mcp as Record<string, unknown>).servers) &&
    fragment.serverName in ((config.mcp as Record<string, unknown>).servers as Record<string, unknown>)

  if (fragment.version === 'v2' && existsV1) {
    return {
      ok: false,
      message:
        'This config already has the server at mcp.<name>, which is the v1 shape. OpenCode 2 ignores it. Move the entry by hand rather than letting Nexus guess which one your binary reads.'
    }
  }
  if (fragment.version === 'v1' && existsV2) {
    return {
      ok: false,
      message: 'This config uses the v2 shape (mcp.servers). Writing a v1 entry would be ignored.'
    }
  }

  const existingEntry = existsV2
    ? ((config.mcp as Record<string, unknown>).servers as Record<string, unknown>)[fragment.serverName]
    : existsV1
      ? (config.mcp as Record<string, unknown>)[fragment.serverName]
      : undefined

  if (existingEntry !== undefined) {
    const current = existingEntry as Record<string, unknown>
    const next = fragment.version === 'v2'
      ? (fragment.mcp.servers as Record<string, unknown>)[fragment.serverName]
      : (fragment.mcp as Record<string, unknown>)[fragment.serverName]
    const currentCommand = JSON.stringify(current?.command)
    const nextCommand = JSON.stringify((next as Record<string, unknown>)?.command)
    if (currentCommand !== nextCommand) {
      return {
        ok: false,
        message:
          'An MCP server named "' +
          fragment.serverName +
          '" already exists with a different command. Nexus will not replace another server definition.'
      }
    }
  }

  const merged: Record<string, unknown> = { ...config }
  if (fragment.version === 'v2') {
    const mcp = isPlainObject(merged.mcp) ? { ...(merged.mcp as Record<string, unknown>) } : {}
    const servers = isPlainObject(mcp.servers) ? { ...(mcp.servers as Record<string, unknown>) } : {}
    servers[fragment.serverName] = (fragment.mcp.servers as Record<string, unknown>)[fragment.serverName]
    mcp.servers = servers
    merged.mcp = mcp
    changes.push(`mcp.servers.${fragment.serverName}`)

    // Permission rules are appended, so they win: v2 evaluates the last matching rule.
    const existingRules = Array.isArray(merged.permissions) ? [...(merged.permissions as unknown[])] : []
    const incoming = fragment.permissions as unknown[]
    for (const rule of incoming) {
      const key = JSON.stringify(rule)
      if (!existingRules.some((entry) => JSON.stringify(entry) === key)) {
        existingRules.push(rule)
        changes.push(`permissions += ${String((rule as Record<string, unknown>).action)}`)
      }
    }
    merged.permissions = existingRules
  } else {
    const mcp = isPlainObject(merged.mcp) ? { ...(merged.mcp as Record<string, unknown>) } : {}
    mcp[fragment.serverName] = (fragment.mcp as Record<string, unknown>)[fragment.serverName]
    merged.mcp = mcp
    changes.push(`mcp.${fragment.serverName}`)

    const permission = isPlainObject(merged.permission) ? { ...(merged.permission as Record<string, unknown>) } : {}
    Object.assign(permission, fragment.permissions as Record<string, unknown>)
    merged.permission = permission
    changes.push('permission (v1 map)')
  }

  return { ok: true, config: merged, changes }
}

/** What the user is shown before the file is written. Never includes the token. */
export function describeFragment(fragment: GeneratedFragment): string {
  const entry = fragment.version === 'v2'
    ? (fragment.mcp.servers as Record<string, unknown>)[fragment.serverName]
    : (fragment.mcp as Record<string, unknown>)[fragment.serverName]
  const command = ((entry as Record<string, unknown>).command as string[]).join(' ')
  return [
    `OpenCode ${fragment.version} entry "${fragment.serverName}": ${command}`,
    'The bridge token is referenced as {env:…}; no secret is written to the config file.',
    'Permissions added: nexus_* ask, shell ask, edit ask, external_directory deny.'
  ].join('\n')
}
