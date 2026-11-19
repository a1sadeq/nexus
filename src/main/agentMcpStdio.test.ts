import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'child_process'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { build } from 'esbuild'
import { createMcpClient, McpClientError, type McpClient } from './agentMcpClient'

/**
 * End-to-end over a real pipe.
 *
 * Everything else about the MCP layer is tested in-process, which cannot catch the failures
 * that actually matter when OpenCode spawns the bridge: a token that never arrives, a session
 * that is not bound, a server that keeps a request alive after the client hangs up. So this
 * bundles the real `agentMcpServer` into a standalone script, starts it the way OpenCode
 * would (env only, no arguments), and drives it through a client that speaks the wire format.
 *
 * The fixture below is *only* the tool handler. No branch of it decides whether a call is
 * allowed — that is the point: the transport is being tested, not policy, and policy lives
 * in the broker where it can see current state.
 */

const TOKEN = 'e2e-token-0123456789abcdef'
const SESSION = 'sess_e2e_1'

const FIXTURE = `
const { createMcpServer, serveStdio, resolveSecret } = require('./agentMcpServer')

const token = resolveSecret(process.env)
if (!token.ok) {
  process.stderr.write(token.message + '\\n')
  process.exit(3)
}
const sessionId = process.env.NEXUS_BRIDGE_SESSION
if (!sessionId) {
  process.stderr.write('NEXUS_BRIDGE_SESSION is missing; the bridge has no session to bind to.\\n')
  process.exit(4)
}

const server = createMcpServer({
  secret: token.secret,
  sessionId,
  handler: async (call) => {
    if (call.tool === 'nexus_status') {
      return { ok: true, result: { state: 'idle', session: call.sessionId } }
    }
    if (call.tool === 'nexus_dispatch_message') {
      return { ok: false, code: 'auto-send-not-granted', message: 'No grant allows sending.' }
    }
    return { ok: true, result: { tool: call.tool, args: call.args } }
  }
})

serveStdio(server, { input: process.stdin, output: process.stdout })
`

let dir = ''
let script = ''
const clients: McpClient[] = []

const startClient = (
  overrides: { spawnToken?: string; presentedToken?: string; session?: string } = {}
): McpClient => {
  const spawnToken = overrides.spawnToken ?? TOKEN
  const client = createMcpClient({
    command: process.execPath,
    args: [script],
    env: { NEXUS_BRIDGE_TOKEN: spawnToken, NEXUS_BRIDGE_SESSION: overrides.session ?? SESSION },
    // Usually the same value: the token in the environment is the one presented on the wire.
    // They are passed separately here so a test can spawn with TOKEN and present another.
    secret: overrides.presentedToken ?? spawnToken,
    timeoutMs: 5_000
  })
  clients.push(client)
  return client
}

beforeAll(async () => {
  const root = resolve(process.cwd(), 'src/main')
  expect(existsSync(join(root, 'agentMcpServer.ts'))).toBe(true)
  const temp = mkdtempSync(join(tmpdir(), 'nexus-mcp-e2e-'))
  script = join(temp, 'bridge.cjs')
  await build({
    // Resolved from the real source directory so the fixture imports the module under test,
    // not a copy of it.
    stdin: { contents: FIXTURE, resolveDir: root, sourcefile: 'nexus-mcp-fixture.ts', loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: script,
    logLevel: 'silent'
  })
  dir = temp
}, 60_000)

afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()))
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('spawned bridge process', () => {
  it('completes the handshake using only the environment', async () => {
    const client = startClient()
    const hello = await client.initialize()
    expect(hello.protocolVersion).toBe('2024-11-05')
    expect(hello.serverInfo.name).toBe('nexus-agent-bridge')
  })

  it('advertises the typed tools without asking the caller for a session', async () => {
    const client = startClient()
    await client.initialize()
    const tools = await client.listTools()
    expect(tools.length).toBe(7)
    for (const tool of tools) {
      expect(tool.inputSchema.required).not.toContain('sessionId')
      expect(Object.keys(tool.inputSchema.properties)).not.toContain('sessionId')
    }
  })

  it('binds the call to the spawn-time session, not to anything the caller said', async () => {
    const client = startClient({ session: 'sess_bound_by_spawner' })
    await client.initialize()
    const result = await client.callTool('nexus_status')
    expect(result.ok).toBe(true)
    expect((result.data as { session: string }).session).toBe('sess_bound_by_spawner')
  })

  it('returns a policy refusal as a readable tool result', async () => {
    const client = startClient()
    await client.initialize()
    const result = await client.callTool('nexus_dispatch_message', {
      requestId: 'req-1',
      prepareId: 'prep-1',
      idempotencyKey: 'idem-1'
    })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('auto-send-not-granted')
    expect(result.message).toContain('No grant')
    // The process must survive a refusal: an agent that is refused should be able to continue.
    const after = await client.callTool('nexus_status')
    expect(after.ok).toBe(true)
  })

  it('refuses an unknown tool over the wire', async () => {
    const client = startClient()
    await client.initialize()
    await expect(client.callTool('nexus_become_root')).rejects.toBeInstanceOf(McpClientError)
  })

  it('refuses a caller with the wrong token, and says nothing specific', async () => {
    const client = startClient({ presentedToken: 'a-different-token-0123456789' })
    await expect(client.initialize()).rejects.toMatchObject({ code: 'unauthorized' })
    const error: unknown = await client.initialize().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(McpClientError)
    const message = error instanceof Error ? error.message : ''
    expect(message).not.toContain(TOKEN)
    expect(message).not.toContain('different')
  })

  it('refuses to start without a token in the environment', async () => {
    const child = spawn(process.execPath, [script], {
      env: { PATH: process.env.PATH ?? '', NEXUS_BRIDGE_SESSION: SESSION },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    const code = await new Promise<number | null>((resolvePromise) => {
      child.on('exit', (exitCode) => resolvePromise(exitCode))
    })
    expect(code).toBe(3)
    expect(stderr).toContain('NEXUS_BRIDGE_TOKEN')
  })

  it('exits cleanly when the client closes the pipe, so no bridge outlives its session', async () => {
    const client = startClient()
    await client.initialize()
    await client.close()
    const exit = await client.exited()
    expect(exit.code).toBe(0)
    expect(client.stderr()).not.toContain(TOKEN)
  })
})
