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

  it('R01 & R02: Nested pre or code wrapper emits exactly one code block and preserves in-place order', () => {
    const html = `
      <main>
        <div data-agent-transcript-message="true" data-chat-message-id="arena-order-1">
          <div data-user-message-layout="true">
            <p>Step 1: Inspect environment</p>
            <pre class="outer-wrapper"><pre class="language-bash"><code>uname -a</code></pre></pre>
            <p>Step 2: Run test</p>
            <pre class="code-container"><code>npm test</code></pre>
            <p>Step 3: Review table results</p>
            <table>
              <tr><th>Test</th><th>Status</th></tr>
              <tr><td>R01</td><td>PASS</td></tr>
            </table>
            <p>Step 4: Attach <button class="file-chip">results.txt</button> and report.</p>
          </div>
        </div>
      </main>
    `
    const payload = runExtractorInDOM(html, 'https://arena.ai/agent/task-order')
    expect(payload.success).toBe(true)
    expect(payload.turns.length).toBe(1)
    const blocks = payload.turns[0].blocks

    // Assert exact in-place sequence:
    // Text (Step 1) -> Code (uname -a) -> Text (Step 2) -> Code (npm test) -> Text (Step 3 + table) -> Attachment (results.txt) -> Text (Step 4)
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].text).toContain('Step 1: Inspect environment')

    expect(blocks[1].type).toBe('code')
    expect(blocks[1].text).toBe('uname -a')
    expect(blocks[1].language).toBe('bash')

    expect(blocks[2].type).toBe('text')
    expect(blocks[2].text).toContain('Step 2: Run test')

    expect(blocks[3].type).toBe('code')
    expect(blocks[3].text).toBe('npm test')

    // Table must be serialized as a Markdown table
    const tableBlock = blocks.find((b) => b.type === 'text' && b.text?.includes('| Test | Status |'))
    expect(tableBlock).toBeDefined()
    expect(tableBlock?.text).toContain('| R01 | PASS |')

    // Filename chip inside button must not vanish
    const chipText = blocks.find((b) => b.type === 'text' && b.text?.includes('`results.txt`'))
    expect(chipText).toBeDefined()
    expect(chipText?.text).toContain('Attach  `results.txt` and report.')

    // Attachment must be extracted as attachment block
    const attachBlock = blocks.find((b) => b.type === 'attachment')
    expect(attachBlock).toBeDefined()
    expect(attachBlock?.name).toBe('results.txt')

    // Code block count: exactly 2 (no duplicate pairs!)
    const codeBlocks = blocks.filter((b) => b.type === 'code')
    expect(codeBlocks.length).toBe(2)
  })

  it('R01 Fixture 2: Two distinct source pre elements with identical code preserve intentional repetitions in order', () => {
    const html = `
      <main>
        <div data-agent-transcript-message="true" data-chat-message-id="arena-repeat-1">
          <p>First invocation:</p>
          <pre><code class="language-typescript">console.log("identical block");</code></pre>
          <p>Second invocation:</p>
          <pre><code class="language-typescript">console.log("identical block");</code></pre>
          <p>Done.</p>
        </div>
      </main>
    `
    const payload = runExtractorInDOM(html, 'https://arena.ai/agent/task-repeat')
    expect(payload.success).toBe(true)
    const blocks = payload.turns[0].blocks

    // Distinct separated source blocks must both be preserved
    const codeBlocks = blocks.filter((b) => b.type === 'code')
    expect(codeBlocks.length).toBe(2)
    expect(codeBlocks[0].text).toBe('console.log("identical block");')
    expect(codeBlocks[1].text).toBe('console.log("identical block");')

    // Ordering: text -> code -> text -> code -> text
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].text).toContain('First invocation:')
    expect(blocks[1].type).toBe('code')
    expect(blocks[2].type).toBe('text')
    expect(blocks[2].text).toContain('Second invocation:')
    expect(blocks[3].type).toBe('code')
    expect(blocks[4].type).toBe('text')
    expect(blocks[4].text).toContain('Done.')
  })

  it('R01 Fixture 3: Highlight spans inside code do not cause duplicate text', () => {
    const html = `
      <main>
        <div data-agent-transcript-message="true" data-chat-message-id="arena-hl-1">
          <pre><code class="language-javascript"><span class="token keyword">const</span> <span class="token variable">answer</span> = <span class="token number">42</span>;</code></pre>
        </div>
      </main>
    `
    const payload = runExtractorInDOM(html, 'https://arena.ai/agent/task-hl')
    expect(payload.success).toBe(true)
    const codeBlock = payload.turns[0].blocks.find((b) => b.type === 'code')
    expect(codeBlock).toBeDefined()
    expect(codeBlock?.text).toBe('const answer = 42;')
    expect(codeBlock?.language).toBe('javascript')
  })
})
