import { describe, it, expect } from 'vitest'
import {
  stripUiNoise,
  stripConversationalFluff,
  parseRawTranscript,
  deduplicateCodeAcrossTurns,
  extractLatestCodeArtifacts,
  buildAgentHandoffPrompt,
  estimateTokens
} from './contextCompressor'

describe('contextCompressor - stripUiNoise (Repaired for technical fidelity)', () => {
  it('strips copy code buttons and feedback prompts without deleting array indexes or timestamps', () => {
    const raw = `
User prompt here
Copy code
\`\`\`typescript
const a = list[1]; // log at 10:45 AM
\`\`\`
Was this response better?
[1] Some citation line
`
    const cleaned = stripUiNoise(raw)
    expect(cleaned).not.toContain('Copy code')
    expect(cleaned).not.toContain('Was this response better?')
    // Critical fidelity invariants: array indexes and timestamps in code/logs MUST survive!
    expect(cleaned).toContain('list[1]')
    expect(cleaned).toContain('10:45 AM')
  })
})

describe('contextCompressor - stripConversationalFluff', () => {
  it('removes opening pleasantries and closing boilerplate from prose only', () => {
    const raw = 'Certainly! Here is the updated code for your task:\nconst x = 42;\n\nI hope this helps! Let me know if you need anything else!'
    const cleaned = stripConversationalFluff(raw)
    expect(cleaned).not.toContain('Certainly!')
    expect(cleaned).not.toContain('I hope this helps!')
    expect(cleaned).toContain('const x = 42;')
  })
})

describe('contextCompressor - parseRawTranscript (Fence-aware)', () => {
  it('parses ## User and ## Assistant blocks into structured turns', () => {
    const transcript = `
## User
Can you fix the login bug?

## Assistant
Here is the fix:
\`\`\`typescript
function login() { return true; }
\`\`\`
`
    const turns = parseRawTranscript(transcript)
    expect(turns.length).toBe(2)
    expect(turns[0].role).toBe('user')
    expect(turns[0].text).toContain('fix the login bug')
    expect(turns[1].role).toBe('assistant')
    expect(turns[1].codeBlocks?.length).toBe(1)
  })

  it('does NOT split turns when ## Headings appear inside markdown code fences', () => {
    const raw = `## User
Please explain markdown formatting:
\`\`\`markdown
## Assistant
This heading is inside a code block!
\`\`\`
## Assistant
Done explaining.`
    const turns = parseRawTranscript(raw)
    expect(turns.length).toBe(2)
    expect(turns[0].role).toBe('user')
    expect(turns[0].text).toContain('## Assistant\nThis heading is inside a code block!')
    expect(turns[1].role).toBe('assistant')
  })
})

describe('contextCompressor - deduplicateCodeAcrossTurns (Exact equality)', () => {
  it('replaces earlier identical code blocks with a pointer note', () => {
    const repeatedCode = 'function largeComponent() {\n  console.log("very long block of code here");\n  return <div>Component</div>;\n}'
    const turns = [
      {
        role: 'assistant' as const,
        text: `Here is the first try:\n\`\`\`tsx\n${repeatedCode}\n\`\`\``,
        codeBlocks: [{ lang: 'tsx', code: repeatedCode }]
      },
      {
        role: 'user' as const,
        text: 'Can you show it again?'
      },
      {
        role: 'assistant' as const,
        text: `Here it is again:\n\`\`\`tsx\n${repeatedCode}\n\`\`\``,
        codeBlocks: [{ lang: 'tsx', code: repeatedCode }]
      }
    ]

    const deduplicated = deduplicateCodeAcrossTurns(turns)
    expect(deduplicated[0].text).toContain('Identical code block omitted — see Turn #3')
    expect(deduplicated[2].text).toContain(repeatedCode)
  })

  it('never deduplicates whitespace-sensitive distinct code blocks', () => {
    const code1 = 'console.log("a  b");\n' + '// padding '.repeat(10)
    const code2 = 'console.log("a b");\n' + '// padding '.repeat(10)

    const turns = [
      { role: 'assistant' as const, text: `\`\`\`js\n${code1}\n\`\`\``, codeBlocks: [{ lang: 'js', code: code1 }] },
      { role: 'user' as const, text: 'Next prompt' },
      { role: 'assistant' as const, text: `\`\`\`js\n${code2}\n\`\`\``, codeBlocks: [{ lang: 'js', code: code2 }] }
    ]

    const result = deduplicateCodeAcrossTurns(turns)
    // Neither block should be omitted because they have different spacing in "a  b" vs "a b"
    expect(result[0].text).not.toContain('Identical code block omitted')
    expect(result[0].text).toContain(code1)
    expect(result[2].text).toContain(code2)
  })
})

describe('contextCompressor - extractLatestCodeArtifacts', () => {
  it('preserves distinct files even when they share first 60 characters of header', () => {
    const sharedHeader = '// License: Apache 2.0\n// Project: Nexus\n// Module: Core\n'
    const codeA = sharedHeader + 'function calculateAlpha() { return 1; }'
    const codeB = sharedHeader + 'function calculateBeta() { return 2; }'

    const turns = [
      { role: 'assistant' as const, text: `\`\`\`js\n${codeA}\n\`\`\``, codeBlocks: [{ lang: 'js', code: codeA }] },
      { role: 'assistant' as const, text: `\`\`\`js\n${codeB}\n\`\`\``, codeBlocks: [{ lang: 'js', code: codeB }] }
    ]

    const artifacts = extractLatestCodeArtifacts(turns)
    expect(artifacts.length).toBe(2)
    expect(artifacts[0].code).toBe(codeB)
    expect(artifacts[1].code).toBe(codeA)
  })
})

describe('contextCompressor - buildAgentHandoffPrompt', () => {
  it('constructs a full agent handoff prompt with goal, points, and instructions', () => {
    const raw = `
## User
Let's build a desktop application using Electron and Vite. File is src/main/index.ts.

## Assistant
Certainly! We decided to use React for renderer and Electron for backend.
\`\`\`typescript
// src/main/index.ts
export function start() { console.log("ready"); }
\`\`\`
Let me know if you need anything else!

## User
Now please add a system tray icon.
`
    const result = buildAgentHandoffPrompt({
      providerName: 'Claude 3.7',
      rawText: raw,
      options: { mode: 'handoff' }
    })

    expect(result.prompt).toContain('# 🚀 AI AGENT CONTINUATION & SESSION HANDOFF CONTEXT')
    expect(result.prompt).toContain('Primary Objective & Goal')
    expect(result.prompt).toContain('Established Decisions & Technical Constraints')
    expect(result.prompt).toContain('src/main/index.ts')
    expect(result.prompt).toContain('Directive for Incoming AI Agent')
    expect(result.nextImmediateAction).toContain('add a system tray icon')
    expect(result.stats.userTurns).toBe(2)
    expect(result.stats.assistantTurns).toBe(1)
  })

  it('compact mode preserves exact code and identifiers without stopword mutilation', () => {
    const raw = `## Assistant\n\`\`\`js\nconst a = "the value";\nconsole.log(a[1]);\n\`\`\``
    const result = buildAgentHandoffPrompt({
      providerName: 'test',
      rawText: raw,
      options: { mode: 'compact' }
    })

    expect(result.prompt).toContain('const a = "the value"')
    expect(result.prompt).toContain('console.log(a[1])')
  })

  it('renders thinking summary when excludeThinking is false', () => {
    const raw = `## Assistant\n<thinking>Internal reasoning steps</thinking>\nFinal answer.`
    const include = buildAgentHandoffPrompt({
      providerName: 'test',
      rawText: raw,
      options: { excludeThinking: false }
    })
    const exclude = buildAgentHandoffPrompt({
      providerName: 'test',
      rawText: raw,
      options: { excludeThinking: true }
    })

    expect(include.prompt).toContain('Thinking Summary')
    expect(include.prompt).toContain('Internal reasoning steps')
    expect(exclude.prompt).not.toContain('Thinking Summary')
    expect(exclude.prompt).not.toContain('Internal reasoning steps')
  })

  it('preserves System role without mislabeling it as Assistant', () => {
    const raw = `## System\nSystem prompt instruction\n## User\nUser prompt`
    const result = buildAgentHandoffPrompt({ providerName: 'test', rawText: raw })
    expect(result.prompt).toContain('Turn 1 (System)')
    expect(result.prompt).not.toContain('Turn 1 (Assistant)')
  })

  it('estimates tokens accurately', () => {
    expect(estimateTokens('12345678')).toBe(2)
    expect(estimateTokens('')).toBe(0)
  })
})
