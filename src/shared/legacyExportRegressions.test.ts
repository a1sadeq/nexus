import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  stripUiNoise,
  parseRawTranscript,
  deduplicateCodeAcrossTurns,
  extractLatestCodeArtifacts,
  buildAgentHandoffPrompt
} from './contextCompressor'
import {
  buildContextExtractorScript,
  buildSnapshotFromRawPayload,
  type RawExtractionPayload
} from '../main/contextExtraction'
import { projectSnapshotToMarkdown } from './contextSnapshot'

function runRepairedExtractor(html: string, url: string = 'https://arena.ai/agent/test'): RawExtractionPayload {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' })
  try {
    return dom.window.eval(buildContextExtractorScript()) as RawExtractionPayload
  } finally {
    dom.window.close()
  }
}

describe('Repaired Exporter Fidelity Tests (Verifying E01-E13 fixes)', () => {
  it('E01 Fix: Arena user/assistant turns are accurately distinguished and do not collapse into one turn', () => {
    const arenaHtml = `
      <main>
        <div data-agent-transcript-message="true" data-chat-message-id="u1">
          <div data-user-message-layout="true">
            <p>USER_TASK_MARKER: Please refactor login</p>
          </div>
        </div>
        <div data-agent-transcript-message="true" data-chat-message-id="a1">
          <p>ASSISTANT_REPLY_MARKER: Refactoring login now</p>
        </div>
      </main>
    `
    const payload = runRepairedExtractor(arenaHtml, 'https://arena.ai/agent/test-session')
    const snapshot = buildSnapshotFromRawPayload({
      payload,
      tabId: 'tab-1',
      providerKey: 'Arena Agent Mode',
      origin: 'https://arena.ai/agent/test-session',
      contextRevision: 'rev-1'
    })
    const projected = projectSnapshotToMarkdown({ snapshot })

    // Exactly 1 user turn and 1 assistant turn
    expect(projected.stats.userTurns).toBe(1)
    expect(projected.stats.assistantTurns).toBe(1)
    expect(projected.stats.turnCount).toBe(2)
  })

  it('E02 Fix: Workspace/sidebar/composer text is structurally isolated from transcript', () => {
    const arenaHtml = `
      <main>
        <div data-agent-transcript-message="true" data-chat-message-id="u1">
          <div data-user-message-layout="true"><p>User Prompt</p></div>
        </div>
        <aside>Workspace11.4MB/128.0MB588/10K filesConnectors</aside>
        <div class="composer" contenteditable="true">Unsent draft message</div>
      </main>
    `
    const payload = runRepairedExtractor(arenaHtml, 'https://arena.ai/agent/test-session')
    const json = JSON.stringify(payload)
    expect(json).not.toContain('Workspace11.4MB/128.0MB588/10K filesConnectors')
    expect(json).not.toContain('Unsent draft message')
  })

  it('E04 & E05 Fix: Array indexes, timestamps, code strings, and identifiers are strictly preserved', () => {
    // Array index [1] and timestamp survive stripUiNoise
    const codeSnippet = 'const value = list[1]; // log at 10:45 AM'
    const cleaned = stripUiNoise(codeSnippet)
    expect(cleaned).toContain('list[1]')
    expect(cleaned).toContain('10:45 AM')

    // Compact mode preserves code exactly without stopword deletion
    const compactRaw = '## Assistant\n```js\nconst a = "the value";\nconsole.log(a[1]);\n```'
    const compactResult = buildAgentHandoffPrompt({
      providerName: 'test',
      rawText: compactRaw,
      options: { mode: 'compact', stripPleasantries: false }
    })
    expect(compactResult.prompt).toContain('const a = "the value"')
    expect(compactResult.prompt).toContain('console.log(a[1])')
  })

  it('E06 Fix: Role headings inside code blocks do not create false turns', () => {
    const rawWithCodeHeading = `## User
Please explain how to format markdown:
\`\`\`markdown
## Assistant
This heading is inside a code block!
\`\`\`
## Assistant
Here is the real response.`

    const turns = parseRawTranscript(rawWithCodeHeading)
    // Correctly parses as 2 turns (not 3!)
    expect(turns.length).toBe(2)
    expect(turns[0].role).toBe('user')
    expect(turns[1].role).toBe('assistant')
  })

  it('E09 Fix: Whitespace-sensitive distinct code blocks are never deduplicated', () => {
    const code1 = 'console.log("a  b");\n' + '// padding '.repeat(10)
    const code2 = 'console.log("a b");\n' + '// padding '.repeat(10)

    const turns = [
      { role: 'assistant' as const, text: `\`\`\`js\n${code1}\n\`\`\``, codeBlocks: [{ lang: 'js', code: code1 }] },
      { role: 'user' as const, text: 'Next prompt' },
      { role: 'assistant' as const, text: `\`\`\`js\n${code2}\n\`\`\``, codeBlocks: [{ lang: 'js', code: code2 }] }
    ]

    const deduped = deduplicateCodeAcrossTurns(turns)
    expect(deduped[0].text).not.toContain('Identical code block omitted')
    expect(deduped[0].text).toContain(code1)
    expect(deduped[2].text).toContain(code2)
  })

  it('E10 Fix: Distinct artifacts sharing first 60 characters are retained', () => {
    const sharedHeader = '// License: Apache 2.0\n// Project: Nexus\n// Module: Core\n'
    const codeA = sharedHeader + 'function calculateAlpha() { return 1; }'
    const codeB = sharedHeader + 'function calculateBeta() { return 2; }'

    const turns = [
      { role: 'assistant' as const, text: `\`\`\`js\n${codeA}\n\`\`\``, codeBlocks: [{ lang: 'js', code: codeA }] },
      { role: 'assistant' as const, text: `\`\`\`js\n${codeB}\n\`\`\``, codeBlocks: [{ lang: 'js', code: codeB }] }
    ]

    const artifacts = extractLatestCodeArtifacts(turns)
    expect(artifacts.length).toBe(2)
  })

  it('E12 Fix: Thinking toggle renders reasoning summary when enabled and excludes when disabled', () => {
    const rawThinking = '## Assistant\n<thinking>Secret reasoning steps</thinking>\nFinal answer.'
    const includeResult = buildAgentHandoffPrompt({
      providerName: 'test',
      rawText: rawThinking,
      options: { excludeThinking: false }
    })
    const excludeResult = buildAgentHandoffPrompt({
      providerName: 'test',
      rawText: rawThinking,
      options: { excludeThinking: true }
    })

    expect(includeResult.prompt).toContain('Thinking Summary')
    expect(includeResult.prompt).toContain('Secret reasoning steps')
    expect(excludeResult.prompt).not.toContain('Thinking Summary')
    expect(excludeResult.prompt).not.toContain('Secret reasoning steps')
  })

  it('E13 & E20 Fix: System roles render truthfully as System and signed delta is reported', () => {
    const systemRaw = '## System\nYou are a security expert.\n## User\nScan port 80.'
    const result = buildAgentHandoffPrompt({ providerName: 'test', rawText: systemRaw })

    // System turn is rendered with System role
    expect(result.prompt).toContain('Turn 1 (System)')
    expect(result.prompt).not.toContain('Turn 1 (Assistant)')

    // 34-character input expands, and signed delta / isExpanded reports truthfully
    const shortRaw = '## User\nFix the export context.'
    const expanded = buildAgentHandoffPrompt({ providerName: 'test', rawText: shortRaw })
    expect(expanded.stats.compressedChars).toBeGreaterThan(500)
    expect(expanded.stats.isExpanded).toBe(true)
    expect(expanded.stats.signedDeltaChars).toBeGreaterThan(0)
  })
})
