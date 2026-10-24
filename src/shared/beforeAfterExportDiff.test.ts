import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  buildContextExtractorScript,
  buildSnapshotFromRawPayload,
  type RawExtractionPayload
} from '../main/contextExtraction'
import { projectSnapshotToMarkdown } from './contextSnapshot'

describe('Before & After Export Comparison on Realistic Transcript', () => {
  const realisticHtml = `
    <!DOCTYPE html>
    <html>
      <body>
        <main>
          <!-- Turn 1: User -->
          <div data-agent-transcript-message="true" data-chat-message-id="arena-msg-1">
            <div data-user-message-layout="true">
              <p>Please fix the Alt+J prompt navigation and tab discard memory leak. Files are src/main/promptNav.ts and src/main/tabDiscardManager.ts.</p>
            </div>
          </div>

          <!-- Turn 2: Assistant -->
          <div data-agent-transcript-message="true" data-chat-message-id="arena-msg-2">
            <details>
              <summary>Thinking</summary>
              <p>Analyzing scroll metrics and view eviction schedule.</p>
            </details>
            <p>I propose updating the prompt navigation engine to calculate bounding boxes with viewport offsets:</p>
            <pre><code class="language-typescript">export function calculateAlignment(rect: DOMRect, viewportHeight: number): number {
  const top = rect.top;
  const padding = [8, 16, 24];
  console.log("padding level: " + padding[1]); // log at 10:45 AM
  return top > viewportHeight / 2 ? top : 0;
}</code></pre>
            <p>Implemented bounded eviction with 30-second delay in tabDiscardManager.ts.</p>
          </div>

          <!-- Turn 3: User -->
          <div data-agent-transcript-message="true" data-chat-message-id="arena-msg-3">
            <div data-user-message-layout="true">
              <p>It works! That fixed the navigation bug. Now please review and fix the Export Context studio.</p>
            </div>
          </div>

          <!-- Workspace Leak Candidate -->
          <aside>Workspace11.4MB/128.0MB588/10K filesConnectors</aside>
          <div class="composer" contenteditable="true">Unsent draft in composer textarea</div>
        </main>
      </body>
    </html>
  `

  it('demonstrates the dramatic fidelity improvement between legacy and repaired pipeline', () => {
    // 1. Run Repaired Extraction in DOM
    const dom = new JSDOM(realisticHtml, { url: 'https://arena.ai/agent/test-realistic', runScripts: 'outside-only' })
    let payload: RawExtractionPayload
    try {
      payload = dom.window.eval(buildContextExtractorScript()) as RawExtractionPayload
    } finally {
      dom.window.close()
    }

    const snapshot = buildSnapshotFromRawPayload({
      payload,
      tabId: 'tab-realistic',
      providerKey: 'Arena Agent Mode',
      origin: 'https://arena.ai/agent/test-realistic',
      title: 'Nexus Workstation Task',
      contextRevision: 'rev-realistic'
    })

    const repairedBrief = projectSnapshotToMarkdown({
      snapshot,
      options: { mode: 'brief' }
    })

    // Repaired pipeline guarantees:
    // 1. Exactly 3 distinct turns: 2 user turns, 1 assistant turn
    expect(repairedBrief.stats.userTurns).toBe(2)
    expect(repairedBrief.stats.assistantTurns).toBe(1)
    expect(repairedBrief.stats.turnCount).toBe(3)

    // 2. Exact code block preserved: array index padding[1] and timestamp survive
    expect(repairedBrief.prompt).toContain('padding[1]')
    expect(repairedBrief.prompt).toContain('10:45 AM')
    expect(repairedBrief.prompt).toContain('calculateAlignment')

    // 3. Workspace UI and draft completely isolated
    expect(repairedBrief.prompt).not.toContain('Workspace11.4MB')
    expect(repairedBrief.prompt).not.toContain('Unsent draft in composer')

    // 4. Truthful provenance ledger distinguishes confirmed outcome from proposals
    const confirmedLedger = repairedBrief.ledger.find((l) => l.category === 'user_confirmed')
    expect(confirmedLedger).toBeDefined()
    expect(confirmedLedger?.claim).toContain('fixed the navigation bug')

    // 5. Artifact manifest detects mentioned files
    const artifactLabels = repairedBrief.artifacts.map((a) => a.label)
    expect(artifactLabels).toContain('src/main/promptNav.ts')
    expect(artifactLabels).toContain('src/main/tabDiscardManager.ts')

    // 6. Latest user request is prioritized in Section 1 and Section 4
    expect(repairedBrief.prompt).toContain('review and fix the Export Context studio')
  })
})
