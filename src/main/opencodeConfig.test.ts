import { describe, it, expect } from 'vitest'
import {
  buildFragment,
  type GeneratedFragment,
  buildPermissionRules,
  buildServerEntry,
  describeFragment,
  mergeIntoConfig,
  type McpEntryOptions
} from './opencodeConfig'

const options = (overrides: Partial<McpEntryOptions> = {}): McpEntryOptions => ({
  version: 'v2',
  nodePath: '/usr/bin/node',
  shimPath: '/home/user/.config/nexus/nexus-mcp-shim.js',
  socketPath: '/run/user/1000/nexus-bridge.sock',
  sessionId: 'sess_abc123',
  timeoutMs: 15_000,
  ...overrides
})

const fragment = (overrides: Partial<McpEntryOptions> = {}): GeneratedFragment => {
  const result = buildFragment(options(overrides))
  if (!result.ok) throw new Error(result.message)
  return result.fragment
}

describe('server entry', () => {
  it('spawns the shim with absolute paths and the socket in the environment', () => {
    const entry = buildServerEntry(options())
    expect(entry.type).toBe('local')
    expect(entry.command).toEqual(['/usr/bin/node', '/home/user/.config/nexus/nexus-mcp-shim.js'])
    const environment = entry.environment as Record<string, string>
    expect(environment.NEXIS_BRIDGE_SOCKET ?? environment.NEXUS_BRIDGE_SOCKET).toBe(
      '/run/user/1000/nexus-bridge.sock'
    )
    expect(environment.NEXUS_BRIDGE_SESSION).toBe('sess_abc123')
  })

  it('references the token through {env:…} and never writes a literal', () => {
    const entry = buildServerEntry(options())
    const environment = entry.environment as Record<string, string>
    expect(environment.NEXUS_BRIDGE_TOKEN).toBe('{env:NEXUS_BRIDGE_TOKEN}')
    expect(JSON.stringify(entry)).not.toMatch(/[a-f0-9]{32}/)
  })

  it('uses "disabled: false" in v2 and "enabled: true" in v1', () => {
    expect(buildServerEntry(options())).toHaveProperty('disabled', false)
    expect(buildServerEntry(options({ version: 'v1' }))).toHaveProperty('enabled', true)
  })
})

describe('config shape', () => {
  it('puts the server under mcp.servers for v2 and under mcp for v1', () => {
    const v2 = fragment()
    expect(Object.keys(v2.mcp)).toEqual(['servers'])
    expect((v2.mcp.servers as Record<string, unknown>).nexus).toBeTruthy()

    const v1 = fragment({ version: 'v1' })
    expect(Object.keys(v1.mcp)).toEqual(['nexus'])
  })

  it('emits permission rules in the shape each version understands', () => {
    expect(Array.isArray(fragment().permissions)).toBe(true)
    const v1Rules = fragment({ version: 'v1' }).permissions as Record<string, string>
    expect(v1Rules['nexus_*']).toBe('ask')
    // v1 spells the shell tool "bash"; v2 spells it "shell".
    expect(v1Rules.bash).toBe('ask')
    const v2Rules = buildPermissionRules(options()) as { action: string; effect: string }[]
    expect(v2Rules.map((rule) => rule.action)).toContain('shell')
    expect(v2Rules.find((rule) => rule.action === 'external_directory')?.effect).toBe('deny')
  })

  it('refuses relative paths, because OpenCode starts the server elsewhere', () => {
    const result = buildFragment(options({ shimPath: 'nexus-mcp-shim.js' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('absolute')
  })

  it('refuses a session id that is not environment-safe', () => {
    const result = buildFragment(options({ sessionId: 'sess/../x' }))
    expect(result.ok).toBe(false)
  })

  it('warns that the shape is unverified and that the wrong one fails silently', () => {
    const warnings = fragment().warnings.join(' ')
    expect(warnings).toContain('silently ignores')
    expect(warnings).toContain('has not verified')
  })
})

describe('merging into an existing config', () => {
  it('adds the server and appends the permission rules', () => {
    const existing = { $schema: 'https://opencode.ai/config.json', model: 'opencode/big-pickle' }
    const result = mergeIntoConfig(existing, fragment())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.model).toBe('opencode/big-pickle')
    const servers = (result.config.mcp as Record<string, unknown>).servers as Record<string, unknown>
    expect(servers.nexus).toBeTruthy()
    expect(Array.isArray(result.config.permissions)).toBe(true)
  })

  it('keeps the user’s existing permission rules and their order', () => {
    const existing = {
      permissions: [
        { action: 'shell', resource: 'git status *', effect: 'allow' },
        { action: 'shell', resource: '*', effect: 'ask' }
      ]
    }
    const result = mergeIntoConfig(existing, fragment())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const rules = result.config.permissions as { action: string; resource: string }[]
    expect(rules[0]).toEqual({ action: 'shell', resource: 'git status *', effect: 'allow' })
    expect(rules.length).toBeGreaterThan(2)
  })

  it('does not duplicate rules that are already present', () => {
    const once = mergeIntoConfig({}, fragment())
    expect(once.ok).toBe(true)
    if (!once.ok) return
    const twice = mergeIntoConfig(once.config, fragment())
    expect(twice.ok).toBe(true)
    if (!twice.ok) return
    expect((twice.config.permissions as unknown[]).length).toBe((once.config.permissions as unknown[]).length)
  })

  it('refuses to replace a different server definition with the same name', () => {
    const existing = {
      mcp: { servers: { nexus: { type: 'local', command: ['/usr/bin/other-thing'] } } }
    }
    const result = mergeIntoConfig(existing, fragment())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('different command')
  })

  it('refuses when the config already uses the other version’s shape', () => {
    const v1Shaped = { mcp: { nexus: { type: 'local', command: ['/usr/bin/node', '/home/user/.config/nexus/nexus-mcp-shim.js'] } } }
    const result = mergeIntoConfig(v1Shaped, fragment())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('v1 shape')
  })

  it('refuses a config that is not an object', () => {
    const result = mergeIntoConfig([1, 2, 3], fragment())
    expect(result.ok).toBe(false)
  })

  it('is re-runnable and reports the same config', () => {
    const first = mergeIntoConfig({}, fragment())
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = mergeIntoConfig(first.config, fragment())
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.config).toEqual(first.config)
  })
})

describe('user-facing description', () => {
  it('shows the command and says no secret is written', () => {
    const text = describeFragment(fragment())
    expect(text).toContain('/usr/bin/node /home/user/.config/nexus/nexus-mcp-shim.js')
    expect(text).toContain('no secret is written')
    expect(text).toContain('external_directory deny')
  })
})
