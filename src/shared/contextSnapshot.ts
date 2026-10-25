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
          text: `/* [Identical code block omitted — identical to Turn #${finalTurn + 1} (${b.language || 'code'}, hash ${b.contentHash.slice(0, 8)})] */`
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
 * Splits concatenated filenames or attached verbs safely without corrupting README.
 */
function cleanFileCandidate(cand: string): string[] {
  let base = cand
  if (!base.toUpperCase().startsWith('README')) {
    const verbMatch = base.match(/^(?:Read|Open|Attach|View|Load|In|The)([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)$/i)
    if (verbMatch) base = verbMatch[1]
  }
  const extRegex = /(?<=\.(?:ts|tsx|js|jsx|json|html|css|scss|md|txt|py|go|rs|cpp|c|h|yaml|yml|toml|sql|sh|env))(?=[a-zA-Z0-9_\-])/g
  return base.split(extRegex)
}

/**
 * Separates attached filenames and chip markers from user prompt prose.
 */
export function separateAttachmentsFromUserPrompt(rawText: string): {
  promptText: string
  detectedAttachments: string[]
} {
  if (!rawText) return { promptText: '', detectedAttachments: [] }

  const lines = rawText.split('\n')
  const detectedAttachments: string[] = []
  const promptLines: string[] = []

  const filenameLineRegex = /^[a-zA-Z0-9_\-./]+?\.(?:md|txt|ts|tsx|js|jsx|json|py|csv|zip|tar|gz|pdf|html|css|png|jpg)(?:\.txt)?(?:\s*\(.*?\))?$/i
  const attachLineRegex = /^(?:\[(?:Attached|Attachment):?\s*|📎\s*|Attached\s+file:\s*)([a-zA-Z0-9_\-./]+?\.[a-zA-Z0-9]+)(?:\])?/i

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      promptLines.push(line)
      continue
    }

    const attachMatch = trimmed.match(attachLineRegex)
    if (attachMatch) {
      detectedAttachments.push(attachMatch[1])
      continue
    }

    if (filenameLineRegex.test(trimmed)) {
      detectedAttachments.push(trimmed)
      continue
    }

    promptLines.push(line)
  }

  const promptText = promptLines.join('\n').trim()
  return { promptText, detectedAttachments }
}

/**
 * Extracts referenced artifacts and attachments with their provenance.
 * Prioritizes explicit attachments and recent deliverables, de-duplicates aliases,
 * classifies codebase bundles as source, and maps turn IDs to visible turn numbers.
 */
export function detectArtifactsFromTurns(turns: ConversationTurn[]): ArtifactReference[] {
  const artifacts: ArtifactReference[] = []
  const seenPaths = new Set<string>()
  const seenBasenames = new Set<string>()

  function addArtifact(
    rawPath: string,
    sourceTurn: ConversationTurn,
    explicitKind?: ArtifactReference['kind'],
    availability: ArtifactReference['availability'] = 'reference-only',
    hash?: string
  ) {
    const trimmed = rawPath.trim()
    if (!trimmed || trimmed.length <= 3) return
    if (trimmed.startsWith('http') || trimmed.startsWith('www.') || trimmed.includes('example.com')) return

    const key = trimmed.toLowerCase()
    const basename = (trimmed.split('/').pop() || trimmed).toLowerCase()

    if (seenPaths.has(key)) return
    if (!trimmed.includes('/') && seenBasenames.has(basename)) return

    seenPaths.add(key)
    seenBasenames.add(basename)

    let kind: ArtifactReference['kind'] = explicitKind || 'unknown'
    if (!explicitKind || explicitKind === 'unknown') {
      const lower = trimmed.toLowerCase()
      if (lower.includes('codebase') || lower.includes('part1_of_1') || lower.endsWith('.bundle')) {
        kind = 'source'
      } else if (lower.endsWith('.patch') || lower.includes('diff')) {
        kind = 'patch'
      } else if (
        lower.includes('review') ||
        lower.includes('validation') ||
        lower.includes('audit') ||
        lower.includes('handoff') ||
        lower.includes('plan') ||
        lower.includes('guide') ||
        lower.includes('spec')
      ) {
        kind = 'report'
      } else if (/\.(?:ts|tsx|js|jsx|py|go|rs|cpp|c|h|sql|css|html|json)$/i.test(trimmed)) {
        kind = 'source'
      } else if (trimmed.endsWith('.md')) {
        kind = 'report'
      } else if (trimmed.endsWith('.txt')) {
        kind = 'unknown'
      }
    }

    const turnIndex = turns.findIndex((t) => t.id === sourceTurn.id)
    const turnNumberLabel = turnIndex >= 0 ? `${turnIndex + 1} (${sourceTurn.id})` : sourceTurn.id

    artifacts.push({
      id: `art-${computeContentHash(trimmed)}`,
      label: trimmed,
      kind,
      sourceTurnId: turnNumberLabel,
      availability,
      pathOrLink: trimmed,
      hash
    })
  }

  // 1. Explicit attachments, tool results, and links in REVERSE order (newest turns first)
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    for (const b of turn.blocks) {
      if (b.type === 'attachment') {
        const splitNames = cleanFileCandidate(b.name)
        for (const name of splitNames) {
          addArtifact(name, turn, undefined, b.availability || 'reference-only')
        }
      } else if (b.type === 'link') {
        if (b.destination && /\.(?:md|txt|ts|tsx|js|jsx|json|patch|diff|zip)\b/i.test(b.destination)) {
          addArtifact(b.destination, turn, undefined, 'reference-only')
        }
        if (b.label && /\.(?:md|txt|ts|tsx|js|jsx|json|patch|diff|zip)\b/i.test(b.label)) {
          addArtifact(b.label, turn, undefined, 'reference-only')
        }
      }
    }
  }

  // 2. Code block file comments in REVERSE order
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    for (const b of turn.blocks) {
      if (b.type === 'code') {
        const firstLine = b.text.split('\n')[0].trim()
        const commentMatch = firstLine.match(/^(?:\/\/|#|\/\*)\s*([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/)
        if (commentMatch) {
          const path = commentMatch[1].trim()
          addArtifact(path, turn, 'source', 'included', b.contentHash)
        }
      }
    }
  }

  // 3. File paths mentioned in text in REVERSE order
  const fileRegex = /(?:^|[\s"'`(/])([a-zA-Z0-9_\-./]+?\.(?:ts|tsx|js|jsx|json|html|css|scss|md|txt|py|go|rs|cpp|c|h|yaml|yml|toml|sql|sh|env))\b/g
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    for (const b of turn.blocks) {
      if (b.type === 'text') {
        let match: RegExpExecArray | null
        while ((match = fileRegex.exec(b.text)) !== null) {
          const rawCand = match[1].trim()
          const splitCands = cleanFileCandidate(rawCand)
          for (const cand of splitCands) {
            addArtifact(cand, turn, undefined, 'reference-only')
          }
        }
      }
    }
  }

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

  turns.forEach((turn, turnIdx) => {
    const visibleTurnLabel = `Turn #${turnIdx + 1} (${turn.id})`

    for (const b of turn.blocks) {
      if (b.type !== 'text') continue
      const text = b.text

      if (turn.sourceRole === 'user') {
        // Look for user confirmations first
        const confirmMatch = text.match(
          /(?:it worked|it works|that worked|that works|verified|fixed now|looks good|confirmed|test passed|all tests pass)/i
        )
        if (confirmMatch) {
          const sentence = text.split('\n')[0].slice(0, 140).trim()
          if (!seenClaims.has(sentence)) {
            seenClaims.add(sentence)
            items.push({
              id: `ledger-${computeContentHash(sentence)}`,
              category: 'user_confirmed',
              claim: sentence,
              sourceTurnId: visibleTurnLabel,
              confidence: 'confirmed'
            })
          }
          continue
        }

        // Look for user request / constraints
        const { promptText } = separateAttachmentsFromUserPrompt(text)
        const lines = promptText.split('\n').filter((l) => l.trim().length > 10)
        if (lines.length > 0) {
          const candidate = lines[0].replace(/^(?:please|can you|let's|we need to)\s+/i, '').trim().slice(0, 160)
          if (candidate && !seenClaims.has(candidate)) {
            seenClaims.add(candidate)
            items.push({
              id: `ledger-${computeContentHash(candidate)}`,
              category: 'user_request',
              claim: candidate,
              sourceTurnId: visibleTurnLabel,
              confidence: 'confirmed'
            })
          }
        }
      } else if (turn.sourceRole === 'assistant') {
        const sentences = text
          .split(/(?<=[.!?\n])\s+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 5)

        for (const sentence of sentences) {
          // 1. Quotation, attribution, meta-critique filter
          if (
            /(?:ledger entry says|review(?:'s)? criticism|says [a-z]+|criticism of|claims? that|example of bad|poor ledger entry|instead of claiming)/i.test(
              sentence
            ) ||
            /["'][^"']*(?:implemented|fixed|updated|patched|resolved|created)[^"']*["']/i.test(sentence)
          ) {
            continue
          }

          // 2. Prohibition / Warning filter
          if (
            /(?:^|[.!?]\s*)(?:do not|don't|never|cannot|can't|should not|shouldn't|must not|avoid|stop)\s+/i.test(
              sentence
            )
          ) {
            continue
          }

          // 3. Adjective / non-verb "fixed" check
          const hasAdjectiveFixed = /\bfixed\s+(?:triple-backtick|fence|width|size|height|delay|interval|timeout|delimiter|string|buffer|position|value|length|window|rate)\b/i.test(
            sentence
          )

          // 4. Check for explicitly NOT implemented
          if (
            /(?:no|not)\s+(?:[a-z0-9_-]+\s+)*(?:repair|fix|change|implementation|modification)\s+was\s+applied|not\s+implemented|unimplemented|has\s+not\s+been\s+implemented/i.test(
              sentence
            )
          ) {
            const claim = sentence.slice(0, 160)
            if (!seenClaims.has(claim)) {
              seenClaims.add(claim)
              items.push({
                id: `ledger-${computeContentHash(claim)}`,
                category: 'not_implemented',
                claim,
                sourceTurnId: visibleTurnLabel,
                confidence: 'reported',
                referenceNote: 'Explicitly reported as not implemented'
              })
            }
            continue
          }

          // 5. Test observed / test claims
          const hasTestsPassed = /(?:tests?\s+(?:[a-z0-9_,-]+\s+)?passed|passed\s+\d+\s+tests?|test\s+suite\s+passed|all\s+tests\s+pass)/i.test(
            sentence
          )

          // 6. Active implementation verbs
          const hasActiveImplementation =
            /(?:^|\b)(?:i\s+(?:have\s+)?(?:implemented|fixed|updated|patched|resolved|created)|(?:implemented|fixed|updated|patched|resolved|created)\s+(?:the|a|support|handling|logic|engine|system|behavior|bug|issue|crash|race))/i.test(
              sentence
            ) && !hasAdjectiveFixed

          if (hasActiveImplementation) {
            const claim = sentence.slice(0, 160)
            if (!seenClaims.has(claim)) {
              seenClaims.add(claim)
              items.push({
                id: `ledger-${computeContentHash(claim)}`,
                category: 'reported_implementation',
                claim,
                sourceTurnId: visibleTurnLabel,
                confidence: 'reported',
                referenceNote: 'Reported in assistant dialogue (claim; unverified)'
              })
            }
          }

          if (hasTestsPassed) {
            const claim = sentence.slice(0, 160)
            const testKey = `test-${claim}`
            if (!seenClaims.has(testKey)) {
              seenClaims.add(testKey)
              items.push({
                id: `ledger-${computeContentHash(testKey)}`,
                category: 'test_observed',
                claim,
                sourceTurnId: visibleTurnLabel,
                confidence: 'reported',
                referenceNote: 'Reported test result in dialogue (claim; unverified)'
              })
            }
          }

          // 7. Proposals
          const proposalMatch = sentence.match(/(?:we should|i propose|i recommend|next step is to|suggest using)\s+([^.\n]+)/i)
          if (proposalMatch && !hasActiveImplementation) {
            const claim = proposalMatch[0].trim().slice(0, 160)
            if (!seenClaims.has(claim)) {
              seenClaims.add(claim)
              items.push({
                id: `ledger-${computeContentHash(claim)}`,
                category: 'assistant_proposal',
                claim,
                sourceTurnId: visibleTurnLabel,
                confidence: 'inferred'
              })
            }
          }
        }
      }
    }
  })

  return items.slice(0, 12)
}

/**
 * Extracts the latest referenced code artifact or technical brief from the conversation without claiming it is working.
 */
export function extractLatestReferencedCodeArtifact(turns: ConversationTurn[]): {
  lang: string
  code: string
  preview: string
  sourceTurnId: string
  isInstructionBrief?: boolean
} | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (turn.sourceRole === 'assistant') {
      for (let j = turn.blocks.length - 1; j >= 0; j--) {
        const b = turn.blocks[j]
        if (b.type === 'code' && b.text.length > 30) {
          const firstLine = b.text.split('\n')[0].slice(0, 60)
          const isInstruction =
            b.language === 'markdown' ||
            b.language === 'text' ||
            /^(?:Implement\s+|#\s+|OBJECTIVE|INSTRUCTIONS)/i.test(b.text.trim())

          return {
            lang: b.language || 'code',
            code: b.text,
            preview: firstLine || `${b.language || 'code'} snippet`,
            sourceTurnId: `${i + 1} (${turn.id})`,
            isInstructionBrief: isInstruction
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
      if (full) {
        const { promptText } = separateAttachmentsFromUserPrompt(full)
        return promptText || full
      }
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

export interface ContinuationObjectiveContext {
  topic: string
  literalUserRequest: string
  contextualMeaning: string
  statusAtCapture: string
  nextImmediateAction: string
}

/**
 * Derives contextual meaning and active task goals when the latest user request is brief or a meta follow-up.
 */
export function deriveContinuationObjectiveContext(
  turns: ConversationTurn[],
  tabTitle?: string
): ContinuationObjectiveContext {
  const literalUserRequest = extractFullLatestUserRequest(turns)

  let latestUserIdx = -1
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].sourceRole === 'user') {
      latestUserIdx = i
      break
    }
  }

  const hasSubsequentAssistantResponse = latestUserIdx >= 0 && latestUserIdx < turns.length - 1

  const isMeta =
    !literalUserRequest ||
    (literalUserRequest.length < 80 &&
      /(?:what to tell|continue|next|proceed|what should|what next|what do i do|what's next|how to proceed|tell the ai|how to start)/i.test(
        literalUserRequest
      ))

  let substantiveGoal = ''
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].sourceRole === 'user') {
      const texts = turns[i].blocks.filter((b) => b.type === 'text').map((b) => (b as ContentBlockText).text)
      const joined = texts.join('\n').trim()
      const { promptText } = separateAttachmentsFromUserPrompt(joined)
      const cand = promptText || joined
      if (cand.length > 30 && !/(?:what to tell|continue|next|proceed|what should)/i.test(cand)) {
        substantiveGoal = cand
        break
      }
    }
  }

  let topic = tabTitle && tabTitle !== 'AI Chat' && tabTitle !== 'New Chat' ? tabTitle : ''
  if (!topic && substantiveGoal) {
    topic = substantiveGoal.split('\n')[0].slice(0, 100).trim()
  }
  if (!topic && literalUserRequest) {
    topic = literalUserRequest.split('\n')[0].slice(0, 100).trim()
  }
  if (!topic) {
    topic = 'Nexus AI Continuation & Engineering Task'
  }

  let contextualMeaning = literalUserRequest || 'Continue working on the ongoing engineering task.'
  let statusAtCapture = 'Active user directive pending execution.'
  let nextImmediateAction = extractNextActionCandidate(turns)

  if (hasSubsequentAssistantResponse) {
    statusAtCapture = 'Assessment and response supplied in dialogue prior to capture.'
    nextImmediateAction = 'Incoming agent to review dialogue assessment, check unverified claims, and await user feedback or revised input.'
  } else if (isMeta) {
    contextualMeaning = substantiveGoal
      ? `The user requested instructions for an incoming AI to continue: "${substantiveGoal.split('\n')[0].slice(0, 160)}"`
      : 'The user requested continuation instructions for the ongoing engineering task.'

    statusAtCapture = 'Implementation specification supplied in dialogue; incoming agent assigned to execute changes and verify.'

    if (substantiveGoal) {
      nextImmediateAction = `Continue implementing the ongoing task: ${substantiveGoal.split('\n')[0].slice(0, 200)}`
    }
  }

  return {
    topic,
    literalUserRequest,
    contextualMeaning,
    statusAtCapture,
    nextImmediateAction
  }
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

  // Exact code deduplication across turns if enabled (only in compact mode)
  let omissions: string[] = []
  if (deduplicateExactCode && mode === 'compact') {
    const dedupRes = deduplicateExactCodeAcrossTurns(activeTurns)
    activeTurns = dedupRes.turns
    omissions = dedupRes.omissions
  }

  const artifacts = snapshot.artifacts && snapshot.artifacts.length > 0 ? snapshot.artifacts : detectArtifactsFromTurns(activeTurns)
  const ledger = buildProvenanceLedger(activeTurns)
  const ctx = deriveContinuationObjectiveContext(activeTurns, snapshot.source.title)
  const currentObjective = options.userObjectiveOverride || ctx.contextualMeaning
  const nextActionCandidate = options.userNextActionOverride || ctx.nextImmediateAction
  const latestCodeArtifact = extractLatestReferencedCodeArtifact(activeTurns)

  // Serializer function for turn blocks to markdown in exact DOM order
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
    const userTurnsCount = activeTurns.filter((t) => t.sourceRole === 'user').length
    const assistantTurnsCount = activeTurns.filter((t) => t.sourceRole === 'assistant').length

    const headerNotice = [
      `# 🚀 AI AGENT CONTINUATION & SESSION HANDOFF CONTEXT`,
      `> **Handoff Notice**: Context captured from active session with **${providerLabel}** at ${snapshot.capturedAt}. Incoming agent is assigned to continue with full awareness of task provenance.`,
      `> **Coverage Notice**: Scope is \`${snapshot.coverage.scope}\` (${activeTurns.length} mounted turns: ${userTurnsCount} user / ${assistantTurnsCount} assistant). Full history completeness is unverified (only DOM-mounted turns captured; earlier conversation history may require scrolling in the provider webview to mount).`,
      snapshot.coverage.warnings.length > 0
        ? `> **Warnings**: ${snapshot.coverage.warnings.join('; ')}`
        : ''
    ].filter(Boolean).join('\n')

    const section1Objective = [
      `## 1. Current User Request & Objective`,
      `**Current Topic:**`,
      ctx.topic,
      `\n**Latest Literal User Request:**`,
      `> ${ctx.literalUserRequest || 'Continue working on the ongoing engineering task.'}`,
      ctx.literalUserRequest && ctx.literalUserRequest !== currentObjective
        ? `\n**Contextual Meaning (inferred; review before use):**\n${currentObjective}\n\n**Implementation Status at Capture:**\n${ctx.statusAtCapture}`
        : `\n**Implementation Status at Capture:**\n${ctx.statusAtCapture}`
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

    const isInstructions =
      latestCodeArtifact &&
      (latestCodeArtifact.isInstructionBrief ||
        latestCodeArtifact.lang === 'markdown' ||
        latestCodeArtifact.lang === 'text' ||
        /^(?:Implement\s+|#\s+|OBJECTIVE|INSTRUCTIONS)/i.test(latestCodeArtifact.code))

    const section5LatestCode = latestCodeArtifact
      ? [
          isInstructions
            ? `## 5. Latest Referenced Instructions / Technical Brief`
            : `## 5. Latest Referenced Code Artifact`,
          `*Most recent assistant ${isInstructions ? 'technical brief' : 'code snippet'} produced prior to handoff (source: Turn #${latestCodeArtifact.sourceTurnId}):*`,
          `${getSafeMarkdownFence(latestCodeArtifact.code)}${latestCodeArtifact.lang || ''}\n${latestCodeArtifact.code}\n${getSafeMarkdownFence(latestCodeArtifact.code)}\n`
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
      headerNotice,
      `\n${section1Objective}`,
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
