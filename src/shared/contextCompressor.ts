/**
 * contextCompressor.ts
 *
 * Deterministic client-side LLM context compression, sanitization,
 * and structured agent handoff prompt generation.
 *
 * Solves the critical edge-case where an AI conversation has passed its
 * message/context limit (so the user cannot ask that AI to summarize itself).
 */

export interface DialogueTurn {
  role: 'user' | 'assistant' | 'system'
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
}

export interface CompressionStats {
  rawChars: number
  compressedChars: number
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
}

/**
 * Estimate token count using the standard ~4 chars per token rule of thumb
 * for English prose and code.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * Strips UI artifacts, buttons, timestamps, copy prompts, and citations
 * that bleed into scraped chat DOM.
 */
export function stripUiNoise(rawText: string): string {
  if (!rawText) return ''

  return rawText
    // Strip copy button text that gets concatenated
    .replace(/(?:^|\n)\s*(?:Copy code|Copy|Copied!?|Copy text|Code copied!?)\s*(?:\n|$)/gi, '\n')
    // Strip feedback / action button artifacts
    .replace(/(?:^|\n)\s*(?:Was this response better\?|Was this helpful\?|Thumbs up|Thumbs down|Good response|Bad response|Share|Retry|Regenerate response|Regenerate|Edit message|View other drafts|Show thinking|Hide thinking|Thought for \d+ seconds?)\s*(?:\n|$)/gi, '\n')
    // Strip numeric citations like [1], [2], [citation:1]
    .replace(/\[(?:citation:)?\d+\]/gi, '')
    // Strip timestamps like "10:42 AM", "Yesterday at 3:15 PM"
    .replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi, '')
    .replace(/\b(?:Today|Yesterday)\s+at\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM))?\b/gi, '')
    // Strip pagination controls like "1 / 4", "2 of 3"
    .replace(/(?:^|\n)\s*\d+\s*(?:\/|of)\s*\d+\s*(?:\n|$)/g, '\n')
    // Strip empty blockquotes or trailing line clutter
    .replace(/^\s*>\s*$/gm, '')
    // Normalize newlines (max 2 consecutive)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Strips conversational opening pleasantries and closing boilerplate from AI responses.
 */
export function stripConversationalFluff(text: string): string {
  if (!text) return ''

  let cleaned = text

  // Opening pleasantries regexes (multiline aware)
  const openingPatterns = [
    /^(?:Certainly|Sure thing|Sure|Of course|Absolutely|Gladly|I'd be (?:happy|glad) to help(?: you with that)?)[!.,]?\s*(?:Here(?:'s| is) (?:the|an|your) (?:code|updated code|solution|implementation|response|explanation)[^.\n]*[.:!\n]+)?\s*/i,
    /^(?:Hello!|Hi there!|Hi!|Hey!)\s*(?:Here(?:'s| is) (?:the|an|your)[^.\n]*[.:!\n]+)?\s*/i,
    /^(?:Below is (?:the|an|your) (?:code|updated|revised|complete|modified|working) (?:code|solution|implementation|version)[^.\n]*[.:!\n]+)\s*/i,
    /^(?:Based on your request|As requested|To solve this issue|In order to fix this)[,:]\s*/i
  ]

  for (const pat of openingPatterns) {
    cleaned = cleaned.replace(pat, '')
  }

  // Closing boilerplate regexes
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
 * Extracts code blocks from markdown text.
 */
export function extractCodeBlocks(text: string): Array<{ lang: string; code: string }> {
  const blocks: Array<{ lang: string; code: string }> = []
  const regex = /```([a-zA-Z0-9_\-\.]*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      lang: match[1]?.trim() || 'text',
      code: match[2]?.trim() || ''
    })
  }

  return blocks
}

/**
 * Parses raw extracted transcript string into structured DialogueTurn objects.
 */
export function parseRawTranscript(rawText: string): DialogueTurn[] {
  if (!rawText || !rawText.trim()) return []

  const turns: DialogueTurn[] = []

  // Check if text uses '## User' / '## Assistant' or similar headings
  const sectionRegex = /(?:^|\n)##\s*(User|Assistant|Model|System|Human|Claude|ChatGPT|Gemini|DeepSeek)[^\n]*\n([\s\S]*?)(?=(?:\n##\s*(?:User|Assistant|Model|System|Human|Claude|ChatGPT|Gemini|DeepSeek)[^\n]*\n)|$)/gi

  let match: RegExpExecArray | null
  let matchedAny = false

  while ((match = sectionRegex.exec(rawText)) !== null) {
    matchedAny = true
    const roleHeader = match[1].toLowerCase()
    const content = match[2].trim()

    let role: DialogueTurn['role'] = 'assistant'
    if (roleHeader === 'user' || roleHeader === 'human') {
      role = 'user'
    } else if (roleHeader === 'system') {
      role = 'system'
    }

    // Check for thinking blocks inside assistant content
    let thinkingBlock: string | undefined = undefined
    let bodyText = content

    const thinkMatch = content.match(/<(?:think|thinking)>([\s\S]*?)<\/(?:think|thinking)>/i)
    if (thinkMatch) {
      thinkingBlock = thinkMatch[1].trim()
      bodyText = content.replace(/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>/gi, '').trim()
    }

    const codeBlocks = extractCodeBlocks(bodyText)

    turns.push({
      role,
      text: bodyText,
      codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
      thinkingBlock
    })
  }

  // Fallback if no ## headings were found
  if (!matchedAny) {
    const lines = rawText.split('\n')
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
      } else {
        currentBuffer.push(line)
      }
    }

    if (currentBuffer.length > 0) {
      turns.push({ role: currentRole, text: currentBuffer.join('\n').trim() })
    }
  }

  return turns
}

/**
 * Deduplicates identical code blocks across turns, replacing earlier copies
 * with a compact pointer note to the definitive turn.
 */
export function deduplicateCodeAcrossTurns(turns: DialogueTurn[]): DialogueTurn[] {
  // Find code blocks and their last occurrence turn index
  const lastSeenIndex = new Map<string, number>()

  turns.forEach((turn, turnIdx) => {
    if (turn.codeBlocks && turn.codeBlocks.length > 0) {
      for (const block of turn.codeBlocks) {
        if (block.code.length > 80) { // only deduplicate substantial blocks
          const key = block.code.replace(/\s+/g, ' ').trim()
          lastSeenIndex.set(key, turnIdx)
        }
      }
    }
  })

  return turns.map((turn, turnIdx) => {
    if (!turn.codeBlocks || turn.codeBlocks.length === 0) return turn

    let newText = turn.text
    for (const block of turn.codeBlocks) {
      const key = block.code.replace(/\s+/g, ' ').trim()
      const finalTurn = lastSeenIndex.get(key)
      // If this block appears again in a later turn, abbreviate earlier instance
      if (finalTurn !== undefined && finalTurn > turnIdx) {
        const fullMarkdownBlock = `\`\`\`${block.lang}\n${block.code}\n\`\`\``
        const replacement = `\`\`\`${block.lang}\n/* [Identical code block omitted — see final working version in Turn #${finalTurn + 1}] */\n\`\`\``
        if (newText.includes(fullMarkdownBlock)) {
          newText = newText.replace(fullMarkdownBlock, replacement)
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

  // If no explicit triggers matched, synthesize sensible summary from user prompts
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

  return decisions.slice(0, 6)
}

/**
 * Finds referenced file paths across turns (e.g. src/App.tsx, package.json).
 */
export function detectReferencedFiles(turns: DialogueTurn[]): string[] {
  const fileSet = new Set<string>()
  const fileRegex = /(?:^|[\s"'`(/])([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|json|html|css|scss|md|py|go|rs|cpp|c|h|yaml|yml|toml|sql|sh|env))(?:[\s"'`):,]|$)/g

  for (const turn of turns) {
    let match: RegExpExecArray | null
    while ((match = fileRegex.exec(turn.text)) !== null) {
      const candidate = match[1].trim()
      // Filter out common false positives
      if (!candidate.startsWith('http') && !candidate.startsWith('www.') && !candidate.includes('example.com') && candidate.length > 3) {
        fileSet.add(candidate)
      }
    }
  }

  return Array.from(fileSet).slice(0, 10)
}

/**
 * Extracts latest code artifacts produced by the assistant.
 */
export function extractLatestCodeArtifacts(turns: DialogueTurn[]): Array<{ lang: string; code: string; preview: string }> {
  const artifacts: Array<{ lang: string; code: string; preview: string }> = []
  const seenCode = new Set<string>()

  // Traverse backwards to pick up the most recent snippets
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (turn.role === 'assistant' && turn.codeBlocks) {
      for (const block of turn.codeBlocks) {
        const signature = block.code.slice(0, 60)
        if (!seenCode.has(signature) && block.code.length > 40) {
          seenCode.add(signature)
          const firstLine = block.code.split('\n')[0].slice(0, 60)
          artifacts.push({
            lang: block.lang || 'code',
            code: block.code,
            preview: firstLine || `${block.lang} snippet`
          })
          if (artifacts.length >= 4) break
        }
      }
    }
    if (artifacts.length >= 4) break
  }

  return artifacts
}

/**
 * Detects the next immediate action where the previous session left off.
 */
export function extractNextImmediateAction(turns: DialogueTurn[]): string {
  if (turns.length === 0) return 'Continue working on the ongoing task.'

  // Check the last user query
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'user') {
      const clean = turns[i].text.trim()
      if (clean) {
        return clean.length > 250 ? clean.slice(0, 250) + '...' : clean
      }
    }
  }

  // Fallback to the last assistant's trailing sentences
  const lastTurn = turns[turns.length - 1]
  const lines = lastTurn.text.split('\n').filter(Boolean)
  return lines[lines.length - 1] || 'Proceed with implementing the planned changes.'
}

/**
 * Derives a high-level goal from the first few user turns.
 */
export function deriveGoal(turns: DialogueTurn[]): string {
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

  // 1. Parse into turns
  let turns = parseRawTranscript(stripUiNoise(rawText))

  // 2. Clean each turn
  turns = turns.map((t) => {
    let text = t.text
    if (stripPleasantries && t.role === 'assistant') {
      text = stripConversationalFluff(text)
    }
    // Handle thinking process
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

  // 3. Deduplicate repetitive code blocks across turns
  if (deduplicateCode) {
    turns = deduplicateCodeAcrossTurns(turns)
  }

  // 4. Extract metadata & anchors
  const goal = deriveGoal(turns)
  const keyDecisions = extractKeyDecisions(turns)
  const detectedFiles = detectReferencedFiles(turns)
  const latestCodeSnippets = extractLatestCodeArtifacts(turns)
  const nextImmediateAction = extractNextImmediateAction(turns)

  const userTurnsCount = turns.filter((t) => t.role === 'user').length
  const assistantTurnsCount = turns.filter((t) => t.role === 'assistant').length
  const totalCodeBlocks = turns.reduce((acc, t) => acc + (t.codeBlocks?.length || 0), 0)

  // 5. Build transcript representation
  let dialogueBody = ''
  if (mode === 'compact') {
    // Ultra-compact caveman style: high-signal bullets, no articles, exact code
    dialogueBody = turns
      .map((t, i) => {
        const prefix = t.role === 'user' ? `[Turn ${i + 1} - User]` : `[Turn ${i + 1} - Assistant]`
        const compressedText = t.text
          .replace(/\b(a|an|the|very|basically|actually|simply|essentially|please)\b\s*/gi, '')
          .replace(/\n{2,}/g, '\n')
        return `${prefix}:\n${compressedText}`
      })
      .join('\n\n')
  } else {
    // Standard structured dialogue
    dialogueBody = turns
      .map((t, i) => {
        const roleLabel = t.role === 'user' ? 'User' : 'Assistant'
        return `### Turn ${i + 1} (${roleLabel})\n${t.text}`
      })
      .join('\n\n---\n\n')
  }

  // 6. Build the final prompt markdown based on mode
  let finalPrompt = ''

  if (mode === 'clean') {
    finalPrompt = `# Session Transcript (${providerName})\n\n${dialogueBody}`
  } else {
    // Agent Handoff Mode
    finalPrompt = [
      `# 🚀 AI AGENT CONTINUATION & SESSION HANDOFF CONTEXT`,
      `> **Handoff Protocol**: This context file was generated by Nexus because the previous session with **${providerName}** reached its conversation limit or was transferred. You are the incoming AI agent assigned to continue the task immediately with zero lost momentum.\n`,
      `## 🎯 1. Primary Objective & Goal`,
      `${goal}\n`,
      `## 🧠 2. Established Decisions & Technical Constraints`,
      `The following architectural decisions have already been made and verified. **Do not modify or re-litigate these unless explicitly instructed by the user**:`,
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
            `## 💾 5. Latest Working Code State`,
            `The most recent assistant code snippet produced before the handoff:`,
            `\`\`\`${latestCodeSnippets[0].lang}`,
            latestCodeSnippets[0].code,
            `\`\`\`\n`
          ].join('\n')
        : '',
      `## 📜 6. Compressed Dialogue Transcript`,
      `<session_transcript provider="${providerName}" turns="${turns.length}" compressed="true">`,
      dialogueBody,
      `</session_transcript>\n`,
      `## 🤖 Directive for Incoming AI Agent:`,
      `1. **Internalize Context**: Do NOT re-ask questions that were already resolved in the transcript.`,
      `2. **Acknowledge Pickup**: Begin your response with: \`"I have ingested the full handoff context from ${providerName} and am ready to continue."\``,
      `3. **Immediate Execution**: Directly answer or execute the next immediate action stated in Section 4.`
    ].filter(Boolean).join('\n')
  }

  const compressedChars = finalPrompt.length
  const compressedTokens = estimateTokens(finalPrompt)
  const reductionPercent = rawChars > 0 ? Math.max(0, Math.round(((rawChars - compressedChars) / rawChars) * 100)) : 0

  const stats: CompressionStats = {
    rawChars,
    compressedChars,
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
