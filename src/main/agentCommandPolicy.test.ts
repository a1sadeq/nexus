import { describe, it, expect } from 'vitest'
import {
  alwaysAsks,
  assessCommand,
  describeCommand,
  type ApprovedCommand,
  type CommandPolicyContext,
  type CommandRequest
} from './agentCommandPolicy'

const ROOT = '/home/user/project'

const context = (overrides: Partial<CommandPolicyContext> = {}): CommandPolicyContext => ({
  projectRoot: ROOT,
  approved: [],
  egress: 'off',
  ...overrides
})

const cmd = (executable: string, args: string[] = [], cwd = ROOT): CommandRequest => ({
  executable,
  args,
  cwd
})

const approvedCommand = (executable: string, args: string[] = []): ApprovedCommand => ({
  executable,
  args,
  scope: 'project',
  approvedAt: Date.now()
})

describe('exact approvals', () => {
  it('allows exactly the approved command', () => {
    const verdict = assessCommand(
      cmd('npm', ['test']),
      context({ approved: [approvedCommand('npm', ['test'])] })
    )
    expect(verdict.decision).toBe('allow')
  })

  it('does not widen an approval when the arguments differ', () => {
    const verdict = assessCommand(
      cmd('npm', ['test', '--', '--watch']),
      context({ approved: [approvedCommand('npm', ['test'])] })
    )
    expect(verdict.decision).toBe('ask')
    if (verdict.decision === 'ask') expect(verdict.code).toBe('not-approved')
    expect(verdict.decision === 'ask' && verdict.reason).toContain('does not widen')
  })

  it('asks for a binary that was never approved', () => {
    const verdict = assessCommand(cmd('pytest'), context())
    expect(verdict.decision).toBe('ask')
    if (verdict.decision === 'ask') expect(verdict.code).toBe('requires-user-approval')
  })

  it('asks when the approved command was recorded for another cwd', () => {
    const verdict = assessCommand(
      cmd('npm', ['test'], `${ROOT}/sub`),
      context({ approved: [{ ...approvedCommand('npm', ['test']), cwd: ROOT }] })
    )
    expect(verdict.decision).toBe('ask')
  })
})

describe('shell and interpreter escapes', () => {
  it('denies shell metacharacters, because nothing runs through a shell', () => {
    for (const args of [['a', '&&', 'rm'], ['x;y'], ['$(whoami)'], ['a > b']]) {
      const verdict = assessCommand(cmd('echo', args), context())
      expect(verdict.decision).toBe('deny')
      if (verdict.decision === 'deny') expect(verdict.code).toBe('shell-metacharacters')
    }
  })

  it('always asks for a shell, even when the exact tuple was approved', () => {
    const verdict = assessCommand(
      cmd('bash', ['-c', 'make test']),
      context({ approved: [approvedCommand('bash', ['-c', 'make test'])] })
    )
    expect(verdict.decision).toBe('ask')
    if (verdict.decision === 'ask') expect(verdict.code).toBe('interpreter')
  })

  it('always asks for an inline interpreter', () => {
    const inlineInterpreters: [string, string][] = [
      ['python3', '-c'],
      ['node', '-e'],
      ['perl', '-e']
    ]
    for (const [exe, flag] of inlineInterpreters) {
      const verdict = assessCommand(cmd(exe, [flag, 'print(1)']), context())
      expect(verdict.decision).toBe('ask')
      if (verdict.decision === 'ask') expect(verdict.code).toBe('interpreter')
    }
  })

  it('allows a script run by an interpreter without an inline flag only when approved', () => {
    const verdict = assessCommand(
      cmd('python3', ['scripts/check.py']),
      context({ approved: [approvedCommand('python3', ['scripts/check.py'])] })
    )
    // A file can be edited between approval and run, so the policy still allows the exact
    // tuple but the caller must hash the script; the verdict itself is "allow".
    expect(verdict.decision).toBe('allow')
  })
})

describe('destructive and history-rewriting commands', () => {
  it('asks for rm regardless of approval', () => {
    const verdict = assessCommand(cmd('rm', ['-rf', 'build']), context({
      approved: [approvedCommand('rm', ['-rf', 'build'])]
    }))
    expect(verdict.decision).toBe('ask')
    if (verdict.decision === 'ask') expect(verdict.code).toBe('destructive')
  })

  it('asks for git push, reset --hard, clean and rebase', () => {
    for (const args of [['push'], ['reset', '--hard'], ['clean', '-fd'], ['rebase', 'main']]) {
      const verdict = assessCommand(cmd('git', args), context())
      expect(verdict.decision).toBe('ask')
      if (verdict.decision === 'ask') expect(verdict.code).toBe('destructive')
    }
  })

  it('does not block read-only git', () => {
    const verdict = assessCommand(
      cmd('git', ['status', '--porcelain']),
      context({ approved: [approvedCommand('git', ['status', '--porcelain'])] })
    )
    expect(verdict.decision).toBe('allow')
  })
})

describe('network and installs', () => {
  it('denies network commands when egress is off', () => {
    const networkCommands: [string, string[]][] = [
      ['curl', ['https://example.com']],
      ['wget', ['https://example.com/x']],
      ['npm', ['install', 'left-pad']]
    ]
    for (const [exe, args] of networkCommands) {
      const verdict = assessCommand(cmd(exe, args), context({ egress: 'off' }))
      expect(verdict.decision).toBe('deny')
      if (verdict.decision === 'deny') expect(verdict.code).toBe('network-denied')
    }
  })

  it('asks — never silently allows — when an allowlist is configured', () => {
    const verdict = assessCommand(
      cmd('curl', ['https://registry.npmjs.org/x']),
      context({ egress: 'allowlist', egressAllowlist: ['registry.npmjs.org'] })
    )
    expect(verdict.decision).toBe('ask')
    if (verdict.decision === 'ask') expect(verdict.reason).toContain('cannot see the hosts')
  })

  it('does not treat a local npm script as a network command', () => {
    const verdict = assessCommand(
      cmd('npm', ['run', 'test']),
      context({ egress: 'off', approved: [approvedCommand('npm', ['run', 'test'])] })
    )
    expect(verdict.decision).toBe('allow')
  })
})

describe('boundaries', () => {
  it('denies a working directory outside the project', () => {
    const verdict = assessCommand(cmd('ls', [], '/etc'), context())
    expect(verdict.decision).toBe('deny')
    if (verdict.decision === 'deny') expect(verdict.code).toBe('outside-project')
  })

  it('denies an absolute path argument outside the project and temp', () => {
    const verdict = assessCommand(cmd('cat', ['/etc/passwd']), context())
    expect(verdict.decision).toBe('deny')
    if (verdict.decision === 'deny') expect(verdict.code).toBe('absolute-path-argument')
  })

  it('denies an argument that touches a protected path', () => {
    const verdict = assessCommand(
      cmd('cat', [`${ROOT}/.env`]),
      context({ protectedPaths: [`${ROOT}/.env`] })
    )
    expect(verdict.decision).toBe('deny')
    if (verdict.decision === 'deny') expect(verdict.code).toBe('protected-path')
  })

  it('rejects a malformed request outright', () => {
    expect(assessCommand({ executable: '', args: [], cwd: ROOT }, context()).decision).toBe('deny')
    expect(assessCommand({ executable: 'ls', args: [1 as never], cwd: ROOT }, context()).decision).toBe('deny')
    expect(assessCommand({ executable: 'ls', args: [], cwd: 'relative' }, context()).decision).toBe('deny')
  })

  it('reports which classes always require the user', () => {
    expect(alwaysAsks(cmd('bash', ['-c', 'x']))).toBe(true)
    expect(alwaysAsks(cmd('rm', ['-rf', 'x']))).toBe(true)
    expect(alwaysAsks(cmd('ls', []))).toBe(false)
  })

  it('describes a command without truncating it', () => {
    const long = 'a'.repeat(300)
    expect(describeCommand(cmd('echo', [long]))).toContain(long)
  })
})
