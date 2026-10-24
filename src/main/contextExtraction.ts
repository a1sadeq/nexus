/**
 * contextExtraction.ts
 *
 * In-guest DOM extraction script and adapter dispatcher for AI sessions.
 * Preserves structured turn roots, roles, code blocks, links, attachments,
 * and user-visible thought summaries while excluding workspace/sidebar/composer noise.
 */

import {
  type ConversationSnapshot,
  type ConversationTurn,
  type ContentBlock,
  type TurnRole,
  computeContentHash,
  detectArtifactsFromTurns
} from '../shared/contextSnapshot'

export interface RawExtractionBlock {
  type: 'text' | 'code' | 'link' | 'attachment' | 'tool-result' | 'thought'
  text?: string
  language?: string
  label?: string
  destination?: string
  name?: string
  availability?: 'reference-only' | 'included'
  path?: string
}

export interface RawExtractionTurn {
  id: string
  sourceRole: TurnRole
  roleEvidence: string
  blocks: RawExtractionBlock[]
  status: 'complete' | 'streaming' | 'unknown'
  timestamp?: string
}

export interface RawExtractionPayload {
  success: boolean
  error?: string
  adapterId: string
  adapterVersion: number
  completeness: 'confirmed-for-source' | 'partial' | 'unknown'
  scope: 'mounted-transcript' | 'user-loaded-history' | 'imported-archive'
  streaming: 'yes' | 'no' | 'unknown'
  warnings: string[]
  turns: RawExtractionTurn[]
}

/**
 * Builds the standalone JavaScript string to be executed in the guest WebContents.
 * Contains no external dependencies or unsupported browser APIs.
 */
export function buildContextExtractorScript(): string {
  const code = function (): RawExtractionPayload {
    try {
      const hostname = (window.location.hostname || '').toLowerCase()
      const url = (window.location.href || '').toLowerCase()

      function matchesDomain(domain: string): boolean {
        return hostname === domain || hostname.endsWith('.' + domain)
      }

      function cleanProseNode(node: HTMLElement): string {
        if (!node) return ''
        const clone = node.cloneNode(true) as HTMLElement
        // Strip interactive buttons, copy buttons, feedback icons, svgs, and pagination controls
        clone.querySelectorAll(
          'button, [role="button"], .copy-button, .feedback-button, svg, [aria-hidden="true"], [data-testid*="copy"], .citation-bubble, .citations, aside, [data-workspace], .composer, [contenteditable="true"]'
        ).forEach((el) => el.remove())

        return (clone.innerText || clone.textContent || '').trim()
      }

      function extractBlocksFromElement(el: HTMLElement): RawExtractionBlock[] {
        const blocks: RawExtractionBlock[] = []

        // Extract user-visible thinking / reasoning details first
        const thoughtElements = el.querySelectorAll('[class*="thought"], [class*="thinking"], [class*="reasoning"], details')
        const thoughtTexts: string[] = []
        thoughtElements.forEach((thoughtEl) => {
          const thoughtText = cleanProseNode(thoughtEl as HTMLElement)
          if (thoughtText && thoughtText.length > 5) {
            thoughtTexts.push(thoughtText)
            blocks.push({
              type: 'thought',
              text: thoughtText
            })
          }
        })

        // Clone element to extract prose and code separately
        const clone = el.cloneNode(true) as HTMLElement

        // Remove thought elements from clone so their text is not duplicated in prose
        clone.querySelectorAll('[class*="thought"], [class*="thinking"], [class*="reasoning"], details').forEach((t) => t.remove())

        // Remove interactive UI buttons
        clone.querySelectorAll(
          'button, [role="button"], .copy-button, .feedback-button, svg, [aria-hidden="true"], [data-testid*="copy"]'
        ).forEach((b) => b.remove())

        // Extract code blocks (<pre><code>)
        const codeNodes = clone.querySelectorAll('pre')
        if (codeNodes.length > 0) {
          codeNodes.forEach((pre) => {
            const codeEl = pre.querySelector('code') || pre
            const langClass = (codeEl.className || pre.className || '').match(/language-([a-zA-Z0-9_-]+)/)
            const lang = langClass ? langClass[1] : ''
            const codeText = codeEl.textContent || pre.textContent || ''

            if (codeText.trim()) {
              blocks.push({
                type: 'code',
                language: lang || undefined,
                text: codeText
              })
            }
            pre.remove() // Remove pre from clone so remaining is prose
          })
        }

        // Extract links
        const linkNodes = clone.querySelectorAll('a[href]')
        linkNodes.forEach((a) => {
          const href = a.getAttribute('href') || ''
          const label = (a.textContent || '').trim()
          if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            blocks.push({
              type: 'link',
              label: label || href,
              destination: href
            })
          }
        })

        // Remaining prose
        const remainingText = (clone.innerText || clone.textContent || '').trim()
        if (remainingText) {
          blocks.unshift({
            type: 'text',
            text: remainingText
          })
        }

        return blocks
      }

      const turns: RawExtractionTurn[] = []
      let adapterId = 'universal-fallback'
      let completeness: RawExtractionPayload['completeness'] = 'confirmed-for-source'
      const warnings: string[] = []

      // 1. Arena Agent Mode (Verified outer roots and roles)
      if (matchesDomain('arena.ai') || url.includes('/arena') || document.querySelector('[data-agent-transcript-message]')) {
        adapterId = 'arena-agent-mode'
        const arenaRoots = document.querySelectorAll('[data-agent-transcript-message="true"][data-chat-message-id]')

        if (arenaRoots.length > 0) {
          arenaRoots.forEach((root, idx) => {
            const el = root as HTMLElement
            const msgId = el.getAttribute('data-chat-message-id') || `msg-${idx + 1}`

            // Check if user layout is present
            const isUser = el.querySelector('[data-user-message-layout="true"]') !== null
            const isTool = el.getAttribute('data-is-tool') === 'true' || el.querySelector('[data-tool-result]') !== null

            let role: TurnRole = 'assistant'
            let roleEvidence = 'data-agent-transcript-message'

            if (isUser) {
              role = 'user'
              roleEvidence = 'data-user-message-layout="true"'
            } else if (isTool) {
              role = 'tool'
              roleEvidence = 'data-is-tool="true"'
            }

            const blocks = extractBlocksFromElement(el)
            if (blocks.length > 0) {
              turns.push({
                id: msgId,
                sourceRole: role,
                roleEvidence,
                blocks,
                status: 'complete'
              })
            }
          })
        }
      }

      // 2. ChatGPT (chatgpt.com / chat.openai.com)
      if (turns.length === 0 && (matchesDomain('chatgpt.com') || matchesDomain('openai.com'))) {
        adapterId = 'chatgpt'
        const chatgptRoots = document.querySelectorAll('[data-message-author-role]')
        chatgptRoots.forEach((root, idx) => {
          const el = root as HTMLElement
          const rawRole = (el.getAttribute('data-message-author-role') || '').toLowerCase()
          let role: TurnRole = 'assistant'
          if (rawRole === 'user') role = 'user'
          else if (rawRole === 'system') role = 'system'
          else if (rawRole === 'tool') role = 'tool'

          const blocks = extractBlocksFromElement(el)
          if (blocks.length > 0) {
            turns.push({
              id: el.getAttribute('data-message-id') || `gpt-${idx + 1}`,
              sourceRole: role,
              roleEvidence: `data-message-author-role="${rawRole}"`,
              blocks,
              status: 'complete'
            })
          }
        })
      }

      // 3. Claude (claude.ai)
      if (turns.length === 0 && matchesDomain('claude.ai')) {
        adapterId = 'claude'
        const claudeRoots = document.querySelectorAll('.font-user-message, .font-claude-message, [data-testid="user-message"]')
        claudeRoots.forEach((root, idx) => {
          const el = root as HTMLElement
          const isUser = el.className.includes('user') || el.getAttribute('data-testid') === 'user-message'
          const role: TurnRole = isUser ? 'user' : 'assistant'

          const blocks = extractBlocksFromElement(el)
          if (blocks.length > 0) {
            turns.push({
              id: `claude-${idx + 1}`,
              sourceRole: role,
              roleEvidence: isUser ? 'user-message' : 'claude-message',
              blocks,
              status: 'complete'
            })
          }
        })
      }

      // 4. Gemini (gemini.google.com)
      if (turns.length === 0 && (matchesDomain('google.com') && url.includes('gemini'))) {
        adapterId = 'gemini'
        // Match user-query and model-response, avoiding nested duplicates
        const geminiRoots = document.querySelectorAll('user-query, model-response')
        geminiRoots.forEach((root, idx) => {
          const el = root as HTMLElement
          const tagName = el.tagName.toLowerCase()
          const role: TurnRole = tagName === 'user-query' ? 'user' : 'assistant'

          const blocks = extractBlocksFromElement(el)
          if (blocks.length > 0) {
            turns.push({
              id: `gemini-${idx + 1}`,
              sourceRole: role,
              roleEvidence: tagName,
              blocks,
              status: 'complete'
            })
          }
        })
      }

      // 5. DeepSeek (deepseek.com)
      if (turns.length === 0 && matchesDomain('deepseek.com')) {
        adapterId = 'deepseek'
        const dsRoots = document.querySelectorAll('div[class*="ds-message"]')
        dsRoots.forEach((root, idx) => {
          const el = root as HTMLElement
          const isUser = el.className.includes('user')
          const role: TurnRole = isUser ? 'user' : 'assistant'

          const blocks = extractBlocksFromElement(el)
          if (blocks.length > 0) {
            turns.push({
              id: `ds-${idx + 1}`,
              sourceRole: role,
              roleEvidence: el.className,
              blocks,
              status: 'complete'
            })
          }
        })
      }

      // 6. Universal Fallback
      if (turns.length === 0) {
        adapterId = 'universal-fallback'
        const container =
          document.querySelector('main') ||
          document.querySelector('[role="main"]') ||
          document.getElementById('main') ||
          document.body

        if (container) {
          // Exclude sidebars, workspaces, headers, footers, composers
          const bubbles = container.querySelectorAll(
            '[class*="message"], [class*="bubble"], [class*="chat-row"], [class*="turn"], [data-role]'
          )

          // Filter out elements that are inside composer, aside, or nested inside another matched bubble
          const validBubbles: HTMLElement[] = []
          bubbles.forEach((b) => {
            const el = b as HTMLElement
            if (
              el.closest('aside, nav, footer, header, .composer, [contenteditable="true"], [data-workspace]')
            ) {
              return
            }
            validBubbles.push(el)
          })

          if (validBubbles.length >= 2) {
            completeness = 'partial'
            warnings.push('Universal fallback used: turns detected via generic bubble patterns.')
            validBubbles.forEach((b, idx) => {
              const isUser = (b.className || '').toLowerCase().includes('user') || b.getAttribute('data-role') === 'user'
              const role: TurnRole = isUser ? 'user' : 'assistant'
              const blocks = extractBlocksFromElement(b)
              if (blocks.length > 0) {
                turns.push({
                  id: `fallback-${idx + 1}`,
                  sourceRole: role,
                  roleEvidence: isUser ? 'class-user' : 'class-assistant',
                  blocks,
                  status: 'complete'
                })
              }
            })
          }

          // If STILL no turns found:
          // CRITICAL: DO NOT assign whole container as Assistant! Mark role as 'unknown' and partial!
          if (turns.length === 0) {
            const rawProse = cleanProseNode(container as HTMLElement)
            if (rawProse && rawProse.length > 20) {
              completeness = 'partial'
              warnings.push('No individual turn bubbles detected; extracted raw container content with unknown role.')
              turns.push({
                id: 'fallback-whole-container',
                sourceRole: 'unknown',
                roleEvidence: 'container-text',
                blocks: [{ type: 'text', text: rawProse }],
                status: 'complete'
              })
            }
          }
        }
      }

      return {
        success: true,
        adapterId,
        adapterVersion: 1,
        completeness,
        scope: 'mounted-transcript',
        streaming: 'no',
        warnings,
        turns
      }
    } catch (e: any) {
      return {
        success: false,
        error: e.message || String(e),
        adapterId: 'error',
        adapterVersion: 1,
        completeness: 'unknown',
        scope: 'mounted-transcript',
        streaming: 'no',
        warnings: [e.message || String(e)],
        turns: []
      }
    }
  }

  return `(${code.toString()})()`
}

/**
 * Transforms raw browser extraction payload into a canonical typed ConversationSnapshot.
 */
export function buildSnapshotFromRawPayload(params: {
  payload: RawExtractionPayload
  tabId: string
  providerKey: string
  origin: string
  title?: string
  contextRevision: string
}): ConversationSnapshot {
  const { payload, tabId, providerKey, origin, title, contextRevision } = params

  const snapshotId = `snap-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 6)}`
  const capturedAt = new Date().toISOString()

  let rawChars = 0
  let codeBlockCount = 0

  const turns: ConversationTurn[] = payload.turns.map((rawTurn) => {
    const blocks: ContentBlock[] = rawTurn.blocks.map((rawBlock) => {
      if (rawBlock.type === 'code') {
        const text = rawBlock.text || ''
        rawChars += text.length
        codeBlockCount++
        return {
          type: 'code',
          language: rawBlock.language,
          text,
          contentHash: computeContentHash(text)
        }
      } else if (rawBlock.type === 'link') {
        rawChars += (rawBlock.label || '').length + (rawBlock.destination || '').length
        return {
          type: 'link',
          label: rawBlock.label || '',
          destination: rawBlock.destination
        }
      } else if (rawBlock.type === 'attachment') {
        rawChars += (rawBlock.name || '').length
        return {
          type: 'attachment',
          name: rawBlock.name || 'attachment',
          availability: rawBlock.availability || 'reference-only',
          path: rawBlock.path
        }
      } else if (rawBlock.type === 'tool-result') {
        const text = rawBlock.text || ''
        rawChars += text.length
        return {
          type: 'tool-result',
          text
        }
      } else if (rawBlock.type === 'thought') {
        const text = rawBlock.text || ''
        rawChars += text.length
        return {
          type: 'thought',
          text
        }
      } else {
        const text = rawBlock.text || ''
        rawChars += text.length
        return {
          type: 'text',
          text
        }
      }
    })

    return {
      id: rawTurn.id,
      sourceRole: rawTurn.sourceRole,
      roleEvidence: rawTurn.roleEvidence,
      blocks,
      status: rawTurn.status,
      timestamp: rawTurn.timestamp
    }
  })

  const artifacts = detectArtifactsFromTurns(turns)

  const userTurns = turns.filter((t) => t.sourceRole === 'user').length
  const assistantTurns = turns.filter((t) => t.sourceRole === 'assistant').length
  const toolTurns = turns.filter((t) => t.sourceRole === 'tool').length
  const systemTurns = turns.filter((t) => t.sourceRole === 'system').length
  const unknownTurns = turns.filter((t) => t.sourceRole === 'unknown').length

  return {
    schemaVersion: 1,
    snapshotId,
    capturedAt,
    source: {
      tabId,
      providerKey,
      origin,
      title,
      contextRevision,
      adapterId: payload.adapterId,
      adapterVersion: payload.adapterVersion
    },
    coverage: {
      scope: payload.scope,
      completeness: payload.completeness,
      streaming: payload.streaming,
      warnings: payload.warnings
    },
    turns,
    artifacts,
    stats: {
      rawChars,
      turnCount: turns.length,
      userTurns,
      assistantTurns,
      toolTurns,
      systemTurns,
      unknownTurns,
      codeBlockCount,
      artifactCount: artifacts.length
    }
  }
}
