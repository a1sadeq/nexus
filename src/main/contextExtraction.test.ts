import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  buildContextExtractorScript,
  buildSnapshotFromRawPayload,
  type RawExtractionPayload
} from './contextExtraction'

function runExtractorInDOM(html: string, url: string = 'https://arena.ai/agent/session-123'): RawExtractionPayload {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' })
  try {
    return dom.window.eval(buildContextExtractorScript()) as RawExtractionPayload
  } finally {
    dom.window.close()
  }
}

describe('contextExtraction - Verified Provider Adapters & Exclusions', () => {
  it('Arena Agent Mode: correctly extracts user & assistant turns, code blocks, and structurally excludes workspace & drafts', () => {
    const arenaHtml = `
      <main>
        <div data-agent-transcript-message="true" data-chat-message-id="u-101">
          <div data-user-message-layout="true">
            <p>USER_TASK_MARKER: Please fix the export context modal</p>
          </div>
        </div>

        <div data-agent-transcript-message="true" data-chat-message-id="a-102">
          <p>ASSISTANT_REPLY_MARKER: Here is the repaired code:</p>
          <pre><code class="language-typescript">const items = [1, 2, 3];
console.log(items[0]);</code></pre>
          <a href="https://github.com/nexus/pull/42">Review PR</a>
        </div>

        <aside>Workspace11.4MB/128.0MB588/10K filesConnectors</aside>
        <div class="composer" contenteditable="true">Unsent draft in composer</div>
      </main>
    `

    const payload = runExtractorInDOM(arenaHtml, 'https://arena.ai/agent/task-456')

    expect(payload.success).toBe(true)
    expect(payload.adapterId).toBe('arena-agent-mode')
    expect(payload.turns.length).toBe(2)

    // User turn verification
    expect(payload.turns[0].sourceRole).toBe('user')
    expect(payload.turns[0].roleEvidence).toContain('data-user-message-layout')
    const userText = payload.turns[0].blocks.find((b) => b.type === 'text')?.text
    expect(userText).toContain('Please fix the export context modal')

    // Assistant turn verification
    expect(payload.turns[1].sourceRole).toBe('assistant')
    const codeBlock = payload.turns[1].blocks.find((b) => b.type === 'code')
    expect(codeBlock).toBeDefined()
    expect(codeBlock?.language).toBe('typescript')
    expect(codeBlock?.text).toContain('const items = [1, 2, 3];')
    expect(codeBlock?.text).toContain('items[0]')

    const linkBlock = payload.turns[1].blocks.find((b) => b.type === 'link')
    expect(linkBlock).toBeDefined()
    expect(linkBlock?.destination).toBe('https://github.com/nexus/pull/42')

    // Workspace & composer draft isolation verification
    const allExtractedText = JSON.stringify(payload)
    expect(allExtractedText).not.toContain('Workspace11.4MB')
    expect(allExtractedText).not.toContain('Unsent draft in composer')

    // Build Snapshot test
    const snapshot = buildSnapshotFromRawPayload({
      payload,
      tabId: 'tab-arena-1',
      providerKey: 'Arena Agent Mode',
      origin: 'https://arena.ai',
      title: 'Active Session',
      contextRevision: 'rev-1'
    })

    expect(snapshot.source.adapterId).toBe('arena-agent-mode')
    expect(snapshot.stats.userTurns).toBe(1)
    expect(snapshot.stats.assistantTurns).toBe(1)
    expect(snapshot.stats.codeBlockCount).toBe(1)
  })

  it('ChatGPT Adapter: parses data-message-author-role user and assistant turns', () => {
    const gptHtml = `
      <div class="chat-container">
        <div data-message-author-role="user" data-message-id="m1">
          <p>Explain quantum entanglement</p>
        </div>
        <div data-message-author-role="assistant" data-message-id="m2">
          <p>Quantum entanglement is a phenomenon...</p>
        </div>
      </div>
    `

    const payload = runExtractorInDOM(gptHtml, 'https://chatgpt.com/c/1234')
    expect(payload.success).toBe(true)
    expect(payload.adapterId).toBe('chatgpt')
    expect(payload.turns.length).toBe(2)
    expect(payload.turns[0].sourceRole).toBe('user')
    expect(payload.turns[1].sourceRole).toBe('assistant')
  })

  it('Universal Fallback: marks role as unknown and completeness as partial when no turn boundaries exist', () => {
    const unstructuredHtml = `
      <main>
        <div>
          <p>Some random unstructured document content with no bubble classes or author markers.</p>
        </div>
      </main>
    `

    const payload = runExtractorInDOM(unstructuredHtml, 'https://unknown-ai.local/chat')
    expect(payload.success).toBe(true)
    expect(payload.adapterId).toBe('universal-fallback')
    expect(payload.completeness).toBe('partial')
    expect(payload.warnings.length).toBeGreaterThan(0)

    if (payload.turns.length > 0) {
      // Must NOT be labeled as Assistant!
      expect(payload.turns[0].sourceRole).toBe('unknown')
    }
  })
})
