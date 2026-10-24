/**
 * contextSnapshot.ts
 *
 * Canonical typed snapshot model, non-destructive transformations,
 * and high-fidelity continuation brief generation for cross-session AI handoffs.
 */

export interface ContentBlockText {
  type: 'text'
  text: string
}

export interface ContentBlockCode {
  type: 'code'
  language?: string
  text: string
  contentHash: string
}

export interface ContentBlockLink {
  type: 'link'
  label: string
  destination?: string
}

export interface ContentBlockAttachment {
  type: 'attachment'
  name: string
  availability: 'reference-only' | 'included'
  path?: string
}

export interface ContentBlockToolResult {
  type: 'tool-result'
  text: string
  provenance?: string
}

export interface ContentBlockThought {
  type: 'thought'
  text: string
}

export type ContentBlock =
  | ContentBlockText
  | ContentBlockCode
  | ContentBlockLink
  | ContentBlockAttachment
  | ContentBlockToolResult
  | ContentBlockThought

export type TurnRole = 'user' | 'assistant' | 'tool' | 'system' | 'unknown'

export interface ConversationTurn {
  id: string
  sourceRole: TurnRole
  roleEvidence: string
  blocks: ContentBlock[]
  status: 'complete' | 'streaming' | 'unknown'
  timestamp?: string
}

export interface ArtifactReference {
  id: string
  label: string
  kind: 'source' | 'patch' | 'report' | 'attachment' | 'build-output' | 'unknown'
  sourceTurnId: string
  availability: 'reference-only' | 'included' | 'unavailable'
  pathOrLink?: string
  hash?: string
}

export interface CoverageReport {
  scope: 'mounted-transcript' | 'user-loaded-history' | 'imported-archive'
  completeness: 'unknown' | 'partial' | 'confirmed-for-source'
  streaming: 'yes' | 'no' | 'unknown'
  warnings: string[]
  omittedTurnCount?: number
}

export interface SnapshotSource {
  tabId: string
  providerKey: string
  origin: string
  title?: string
  contextRevision: string
  adapterId: string
  adapterVersion: number
}

export interface SnapshotStats {
  rawChars: number
  turnCount: number
  userTurns: number
  assistantTurns: number
  toolTurns: number
  systemTurns: number
  unknownTurns: number
  codeBlockCount: number
  artifactCount: number
}

export interface ConversationSnapshot {
  schemaVersion: 1
  snapshotId: string
  capturedAt: string
  source: SnapshotSource
  coverage: CoverageReport
  turns: ConversationTurn[]
  artifacts: ArtifactReference[]
  stats: SnapshotStats
}

export type TaskStatusCategory =
  | 'user_request'
  | 'user_confirmed'
  | 'assistant_proposal'
  | 'reported_implementation'
  | 'test_observed'
  | 'not_implemented'
  | 'blocked_or_superseded'

export interface TaskStatusLedgerItem {
  id: string
  category: TaskStatusCategory
  claim: string
  sourceTurnId?: string
  confidence: 'confirmed' | 'reported' | 'inferred'
  referenceNote?: string
}

export type ExportProjectionMode = 'brief' | 'transcript' | 'compact'

export interface ExportProjectionOptions {
  mode: ExportProjectionMode
  stripPleasantries?: boolean
  deduplicateExactCode?: boolean
  includeThinkingSummary?: boolean
  userObjectiveOverride?: string
  userNextActionOverride?: string
  maxTokenBudget?: number
  targetNextModel?: string
}

export interface ContinuationPacketResult {
  snapshot: ConversationSnapshot
  prompt: string
  rawText: string
  stats: {
    rawChars: number
    outputChars: number
    signedDeltaChars: number
    rawTokensEstimate: number
    outputTokensEstimate: number
    reductionPercent: number
    isExpanded: boolean
    turnCount: number
    userTurns: number
    assistantTurns: number
    unknownTurns: number
    codeBlockCount: number
    artifactCount: number
  }
  currentObjective: string
  nextActionCandidate: string
  ledger: TaskStatusLedgerItem[]
  artifacts: ArtifactReference[]
  omissions: string[]
  coverageWarnings: string[]
}

/**
 * Fast deterministic content hash (FNV-1a 32-bit hex) for code blocks and texts.
 */
export function computeContentHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Dynamically computes a markdown fence that cannot be prematurely closed by block content.
 * If content contains ```, returns ````, etc. Minimum 3 backticks.
 */
export function getSafeMarkdownFence(content: string): string {
  const matches = content.match(/`{3,}/g)
  if (!matches) return '```'
  let maxBackticks = 3
  for (const m of matches) {
    if (m.length >= maxBackticks) {
      maxBackticks = m.length + 1
    }
  }
  return '`'.repeat(maxBackticks)
}

/**
 * Token count estimation (~4 chars per token).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * Non-destructive UI noise cleaner.
 * Strips standalone UI button lines from scraped chat text WITHOUT
 * deleting numeric brackets [1] (which break array indexes) or timestamps.
 */
export function stripUiNoiseSafe(rawText: string): string {
  if (!rawText) return ''

  return rawText
    // Strip copy button text that gets concatenated on its own line
    .replace(/(?:^|\n)\s*(?:Copy code|Copy|Copied!?|Copy text|Code copied!?)\s*(?:\n|$)/gi, '\n')
    // Strip feedback / action button artifacts on their own line
    .replace(/(?:^|\n)\s*(?:Was this response better\?|Was this helpful\?|Thumbs up|Thumbs down|Good response|Bad response|Share|Retry|Regenerate response|Regenerate|Edit message|View other drafts|Show thinking|Hide thinking)\s*(?:\n|$)/gi, '\n')
    // Strip standalone pagination lines like "1 / 4", "2 of 3"
    .replace(/(?:^|\n)\s*\d+\s*(?:\/|of)\s*\d+\s*(?:\n|$)/g, '\n')
    // Strip empty blockquotes or trailing line clutter
    .replace(/^\s*>\s*$/gm, '')
    // Normalize newlines (max 2 consecutive)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Non-destructive pleasantry cleaner.
 * Only removes conversational pleasantries from assistant prose blocks;
 * never touches code blocks or configuration.
 */
export function stripConversationalFluffSafe(text: string): string {
  if (!text) return ''

  let cleaned = text

  const openingPatterns = [
    /^(?:Certainly|Sure thing|Sure|Of course|Absolutely|Gladly|I'd be (?:happy|glad) to help(?: you with that)?)[!.,]?\s*(?:Here(?:'s| is) (?:the|an|your) (?:code|updated code|solution|implementation|response|explanation)[^.\n]*[.:!\n]+)?\s*/i,
    /^(?:Hello!|Hi there!|Hi!|Hey!)\s*(?:Here(?:'s| is) (?:the|an|your)[^.\n]*[.:!\n]+)?\s*/i,
    /^(?:Below is (?:the|an|your) (?:code|updated|revised|complete|modified|working) (?:code|solution|implementation|version)[^.\n]*[.:!\n]+)\s*/i,
    /^(?:Based on your request|As requested|To solve this issue|In order to fix this)[,:]\s*/i
  ]

  for (const pat of openingPatterns) {
    cleaned = cleaned.replace(pat, '')
  }

  const closingPatterns = [
    /(?:\n\s*)?(?:I hope this helps!|Let me know if you (?:have any (?:other )?questions|need (?:further|more) (?:help|adjustments|changes)|run into any issues)|Feel free to ask(?: if you need anything else)?|Happy coding!|Cheers!)[^.\n]*[.!]?\s*$/i,
    /(?:\n\s*)?(?:This should (?:resolve|fix) the issue\. Let me know how it goes!)[^.\n]*[.!]?\s*$/i
  ]

  for (const pat of closingPatterns) {
    cleaned = cleaned.replace(pat, '')
  }

  return cleaned.trim()
}

/**
 * Deduplicates exact code blocks across turns based on exact content hash.
 * Never normalizes whitespace, preserving indentation and string literals.
 */
export function deduplicateExactCodeAcrossTurns(turns: ConversationTurn[]): {
  turns: ConversationTurn[]
  omissions: string[]
} {
  const omissions: string[] = []
  const lastSeenIndex = new Map<string, number>()

  // Locate identical blocks (exact hash and language match)
  turns.forEach((turn, turnIdx) => {
    for (const b of turn.blocks) {
      if (b.type === 'code' && b.text.length > 60) {
        lastSeenIndex.set(b.contentHash, turnIdx)
      }
    }
  })

  const newTurns = turns.map((turn, turnIdx) => {
    const updatedBlocks = turn.blocks.map((b) => {
      if (b.type !== 'code' || b.text.length <= 60) return b

      const finalTurn = lastSeenIndex.get(b.contentHash)
      if (finalTurn !== undefined && finalTurn > turnIdx) {
        omissions.push(
          `Identical code block (${b.language || 'code'}, hash ${b.contentHash.slice(0, 8)}) in Turn #${turnIdx + 1} omitted; identical to Turn #${finalTurn + 1}`
        )
        return {
          type: 'text' as const,
          text: `/* [Identical code block omitted — identical to Turn #${finalTurn + 1}] */`
        }
      }
      return b
    })

    return {
      ...turn,
      blocks: updatedBlocks
    }
  })

  return { turns: newTurns, omissions }
}

/**
 * Extracts referenced artifacts and attachments with their provenance.
 */
export function detectArtifactsFromTurns(turns: ConversationTurn[]): ArtifactReference[] {
  const artifacts: ArtifactReference[] = []
  const seenPaths = new Set<string>()

  // Common file pattern with extension (word boundary aware to handle trailing sentence punctuation)
  const fileRegex = /(?:^|[\s"'`(/])([a-zA-Z0-9_\-./]+?\.(?:ts|tsx|js|jsx|json|html|css|scss|md|txt|py|go|rs|cpp|c|h|yaml|yml|toml|sql|sh|env))\b/g

  turns.forEach((turn) => {
    for (const b of turn.blocks) {
      if (b.type === 'attachment') {
        const key = b.name.toLowerCase()
        if (!seenPaths.has(key)) {
          seenPaths.add(key)
          artifacts.push({
            id: `art-${computeContentHash(b.name)}`,
            label: b.name,
            kind: 'attachment',
            sourceTurnId: turn.id,
            availability: b.availability,
            pathOrLink: b.path
          })
        }
      } else if (b.type === 'text') {
        let match: RegExpExecArray | null
        while ((match = fileRegex.exec(b.text)) !== null) {
          const candidate = match[1].trim()
          if (!candidate.startsWith('http') && !candidate.startsWith('www.') && !candidate.includes('example.com') && candidate.length > 3) {
            const key = candidate.toLowerCase()
            if (!seenPaths.has(key)) {
              seenPaths.add(key)
              let kind: ArtifactReference['kind'] = 'source'
              if (candidate.endsWith('.patch') || candidate.includes('diff')) kind = 'patch'
              else if (candidate.endsWith('.md') || candidate.endsWith('.txt')) kind = 'report'

              artifacts.push({
                id: `art-${computeContentHash(candidate)}`,
                label: candidate,
                kind,
                sourceTurnId: turn.id,
                availability: 'reference-only',
                pathOrLink: candidate
              })
            }
          }
        }
      } else if (b.type === 'code') {
        // Inspect first line comment for file path (e.g. // src/main/index.ts)
        const firstLine = b.text.split('\n')[0].trim()
        const commentMatch = firstLine.match(/^(?:\/\/|#|\/\*)\s*([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/)
        if (commentMatch) {
          const path = commentMatch[1].trim()
          const key = path.toLowerCase()
          if (!seenPaths.has(key)) {
            seenPaths.add(key)
            artifacts.push({
              id: `art-${b.contentHash}`,
              label: path,
              kind: 'source',
              sourceTurnId: turn.id,
              availability: 'included',
              pathOrLink: path,
              hash: b.contentHash
            })
          }
        }
      }
    }
  })

  return artifacts.slice(0, 16)
}

/**
 * Builds a provenance-aware task status ledger distinguishing:
 * - user request
 * - user-confirmed outcome
 * - assistant proposal
 * - reported implementation
 * - test-observed result
 * - not implemented
 * - blocked / superseded
 */
export function buildProvenanceLedger(turns: ConversationTurn[]): TaskStatusLedgerItem[] {
  const items: TaskStatusLedgerItem[] = []
  const seenClaims = new Set<string>()

  turns.forEach((turn) => {
    for (const b of turn.blocks) {
      if (b.type !== 'text') continue
      const text = b.text

      if (turn.sourceRole === 'user') {
        // Look for user confirmations
        const confirmMatch = text.match(/(?:it works|that worked|verified|fixed now|looks good|confirmed|test passed)/i)
        if (confirmMatch) {
          const sentence = text.split('\n')[0].slice(0, 140).trim()
          if (!seenClaims.has(sentence)) {
            seenClaims.add(sentence)
            items.push({
              id: `ledger-${computeContentHash(sentence)}`,
              category: 'user_confirmed',
              claim: sentence,
              sourceTurnId: turn.id,
              confidence: 'confirmed'
            })
          }
        }

        // Look for user request / constraints
        const lines = text.split('\n').filter((l) => l.trim().length > 10)
        if (lines.length > 0) {
          const candidate = lines[0].replace(/^(?:please|can you|let's|we need to)\s+/i, '').trim().slice(0, 160)
          if (!seenClaims.has(candidate)) {
            seenClaims.add(candidate)
            items.push({
              id: `ledger-${computeContentHash(candidate)}`,
              category: 'user_request',
              claim: candidate,
              sourceTurnId: turn.id,
              confidence: 'confirmed'
            })
          }
        }
      } else if (turn.sourceRole === 'assistant') {
        // Check for reported implementation
        const reportMatch = text.match(/(?:(?:implemented|fixed|updated|patched|resolved|created)\s+([^.\n]+))/i)
        if (reportMatch) {
          const claim = reportMatch[0].trim().slice(0, 160)
          if (!seenClaims.has(claim)) {
            seenClaims.add(claim)
            items.push({
              id: `ledger-${computeContentHash(claim)}`,
              category: 'reported_implementation',
              claim,
              sourceTurnId: turn.id,
              confidence: 'reported',
              referenceNote: 'Reported in assistant dialogue'
            })
          }
        }

        // Check for proposals
        const proposalMatch = text.match(/(?:we should|i propose|i recommend|next step is to|suggest using)\s+([^.\n]+)/i)
        if (proposalMatch) {
          const claim = proposalMatch[0].trim().slice(0, 160)
          if (!seenClaims.has(claim)) {
            seenClaims.add(claim)
            items.push({
              id: `ledger-${computeContentHash(claim)}`,
              category: 'assistant_proposal',
              claim,
              sourceTurnId: turn.id,
              confidence: 'inferred'
            })
          }
        }
      }
    }
  })

  return items.slice(0, 10)
}

/**
 * Extracts the latest referenced code artifact from the conversation without claiming it is working.
 */
export function extractLatestReferencedCodeArtifact(turns: ConversationTurn[]): {
  lang: string
  code: string
  preview: string
  sourceTurnId: string
} | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (turn.sourceRole === 'assistant') {
      for (let j = turn.blocks.length - 1; j >= 0; j--) {
        const b = turn.blocks[j]
        if (b.type === 'code' && b.text.length > 30) {
          const firstLine = b.text.split('\n')[0].slice(0, 60)
          return {
            lang: b.language || 'code',
            code: b.text,
            preview: firstLine || `${b.language || 'code'} snippet`,
            sourceTurnId: turn.id
          }
        }
      }
    }
  }
  return null
}

/**
 * Extracts the complete latest user request.
 */
export function extractFullLatestUserRequest(turns: ConversationTurn[]): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].sourceRole === 'user') {
      const texts = turns[i].blocks.filter((b) => b.type === 'text').map((b) => (b as ContentBlockText).text)
      const full = texts.join('\n').trim()
      if (full) return full
    }
  }
  return ''
}

/**
 * Extracts a candidate next immediate action from the latest user request or assistant proposal.
 */
export function extractNextActionCandidate(turns: ConversationTurn[]): string {
  const latestUser = extractFullLatestUserRequest(turns)
  if (latestUser) {
    const firstParagraph = latestUser.split(/\n\s*\n/)[0].trim()
    return firstParagraph.length > 300 ? firstParagraph.slice(0, 300) + '...' : firstParagraph
  }
  return 'Continue working on the ongoing engineering task.'
}

/**
 * Primary Snapshot to Markdown projection engine.
 */
export function projectSnapshotToMarkdown(params: {
  snapshot: ConversationSnapshot
  options?: Partial<ExportProjectionOptions>
}): ContinuationPacketResult {
  const { snapshot, options = {} } = params
  const mode = options.mode || 'brief'
  const stripPleasantries = options.stripPleasantries ?? true
  const deduplicateExactCode = options.deduplicateExactCode ?? true
  const includeThinkingSummary = options.includeThinkingSummary ?? false

  let activeTurns = snapshot.turns

  // Apply pleasantry stripping to assistant text blocks only if enabled
  if (stripPleasantries) {
    activeTurns = activeTurns.map((turn) => {
      if (turn.sourceRole !== 'assistant') return turn
      const updatedBlocks = turn.blocks.map((b) => {
        if (b.type === 'text') {
          return { ...b, text: stripConversationalFluffSafe(b.text) }
        }
        return b
      })
      return { ...turn, blocks: updatedBlocks }
    })
  }

  // Exact code deduplication if enabled
  let omissions: string[] = []
  if (deduplicateExactCode) {
    const dedupRes = deduplicateExactCodeAcrossTurns(activeTurns)
    activeTurns = dedupRes.turns
    omissions = dedupRes.omissions
  }

  const artifacts = snapshot.artifacts && snapshot.artifacts.length > 0 ? snapshot.artifacts : detectArtifactsFromTurns(activeTurns)
  const ledger = buildProvenanceLedger(activeTurns)
  const fullLatestUser = extractFullLatestUserRequest(activeTurns)
  const currentObjective = options.userObjectiveOverride || fullLatestUser || 'Collaborative engineering and development task.'
  const nextActionCandidate = options.userNextActionOverride || extractNextActionCandidate(activeTurns)
  const latestCodeArtifact = extractLatestReferencedCodeArtifact(activeTurns)

  // Serializer function for turn blocks to markdown
  function renderTurnBlocks(turn: ConversationTurn, isCompact: boolean): string {
    const lines: string[] = []
    for (const b of turn.blocks) {
      if (b.type === 'text') {
        const t = isCompact ? b.text.replace(/\n{3,}/g, '\n\n').trim() : b.text.trim()
        if (t) lines.push(t)
      } else if (b.type === 'code') {
        const fence = getSafeMarkdownFence(b.text)
        lines.push(`${fence}${b.language || ''}\n${b.text}\n${fence}`)
      } else if (b.type === 'link') {
        lines.push(b.destination ? `[${b.label}](${b.destination})` : b.label)
      } else if (b.type === 'attachment') {
        lines.push(`📎 **Attachment:** \`${b.name}\` (${b.availability})`)
      } else if (b.type === 'tool-result') {
        const fence = getSafeMarkdownFence(b.text)
        lines.push(`🔧 **Tool Result**:\n${fence}\n${b.text}\n${fence}`)
      } else if (b.type === 'thought') {
        if (includeThinkingSummary && b.text.trim()) {
          lines.push(`> [!NOTE] User-Visible Reasoning Summary\n> ${b.text.replace(/\n/g, '\n> ')}`)
        }
      }
    }
    return lines.join('\n\n')
  }

  let finalPrompt = ''

  if (mode === 'transcript') {
    // 1. Faithful Captured Transcript
    const header = [
      `# Faithful Captured Transcript — ${snapshot.source.providerKey}`,
      `> **Captured at:** ${snapshot.capturedAt} | **Scope:** ${snapshot.coverage.scope} | **Turns:** ${snapshot.turns.length}`,
      snapshot.coverage.warnings.length > 0
        ? `> **Warnings:** ${snapshot.coverage.warnings.join('; ')}`
        : ''
    ].filter(Boolean).join('\n')

    const body = activeTurns
      .map((t, i) => {
        const roleLabel = t.sourceRole.toUpperCase()
        const content = renderTurnBlocks(t, false)
        return `### Turn ${i + 1} (${roleLabel})\n${content}`
      })
      .join('\n\n---\n\n')

    finalPrompt = `${header}\n\n${body}`
  } else if (mode === 'compact') {
    // 2. High-Density Evidence Pack (No stopword destruction!)
    const header = [
      `# High-Density Evidence Pack — ${snapshot.source.providerKey}`,
      `> **Session ID:** ${snapshot.snapshotId} | **Turns:** ${snapshot.turns.length}`,
      snapshot.coverage.warnings.length > 0
        ? `> **Notice:** ${snapshot.coverage.warnings.join('; ')}`
        : ''
    ].filter(Boolean).join('\n')

    const body = activeTurns
      .map((t, i) => {
        const roleLabel = t.sourceRole.toUpperCase()
        const content = renderTurnBlocks(t, true)
        return `[Turn ${i + 1} - ${roleLabel}]:\n${content}`
      })
      .join('\n\n')

    finalPrompt = `${header}\n\n${body}`
  } else {
    // 3. Continuation Brief (Default)
    const providerLabel = snapshot.source.providerKey

    const section1Objective = [
      `## 1. Current User Request & Objective`,
      currentObjective,
      fullLatestUser && fullLatestUser !== currentObjective
        ? `\n### Full Latest User Request:\n> ${fullLatestUser.replace(/\n/g, '\n> ')}`
        : ''
    ].filter(Boolean).join('\n')

    const section2Inputs = [
      `## 2. Inputs & Artifact Manifest`,
      artifacts.length > 0
        ? `| Artifact | Kind | Availability | Source Turn |\n| --- | --- | --- | --- |\n` +
          artifacts
            .map((a) => `| \`${a.label}\` | ${a.kind} | ${a.availability} | Turn #${a.sourceTurnId} |`)
            .join('\n')
        : `- (No specific external file artifacts detected in mounted transcript)`
    ].join('\n')

    const section3Ledger = [
      `## 3. Provenance & Task Status Ledger`,
      `The following items reflect observed conversation state. Do NOT treat assistant proposals or reported implementations as independently verified repository truth:`,
      ledger.length > 0
        ? ledger
            .map((item) => {
              const catLabel = item.category.replace(/_/g, ' ').toUpperCase()
              return `- **[${catLabel}]** ${item.claim} *(Confidence: ${item.confidence})*`
            })
            .join('\n')
        : `- Maintain existing codebase conventions and architectural decisions.`
    ].join('\n')

    const section4Next = [
      `## 4. Next Immediate Action for Incoming Agent`,
      `**Current immediate objective:**`,
      `> ${nextActionCandidate}`
    ].join('\n')

    const section5LatestCode = latestCodeArtifact
      ? [
          `## 5. Latest Referenced Code Artifact`,
          `*Most recent assistant code snippet produced prior to handoff (source: Turn #${latestCodeArtifact.sourceTurnId}):*`,
          `${getSafeMarkdownFence(latestCodeArtifact.code)}${latestCodeArtifact.lang}`,
          latestCodeArtifact.code,
          `${getSafeMarkdownFence(latestCodeArtifact.code)}\n`
        ].join('\n')
      : ''

    const section6Transcript = [
      `## 6. Dialogue Transcript Evidence`,
      `<historical_transcript provider="${providerLabel}" turns="${activeTurns.length}" capture_scope="${snapshot.coverage.scope}">`,
      activeTurns
        .map((t, i) => {
          const roleLabel = t.sourceRole.toUpperCase()
          const content = renderTurnBlocks(t, false)
          return `### Turn ${i + 1} (${roleLabel})\n${content}`
        })
        .join('\n\n---\n\n'),
      `</historical_transcript>`
    ].join('\n')

    const section7Directive = [
      `## 🤖 Directive for Incoming AI Agent:`,
      `1. **Evidence Distinction**: Treat historical transcript as evidence; verify current repository state before acting.`,
      `2. **Honest Coverage**: Note that this context reflects ${snapshot.coverage.scope} (${snapshot.turns.length} turns captured).`,
      `3. **Immediate Action**: Address Section 4 directly without re-asking questions already answered in the transcript.`
    ].join('\n')

    finalPrompt = [
      `# 🚀 AI AGENT CONTINUATION & SESSION HANDOFF CONTEXT`,
      `> **Handoff Notice**: Context captured from active session with **${providerLabel}** at ${snapshot.capturedAt}. Incoming agent is assigned to continue with full awareness of task provenance.\n`,
      section1Objective,
      `\n${section2Inputs}`,
      `\n${section3Ledger}`,
      `\n${section4Next}`,
      section5LatestCode ? `\n${section5LatestCode}` : '',
      `\n${section6Transcript}`,
      `\n${section7Directive}`
    ].filter(Boolean).join('\n')
  }

  const rawChars = snapshot.stats.rawChars || 1
  const outputChars = finalPrompt.length
  const signedDeltaChars = outputChars - rawChars
  const isExpanded = signedDeltaChars > 0
  const reductionPercent = rawChars > 0 ? Math.round(((rawChars - outputChars) / rawChars) * 100) : 0

  return {
    snapshot,
    prompt: finalPrompt,
    rawText: finalPrompt,
    stats: {
      rawChars,
      outputChars,
      signedDeltaChars,
      rawTokensEstimate: estimateTokens('x'.repeat(rawChars)),
      outputTokensEstimate: estimateTokens(finalPrompt),
      reductionPercent,
      isExpanded,
      turnCount: activeTurns.length,
      userTurns: activeTurns.filter((t) => t.sourceRole === 'user').length,
      assistantTurns: activeTurns.filter((t) => t.sourceRole === 'assistant').length,
      unknownTurns: activeTurns.filter((t) => t.sourceRole === 'unknown').length,
      codeBlockCount: activeTurns.reduce(
        (acc, t) => acc + t.blocks.filter((b) => b.type === 'code').length,
        0
      ),
      artifactCount: artifacts.length
    },
    currentObjective,
    nextActionCandidate,
    ledger,
    artifacts,
    omissions,
    coverageWarnings: snapshot.coverage.warnings
  }
}
