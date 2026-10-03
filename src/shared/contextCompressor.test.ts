import { describe, it, expect } from 'vitest'
import {
  stripUiNoise,
  stripConversationalFluff,
  parseRawTranscript,
  deduplicateCodeAcrossTurns,
  buildAgentHandoffPrompt,
  estimateTokens
} from './contextCompressor'

describe('contextCompressor - stripUiNoise', () => {
  it('strips copy code buttons, citations, and timestamps', () => {
    const raw = `
User prompt here
Copy code
\`\`\`typescript
const a = 1;
\`\`\`
Was this response better?
[1] Some citation 10:45 AM
`
    const cleaned = stripUiNoise(raw)
    expect(cleaned).not.toContain('Copy code')
    expect(cleaned).not.toContain('Was this response better?')
    expect(cleaned).not.toContain('[1]')
    expect(cleaned).not.toContain('10:45 AM')
    expect(cleaned).toContain('const a = 1;')
  })
})

describe('contextCompressor - stripConversationalFluff', () => {
  it('removes opening pleasantries and closing boilerplate', () => {
    const raw = 'Certainly! Here is the updated code for your task:\nconst x = 42;\n\nI hope this helps! Let me know if you need anything else!'
    const cleaned = stripConversationalFluff(raw)
    expect(cleaned).not.toContain('Certainly!')
    expect(cleaned).not.toContain('I hope this helps!')
    expect(cleaned).toContain('const x = 42;')
  })
})

describe('contextCompressor - parseRawTranscript', () => {
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
})

describe('contextCompressor - deduplicateCodeAcrossTurns', () => {
  it('replaces earlier identical code blocks with a pointer', () => {
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
    expect(deduplicated[0].text).toContain('Identical code block omitted — see final working version in Turn #3')
    expect(deduplicated[2].text).toContain(repeatedCode)
  })
})

describe('contextCompressor - buildAgentHandoffPrompt', () => {
  it('constructs a full agent handoff prompt with goal, decisions, and instructions', () => {
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

  it('estimates tokens using ~4 chars per token rule', () => {
    expect(estimateTokens('12345678')).toBe(2)
    expect(estimateTokens('')).toBe(0)
  })
})

