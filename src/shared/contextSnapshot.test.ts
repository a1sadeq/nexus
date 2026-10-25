import { describe, it, expect } from 'vitest'
import {
  type ConversationSnapshot,
  computeContentHash,
  getSafeMarkdownFence,
  stripUiNoiseSafe,
  stripConversationalFluffSafe,
  deduplicateExactCodeAcrossTurns,
  detectArtifactsFromTurns,
  buildProvenanceLedger,
  projectSnapshotToMarkdown
} from './contextSnapshot'

describe('contextSnapshot - Core primitives', () => {
  it('computes deterministic content hashes', () => {
    const hash1 = computeContentHash('hello world')
    const hash2 = computeContentHash('hello world')
    const hash3 = computeContentHash('hello world!')
    expect(hash1).toBe(hash2)
    expect(hash1).not.toBe(hash3)
  })

  it('selects safe markdown fences that avoid collision with backticks in code', () => {
    expect(getSafeMarkdownFence('const a = 1;')).toBe('```')
    expect(getSafeMarkdownFence('```md\n# Title\n```')).toBe('````')
    expect(getSafeMarkdownFence('````nested\n```md\n```\n````')).toBe('`````')
  })

  it('safely cleans UI button lines without deleting array indexes or timestamps', () => {
    const input = 'const x = arr[1];\nCopy code\n10:45 AM log entry\nThumbs up'
    const result = stripUiNoiseSafe(input)
    expect(result).not.toContain('Copy code')
    expect(result).not.toContain('Thumbs up')
    expect(result).toContain('const x = arr[1];')
    expect(result).toContain('10:45 AM log entry')
  })

  it('only strips conversational fluff from prose, never modifying code', () => {
    const input = "Certainly! I'd be happy to help with that. Here is the code:\nfunction compute() { return true; }\nI hope this helps!"
    const result = stripConversationalFluffSafe(input)
    expect(result).not.toContain('Certainly!')
    expect(result).not.toContain('I hope this helps!')
    expect(result).toContain('function compute() { return true; }')
  })
})

describe('contextSnapshot - Deduplication & Artifacts', () => {
  it('deduplicates identical code blocks while leaving different code intact', () => {
    const codeA = 'console.log("hello world");\n'.repeat(5)
    const codeB = 'console.log("hello world!");\n'.repeat(5)

    const turns = [
      {
        id: 't1',
        sourceRole: 'assistant' as const,
        roleEvidence: 'model',
        status: 'complete' as const,
        blocks: [{ type: 'code' as const, language: 'js', text: codeA, contentHash: computeContentHash(codeA) }]
      },
      {
        id: 't2',
        sourceRole: 'user' as const,
        roleEvidence: 'user',
        status: 'complete' as const,
        blocks: [{ type: 'text' as const, text: 'Can you show both versions?' }]
      },
      {
        id: 't3',
        sourceRole: 'assistant' as const,
        roleEvidence: 'model',
        status: 'complete' as const,
        blocks: [
          { type: 'code' as const, language: 'js', text: codeA, contentHash: computeContentHash(codeA) },
          { type: 'code' as const, language: 'js', text: codeB, contentHash: computeContentHash(codeB) }
        ]
      }
    ]

    const { turns: updatedTurns, omissions } = deduplicateExactCodeAcrossTurns(turns)
    expect(omissions.length).toBe(1)
    expect(updatedTurns[0].blocks[0].type).toBe('text')
    expect((updatedTurns[0].blocks[0] as any).text).toContain('Identical code block omitted — identical to Turn #3')
    expect(updatedTurns[2].blocks[0].type).toBe('code')
    expect(updatedTurns[2].blocks[1].type).toBe('code')
  })

  it('detects artifacts, attachments, and referenced files', () => {
    const turns = [
      {
        id: 't1',
        sourceRole: 'user' as const,
        roleEvidence: 'user',
        status: 'complete' as const,
        blocks: [
          { type: 'text' as const, text: 'Please review src/main/index.ts and bug-report.txt' },
          { type: 'attachment' as const, name: 'patch.diff', availability: 'included' as const }
        ]
      }
    ]

    const artifacts = detectArtifactsFromTurns(turns)
    const labels = artifacts.map((a) => a.label)
    expect(labels).toContain('patch.diff')
    expect(labels).toContain('src/main/index.ts')
    expect(labels).toContain('bug-report.txt')
  })

  it('R04: splits concatenated filenames and strips attached action verbs without corrupting README', () => {
    const turns = [
      {
        id: 't-artifacts',
        sourceRole: 'user' as const,
        roleEvidence: 'user',
        status: 'complete' as const,
        blocks: [
          {
            type: 'text' as const,
            text: 'I ran Readaaaaaaaa.txt and inspected README.md and attached nexus_electron_part1_of_1_codebase.txtnexus-agent-handoff-arena-ai-2026-10-24.md for review.'
          }
        ]
      }
    ]

    const artifacts = detectArtifactsFromTurns(turns)
    const labels = artifacts.map((a) => a.label)

    // Attached action verb 'Read' stripped from aaaaaaaa.txt
    expect(labels).toContain('aaaaaaaa.txt')
    expect(labels).not.toContain('Readaaaaaaaa.txt')

    // Standard README.md must NOT be stripped to ME.md
    expect(labels).toContain('README.md')

    // Concatenated filenames must be split into two distinct artifacts
    expect(labels).toContain('nexus_electron_part1_of_1_codebase.txt')
    expect(labels).toContain('nexus-agent-handoff-arena-ai-2026-10-24.md')
    expect(labels).not.toContain('nexus_electron_part1_of_1_codebase.txtnexus-agent-handoff-arena-ai-2026-10-24.md')
  })
})

describe('contextSnapshot - Provenance Ledger & Projections', () => {
  const sampleSnapshot: ConversationSnapshot = {
    schemaVersion: 1,
    snapshotId: 'snap-123456',
    capturedAt: '2026-10-25T01:00:00Z',
    source: {
      tabId: 'tab-1',
      providerKey: 'Arena Agent Mode',
      origin: 'https://arena.ai',
      title: 'Prompt Navigation Fix',
      contextRevision: 'rev-1',
      adapterId: 'arena-agent-mode',
      adapterVersion: 1
    },
    coverage: {
      scope: 'mounted-transcript',
      completeness: 'confirmed-for-source',
      streaming: 'no',
      warnings: []
    },
    turns: [
      {
        id: 't1',
        sourceRole: 'user',
        roleEvidence: 'data-user-message-layout',
        status: 'complete',
        blocks: [
          { type: 'text', text: 'Please repair the Alt+J prompt navigation.' }
        ]
      },
      {
        id: 't2',
        sourceRole: 'assistant',
        roleEvidence: 'data-agent-transcript-message',
        status: 'complete',
        blocks: [
          { type: 'text', text: 'We should use getBoundingClientRect for element coordinates.' },
          { type: 'code', language: 'ts', text: 'export function scroll(el: HTMLElement) { el.scrollIntoView(); }', contentHash: 'hash-code-1' }
        ]
      },
      {
        id: 't3',
        sourceRole: 'user',
        roleEvidence: 'data-user-message-layout',
        status: 'complete',
        blocks: [
          { type: 'text', text: 'It works! That fixed now.' },
          { type: 'text', text: 'Now please fix the export context modal.' }
        ]
      }
    ],
    artifacts: [],
    stats: {
      rawChars: 500,
      turnCount: 3,
      userTurns: 2,
      assistantTurns: 1,
      toolTurns: 0,
      systemTurns: 0,
      unknownTurns: 0,
      codeBlockCount: 1,
      artifactCount: 0
    }
  }

  it('builds a provenance ledger distinguishing proposals from confirmed outcomes', () => {
    const ledger = buildProvenanceLedger(sampleSnapshot.turns)
    const confirmed = ledger.find((item) => item.category === 'user_confirmed')
    const proposal = ledger.find((item) => item.category === 'assistant_proposal')
    const userReq = ledger.find((item) => item.category === 'user_request')

    expect(confirmed).toBeDefined()
    expect(confirmed?.confidence).toBe('confirmed')
    expect(proposal).toBeDefined()
    expect(proposal?.confidence).toBe('inferred')
    expect(userReq).toBeDefined()
  })

  it('projects continuation brief faithfully with honest status and latest user request', () => {
    const result = projectSnapshotToMarkdown({
      snapshot: sampleSnapshot,
      options: { mode: 'brief' }
    })

    expect(result.prompt).toContain('# 🚀 AI AGENT CONTINUATION & SESSION HANDOFF CONTEXT')
    expect(result.prompt).toContain('## 1. Current User Request & Objective')
    expect(result.prompt).toContain('fix the export context modal')
    expect(result.prompt).toContain('## 3. Provenance & Task Status Ledger')
    expect(result.prompt).toContain('## 5. Latest Referenced Code Artifact')
    expect(result.prompt).toContain('## 6. Dialogue Transcript Evidence')
    expect(result.stats.userTurns).toBe(2)
    expect(result.stats.assistantTurns).toBe(1)
  })

  it('projects faithful raw transcript without any omission or template wrappers', () => {
    const result = projectSnapshotToMarkdown({
      snapshot: sampleSnapshot,
      options: { mode: 'transcript' }
    })

    expect(result.prompt).toContain('# Faithful Captured Transcript — Arena Agent Mode')
    expect(result.prompt).toContain('### Turn 1 (USER)')
    expect(result.prompt).toContain('### Turn 2 (ASSISTANT)')
    expect(result.prompt).toContain('### Turn 3 (USER)')
    expect(result.prompt).toContain('scrollIntoView()')
  })

  it('R06: "it worked ." is categorized as user_confirmed, NOT user_request', () => {
    const turns = [
      {
        id: 'turn-confirm',
        sourceRole: 'user' as const,
        roleEvidence: 'user',
        status: 'complete' as const,
        blocks: [{ type: 'text' as const, text: 'it worked .' }]
      }
    ]
    const ledger = buildProvenanceLedger(turns)
    const confirmed = ledger.find((l) => l.category === 'user_confirmed')
    const userReq = ledger.find((l) => l.category === 'user_request')

    expect(confirmed).toBeDefined()
    expect(confirmed?.claim).toContain('it worked')
    expect(userReq).toBeUndefined()
  })

  it('R05: meta follow-up "what to tell the ai ?" generates contextual meaning while preserving literal request', () => {
    const metaSnapshot: ConversationSnapshot = {
      ...sampleSnapshot,
      turns: [
        {
          id: 'turn-user-initial',
          sourceRole: 'user',
          roleEvidence: 'user',
          status: 'complete',
          blocks: [
            { type: 'text', text: 'Please implement the prompt navigation and tab discard repairs.' }
          ]
        },
        {
          id: 'turn-asst-instructions',
          sourceRole: 'assistant',
          roleEvidence: 'assistant',
          status: 'complete',
          blocks: [
            { type: 'text', text: 'Here are the instructions to give the incoming AI.' },
            { type: 'code', language: 'markdown', text: 'Implement the Nexus Export Context improvements.\nOBJECTIVE: Make Export Context produce faithful output.', contentHash: 'hash-inst-1' }
          ]
        },
        {
          id: 'turn-user-meta',
          sourceRole: 'user',
          roleEvidence: 'user',
          status: 'complete',
          blocks: [
            { type: 'text', text: 'what to tell the ai ?' }
          ]
        }
      ]
    }

    const result = projectSnapshotToMarkdown({
      snapshot: metaSnapshot,
      options: { mode: 'brief' }
    })

    // Preserves literal user request
    expect(result.prompt).toContain('what to tell the ai ?')

    // Derives contextual meaning and status
    expect(result.prompt).toContain('Contextual Meaning (inferred; review before use)')
    expect(result.prompt).toContain('Implementation Status at Capture')

    // Coverage notice is explicit
    expect(result.prompt).toContain('Coverage Notice')
    expect(result.prompt).toContain('mounted turns')
    expect(result.prompt).toContain('Full history completeness is unverified')
  })
})
