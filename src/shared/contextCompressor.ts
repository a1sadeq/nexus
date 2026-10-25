/**
 * contextCompressor.ts
 *
 * Deterministic client-side LLM context compression, sanitization,
 * and structured agent handoff prompt generation.
 *
 * Repaired for high fidelity:
 * - Fence-aware parsing that prevents code headings from creating false turns
 * - Safe UI noise removal that preserves array indexes and timestamps
 * - Exact-match code deduplication that preserves whitespace and formatting
 * - Full-content artifact matching that prevents distinct files with shared headers from collapsing
 * - Honest metrics and truthful status labels
 */

import {
  computeContentHash,
  getSafeMarkdownFence,
  estimateTokens,
  stripUiNoiseSafe,
  stripConversationalFluffSafe
} from './contextSnapshot'

export { estimateTokens }

export interface DialogueTurn {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'unknown'
  text: string
  codeBlocks?: Array<{ lang: string; code: string }>
  thinkingBlock?: string
}

export interface CompressionOptions {
  mode: 'handoff' | 'compact' | 'clean'
  stripPleasantries?: boolean
  deduplicateCode?: boolean
  excludeThinking?: boolean
  targetNextModel?: string
  userObjectiveOverride?: string
  userNextActionOverride?: string
}

export interface CompressionStats {
  rawChars: number
  compressedChars: number
  signedDeltaChars: number
  isExpanded: boolean
  rawTokensEstimate: number
  compressedTokensEstimate: number
  reductionPercent: number
  turnCount: number
  userTurns: number
  assistantTurns: number
  codeBlockCount: number
}

export interface HandoffContextResult {
  prompt: string
  stats: CompressionStats
  turns: DialogueTurn[]
  goal: string
  keyDecisions: string[]
  latestCodeSnippets: Array<{ lang: string; code: string; preview: string }>
  detectedFiles: string[]
  nextImmediateAction: string
  omissions?: string[]
}

/**
 * Strips standalone UI button lines from scraped chat DOM without
 * deleting bracketed citations/indexes (e.g. list[1]) or timestamps.
 */
export function stripUiNoise(rawText: string): string {
  return stripUiNoiseSafe(rawText)
}

/**
 * Strips conversational opening pleasantries and closing boilerplate from AI responses.
 */
export function stripConversationalFluff(text: string): string {
  return stripConversationalFluffSafe(text)
}

/**
 * Extracts code blocks from markdown text while respecting fences.
 */
export function extractCodeBlocks(text: string): Array<{ lang: string; code: string }> {
  const blocks: Array<{ lang: string; code: string }> = []
  // Matches ```lang\n...``` or ````lang\n...````
  const regex = /(`{3,})([a-zA-Z0-9_\-.]*)\n([\s\S]*?)\1/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      lang: match[2]?.trim() || 'text',
      code: match[3] || ''
    })
  }

  return blocks
}

/**
 * Parses raw extracted transcript string into structured DialogueTurn objects.
 * Markdown fence-aware: headings inside code blocks do not create false turns.
 */
export function parseRawTranscript(rawText: string): DialogueTurn[] {
  if (!rawText || !rawText.trim()) return []

  const lines = rawText.split('\n')
  const turns: DialogueTurn[] = []

  let currentRole: DialogueTurn['role'] | null = null
  let currentLines: string[] = []
  let inCodeBlock = false
  let codeFenceLength = 0

  const headingRegex = /^##\s*(User|Assistant|Model|System|Tool|Human|Claude|ChatGPT|Gemini|DeepSeek)\b/i

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = line.match(/^(`{3,})/)

    if (fenceMatch) {
      const len = fenceMatch[1].length
      if (!inCodeBlock) {
        inCodeBlock = true
        codeFenceLength = len
      } else if (len >= codeFenceLength) {
        inCodeBlock = false
        codeFenceLength = 0
      }
    }

    // Only recognize headings when NOT inside a code block
    if (!inCodeBlock) {
      const match = line.match(headingRegex)
      if (match) {
        if (currentRole && currentLines.length > 0) {
          finalizeTurn(turns, currentRole, currentLines.join('\n'))
          currentLines = []
        }

        const roleStr = match[1].toLowerCase()
        if (roleStr === 'user' || roleStr === 'human') {
          currentRole = 'user'
        } else if (roleStr === 'system') {
          currentRole = 'system'
        } else if (roleStr === 'tool') {
          currentRole = 'tool'
        } else {
          currentRole = 'assistant'
        }
        continue
      }
    }

    if (currentRole) {
      currentLines.push(line)
    } else {
      // Preamble before any role header
      currentLines.push(line)
    }
  }

  if (currentRole && currentLines.length > 0) {
    finalizeTurn(turns, currentRole, currentLines.join('\n'))
  } else if (!currentRole && currentLines.length > 0) {
    // Fallback: parse user: / assistant: prefix if no ## headings were found
    parsePrefixedLines(currentLines, turns)
  }

  return turns
}

function finalizeTurn(turns: DialogueTurn[], role: DialogueTurn['role'], fullText: string) {
  let bodyText = fullText.trim()
  let thinkingBlock: string | undefined = undefined

  // Only extract <think> if not in a code block
  const thinkMatch = bodyText.match(/<(?:think|thinking)>([\s\S]*?)<\/(?:think|thinking)>/i)
  if (thinkMatch) {
    // Check if the think match is inside a code block
    const preText = bodyText.slice(0, thinkMatch.index)
    const backticksBefore = (preText.match(/```/g) || []).length
    if (backticksBefore % 2 === 0) {
      thinkingBlock = thinkMatch[1].trim()
      bodyText = bodyText.replace(/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>/gi, '').trim()
    }
  }

  const codeBlocks = extractCodeBlocks(bodyText)

  turns.push({
    role,
    text: bodyText,
    codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
    thinkingBlock
  })
}

function parsePrefixedLines(lines: string[], turns: DialogueTurn[]) {
  let currentRole: DialogueTurn['role'] = 'user'
  let currentBuffer: string[] = []

  for (const line of lines) {
    const lower = line.trim().toLowerCase()
    if (lower.startsWith('user:') || lower.startsWith('human:')) {
      if (currentBuffer.length > 0) {
        turns.push({ role: currentRole, text: currentBuffer.join('\n').trim() })
        currentBuffer = []
      }
      currentRole = 'user'
      currentBuffer.push(line.replace(/^(?:user|human):\s*/i, ''))
    } else if (lower.startsWith('assistant:') || lower.startsWith('claude:') || lower.startsWith('chatgpt:') || lower.startsWith('gemini:')) {
      if (currentBuffer.length > 0) {
        turns.push({ role: currentRole, text: currentBuffer.join('\n').trim() })
        currentBuffer = []
      }
      currentRole = 'assistant'
      currentBuffer.push(line.replace(/^(?:assistant|claude|chatgpt|gemini):\s*/i, ''))
    } else if (lower.startsWith('system:')) {
      if (currentBuffer.length > 0) {
        turns.push({ role: currentRole, text: currentBuffer.join('\n').trim() })
        currentBuffer = []
      }
      currentRole = 'system'
      currentBuffer.push(line.replace(/^system:\s*/i, ''))
    } else {
      currentBuffer.push(line)
    }
  }

  if (currentBuffer.length > 0) {
    turns.push({ role: currentRole, text: currentBuffer.join('\n').trim() })
  }
}

/**
 * Deduplicates exact identical code blocks across turns without normalizing whitespace.
 */
export function deduplicateCodeAcrossTurns(turns: DialogueTurn[]): DialogueTurn[] {
  const lastSeenIndex = new Map<string, number>()

  // Locate exact matches
  turns.forEach((turn, turnIdx) => {
    if (turn.codeBlocks && turn.codeBlocks.length > 0) {
      for (const block of turn.codeBlocks) {
        if (block.code.length > 80) {
          const key = block.code // Exact content equality!
          lastSeenIndex.set(key, turnIdx)
        }
      }
    }
  })

  return turns.map((turn, turnIdx) => {
    if (!turn.codeBlocks || turn.codeBlocks.length === 0) return turn

    let newText = turn.text
    for (const block of turn.codeBlocks) {
      const key = block.code
      const finalTurn = lastSeenIndex.get(key)
      if (finalTurn !== undefined && finalTurn > turnIdx) {
        const fence = getSafeMarkdownFence(block.code)
        const fullMarkdownBlock = `${fence}${block.lang}\n${block.code}\n${fence}`
        const replacement = `${fence}${block.lang}\n/* [Identical code block omitted — see Turn #${finalTurn + 1}] */\n${fence}`

        if (newText.includes(fullMarkdownBlock)) {
          newText = newText.replace(fullMarkdownBlock, replacement)
        } else if (newText.includes(`\`\`\`${block.lang}\n${block.code}\n\`\`\``)) {
          newText = newText.replace(
            `\`\`\`${block.lang}\n${block.code}\n\`\`\``,
            replacement
          )
        }
      }
    }

    return {
      ...turn,
      text: newText
    }
  })
}

/**
 * Extracts key decisions and constraints made in the conversation.
 */
export function extractKeyDecisions(turns: DialogueTurn[]): string[] {
  const decisions: string[] = []
  const decisionTriggers = [
    /(?:decided to|let's use|we should use|switching to|we agreed on|chosen to|use\s+([A-Za-z0-9_-]+)\s+instead of|rule:|constraint:|requirement:)\s+([^.\n]+)/gi,
    /(?:architecture|design decision|technical constraint|key takeaway):\s*([^.\n]+)/gi
  ]

  for (const turn of turns) {
    for (const trigger of decisionTriggers) {
      let match: RegExpExecArray | null
      while ((match = trigger.exec(turn.text)) !== null) {
        const clean = match[0].trim().replace(/^[-*•\s]+/, '')
        if (clean.length > 10 && clean.length < 200 && !decisions.includes(clean)) {
          decisions.push(clean)
        }
      }
    }
  }

  if (decisions.length === 0) {
    for (const turn of turns) {
      if (turn.role === 'user' && turn.text.length < 150) {
        const line = turn.text.split('\n')[0].trim()
        if (line && !decisions.includes(line)) {
          decisions.push(line)
        }
      }
    }
  }

  return decisions.slice(0, 8)
}

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
 * Finds referenced file paths across turns.
 */
export function detectReferencedFiles(turns: DialogueTurn[]): string[] {
  const fileSet = new Set<string>()
  const fileRegex = /(?:^|[\s"'`(/])([a-zA-Z0-9_\-./]+?\.(?:ts|tsx|js|jsx|json|html|css|scss|md|txt|py|go|rs|cpp|c|h|yaml|yml|toml|sql|sh|env))\b/g

  for (const turn of turns) {
    let match: RegExpExecArray | null
    while ((match = fileRegex.exec(turn.text)) !== null) {
      const rawCand = match[1].trim()
      if (!rawCand.startsWith('http') && !rawCand.startsWith('www.') && !rawCand.includes('example.com') && rawCand.length > 3) {
        const splitCands = cleanFileCandidate(rawCand)
        for (const candidate of splitCands) {
          const trimmed = candidate.trim()
          if (trimmed && trimmed.length > 3) {
            fileSet.add(trimmed)
          }
        }
      }
    }
  }

  return Array.from(fileSet).slice(0, 16)
}

/**
 * Extracts latest code artifacts produced by the assistant using full content hashing.
 * Prevents collapsing distinct files that share common license/import headers.
 */
export function extractLatestCodeArtifacts(turns: DialogueTurn[]): Array<{ lang: string; code: string; preview: string }> {
  const artifacts: Array<{ lang: string; code: string; preview: string }> = []
  const seenHashes = new Set<string>()

  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (turn.role === 'assistant' && turn.codeBlocks) {
      for (const block of turn.codeBlocks) {
        const hash = computeContentHash(block.code)
        if (!seenHashes.has(hash) && block.code.length > 30) {
          seenHashes.add(hash)
          const firstLine = block.code.split('\n')[0].slice(0, 60)
          artifacts.push({
            lang: block.lang || 'code',
            code: block.code,
            preview: firstLine || `${block.lang} snippet`
          })
          if (artifacts.length >= 6) break
        }
      }
    }
    if (artifacts.length >= 6) break
  }

  return artifacts
}

/**
 * Detects the next immediate action where the previous session left off.
 */
export function extractNextImmediateAction(turns: DialogueTurn[]): string {
  if (turns.length === 0) return 'Continue working on the ongoing task.'

  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'user') {
      const clean = turns[i].text.trim()
      if (clean) {
        return clean.length > 300 ? clean.slice(0, 300) + '...' : clean
      }
    }
  }

  const lastTurn = turns[turns.length - 1]
  const lines = lastTurn.text.split('\n').filter(Boolean)
  return lines[lines.length - 1] || 'Proceed with implementing the planned changes.'
}

/**
 * Derives a high-level goal from user turns.
 */
export function deriveGoal(turns: DialogueTurn[]): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'user') {
      const lines = turns[i].text.split('\n').filter(Boolean)
      if (lines.length > 0 && lines[0].length > 15) {
        return lines[0].length > 250 ? lines[0].slice(0, 250) + '...' : lines[0]
      }
    }
  }
  for (const turn of turns) {
    if (turn.role === 'user') {
      const firstLines = turn.text.split('\n').slice(0, 3).join(' ').trim()
      if (firstLines.length > 15) {
        return firstLines.length > 200 ? firstLines.slice(0, 200) + '...' : firstLines
      }
    }
  }
  return 'Collaborative engineering and development task.'
}

/**
 * Primary Generator: Constructs the high-fidelity Agent Handoff Document.
 */
export function buildAgentHandoffPrompt(params: {
  providerName: string
  rawText: string
  options?: Partial<CompressionOptions>
}): HandoffContextResult {
  const { providerName, rawText, options = {} } = params

  const mode = options.mode || 'handoff'
  const stripPleasantries = options.stripPleasantries ?? true
  const deduplicateCode = options.deduplicateCode ?? true
  const excludeThinking = options.excludeThinking ?? true

  const rawChars = rawText.length
  const rawTokens = estimateTokens(rawText)

  // 1. Parse into turns without destroying code headings
  let turns = parseRawTranscript(stripUiNoise(rawText))

  // 2. Clean turns non-destructively
  turns = turns.map((t) => {
    let text = t.text
    if (stripPleasantries && t.role === 'assistant') {
      text = stripConversationalFluff(text)
    }

    let thinkingBlock = t.thinkingBlock
    if (excludeThinking) {
      thinkingBlock = undefined
    }

    return {
      ...t,
      text,
      thinkingBlock
    }
  })

  // 3. Exact code deduplication
  if (deduplicateCode) {
    turns = deduplicateCodeAcrossTurns(turns)
  }

  // 4. Extract metadata
  const goal = options.userObjectiveOverride || deriveGoal(turns)
  const keyDecisions = extractKeyDecisions(turns)
  const detectedFiles = detectReferencedFiles(turns)
  const latestCodeSnippets = extractLatestCodeArtifacts(turns)
  const nextImmediateAction = options.userNextActionOverride || extractNextImmediateAction(turns)

  const userTurnsCount = turns.filter((t) => t.role === 'user').length
  const assistantTurnsCount = turns.filter((t) => t.role === 'assistant').length
  const totalCodeBlocks = turns.reduce((acc, t) => acc + (t.codeBlocks?.length || 0), 0)

  // 5. Build transcript representation
  let dialogueBody = ''
  if (mode === 'compact') {
    // High-density pack: preserve exact code without stopword deletion
    dialogueBody = turns
      .map((t, i) => {
        const roleLabel = t.role.toUpperCase()
        let content = t.text
        if (t.thinkingBlock && !excludeThinking) {
          content = `> [!NOTE] Thinking Summary\n> ${t.thinkingBlock.replace(/\n/g, '\n> ')}\n\n${content}`
        }
        return `[Turn ${i + 1} - ${roleLabel}]:\n${content}`
      })
      .join('\n\n')
  } else {
    // Standard structured dialogue
    dialogueBody = turns
      .map((t, i) => {
        const roleLabel = t.role.charAt(0).toUpperCase() + t.role.slice(1)
        let content = t.text
        if (t.thinkingBlock && !excludeThinking) {
          content = `> [!NOTE] Thinking Summary\n> ${t.thinkingBlock.replace(/\n/g, '\n> ')}\n\n${content}`
        }
        return `### Turn ${i + 1} (${roleLabel})\n${content}`
      })
      .join('\n\n---\n\n')
  }

  // 6. Build final markdown
  let finalPrompt = ''

  if (mode === 'clean') {
    finalPrompt = `# Session Transcript (${providerName})\n\n${dialogueBody}`
  } else {
    // Agent Handoff Mode
    finalPrompt = [
      `# 🚀 AI AGENT CONTINUATION & SESSION HANDOFF CONTEXT`,
      `> **Handoff Notice**: Context captured from active session with **${providerName}**. Incoming agent is assigned to continue task execution with full awareness of conversation history.\n`,
      `## 🎯 1. Primary Objective & Goal`,
      `${goal}\n`,
      `## 🧠 2. Established Decisions & Technical Constraints`,
      `The following architectural points were discussed in the session. Verify against the current codebase before modifying:`,
      keyDecisions.length > 0
        ? keyDecisions.map((d) => `- ${d}`).join('\n')
        : `- Maintain existing codebase conventions and architectural decisions.\n`,
      `\n## 📁 3. Active Files & Referenced Architecture`,
      detectedFiles.length > 0
        ? detectedFiles.map((f) => `- \`${f}\``).join('\n')
        : `- (Referenced in dialogue context below)\n`,
      `\n## ⚡ 4. Next Immediate Action for Incoming Agent`,
      `**Your primary immediate objective is to address:**`,
      `> ${nextImmediateAction}\n`,
      latestCodeSnippets.length > 0
        ? [
            `## 💾 5. Latest Referenced Code Artifact`,
            `*Most recent assistant code snippet produced prior to handoff:*`,
            `${getSafeMarkdownFence(latestCodeSnippets[0].code)}${latestCodeSnippets[0].lang}`,
            latestCodeSnippets[0].code,
            `${getSafeMarkdownFence(latestCodeSnippets[0].code)}\n`
          ].join('\n')
        : '',
      `## 📜 6. Dialogue Transcript Evidence`,
      `<session_transcript provider="${providerName}" turns="${turns.length}">`,
      dialogueBody,
      `</session_transcript>\n`,
      `## 🤖 Directive for Incoming AI Agent:`,
      `1. **Evidence Distinction**: Treat historical transcript as evidence; verify current repository state before acting.`,
      `2. **Immediate Execution**: Directly answer or execute the next immediate action stated in Section 4.`
    ].filter(Boolean).join('\n')
  }

  const compressedChars = finalPrompt.length
  const compressedTokens = estimateTokens(finalPrompt)
  const signedDeltaChars = compressedChars - rawChars
  const isExpanded = signedDeltaChars > 0
  const reductionPercent = rawChars > 0 ? Math.round(((rawChars - compressedChars) / rawChars) * 100) : 0

  const stats: CompressionStats = {
    rawChars,
    compressedChars,
    signedDeltaChars,
    isExpanded,
    rawTokensEstimate: rawTokens,
    compressedTokensEstimate: compressedTokens,
    reductionPercent,
    turnCount: turns.length,
    userTurns: userTurnsCount,
    assistantTurns: assistantTurnsCount,
    codeBlockCount: totalCodeBlocks
  }

  return {
    prompt: finalPrompt,
    stats,
    turns,
    goal,
    keyDecisions,
    latestCodeSnippets,
    detectedFiles,
    nextImmediateAction
  }
}
