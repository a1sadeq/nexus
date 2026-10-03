import React, { useState, useEffect, useRef, useMemo } from 'react'
import type { ModelDef } from '../App'
import { BrandIcon } from './BrandIcons'
import { modelColor } from '../lib/modelVisuals'
import { fzfMatch } from '../lib/fzf'
import { loadInterfaceSettings } from '../lib/interfaceSettings'
import { matchesShortcut, getShortcutKeys } from '../lib/shortcuts'

export interface UrlBarModalProps {
  isOpen: boolean
  currentUrl: string
  currentModel: string
  models: ModelDef[]
  onClose: () => void
  onNavigate: (url: string, detectedModel?: string, inNewTab?: boolean) => void
  onExecuteCommand?: (commandId: string) => void
}

const DOMAIN_MODEL_MAP: Record<string, string> = {
  'gemini.google.com': 'gemini',
  'chat.deepseek.com': 'deepseek',
  'deepseek.com': 'deepseek',
  'kimi.moonshot.cn': 'kimi',
  'kimi.ai': 'kimi',
  'chatgpt.com': 'chatgpt',
  'chat.openai.com': 'chatgpt',
  'openai.com': 'chatgpt',
  'claude.ai': 'claude',
  'perplexity.ai': 'perplexity',
  'www.perplexity.ai': 'perplexity',
  'chat.qwen.ai': 'qwen',
  'chat.qwenlm.ai': 'qwen',
  'qwen.ai': 'qwen',
  'grok.com': 'grok',
  'x.ai': 'grok',
  'mistral.ai': 'mistral',
  'chat.mistral.ai': 'mistral'
}

export function detectModelFromUrl(url: string): string | undefined {
  try {
    const full = url.includes('://') ? url : `https://${url}`
    const host = new URL(full).hostname.toLowerCase()
    for (const [domain, model] of Object.entries(DOMAIN_MODEL_MAP)) {
      if (host === domain || host.endsWith(`.${domain}`)) {
        return model
      }
    }
  } catch {
    // not a valid URL structure
  }
  return undefined
}

export function normalizeInputUrl(input: string): { url: string; detectedModel?: string } {
  const trimmed = input.trim()
  if (!trimmed) {
    return { url: 'https://www.perplexity.ai', detectedModel: 'perplexity' }
  }

  const isSearchQuery =
    trimmed.includes(' ') ||
    (!trimmed.includes('.') && !trimmed.includes('://') && !trimmed.startsWith('localhost'))

  if (isSearchQuery) {
    const searchUrl = `https://www.perplexity.ai/search?q=${encodeURIComponent(trimmed)}`
    return { url: searchUrl, detectedModel: 'perplexity' }
  }

  const finalUrl =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`

  const detectedModel = detectModelFromUrl(finalUrl)
  return { url: finalUrl, detectedModel }
}

interface OmniboxActionItem {
  kind: 'action'
  id: string
  title: string
  subtitle?: string
  url: string
  detectedModel?: string
  category: 'Actions'
}

interface OmniboxProviderItem {
  kind: 'provider'
  id: string
  title: string
  subtitle: string
  url: string
  detectedModel: string
  color: string
  category: 'AI Providers'
}

interface OmniboxCommandItem {
  kind: 'command'
  id: string
  title: string
  subtitle: string
  shortcut?: string
  category: 'System Commands'
}

type OmniboxItem = OmniboxActionItem | OmniboxProviderItem | OmniboxCommandItem

const SYSTEM_COMMANDS: Array<{ id: string; title: string; subtitle: string; shortcutId?: string; shortcut?: string }> = [
  { id: 'settings', title: 'Open Settings', subtitle: 'Manage themes, AI accounts & memory', shortcutId: 'settings-open' },
  { id: 'skills', title: 'SuperAntigravity Skills', subtitle: 'Execute specialist workflows and reasoning frameworks', shortcutId: 'skills-palette' },
  { id: 'history', title: 'Chat History', subtitle: 'Search and reopen previous chat conversations', shortcutId: 'history-open' },
  { id: 'new_tab', title: 'New Tab', subtitle: 'Open a fresh AI provider chat tab', shortcutId: 'tab-new' },
  { id: 'focus_mode', title: 'Toggle Focus Mode', subtitle: 'Hide header and sidebar for clean focus' },
  { id: 'reload', title: 'Reload Tab', subtitle: 'Refresh the active AI webview', shortcutId: 'model-reload' }
]

export default function UrlBarModal({
  isOpen,
  currentUrl,
  currentModel,
  models,
  onClose,
  onNavigate,
  onExecuteCommand
}: UrlBarModalProps) {
  const [inputVal, setInputVal] = useState(currentUrl)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      setInputVal(currentUrl)
      setSelectedIndex(0)
      // @ts-ignore
      window.electron?.ipcRenderer.send('claim_window_focus')
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.select()
        }
      }, 10)
    }
  }, [isOpen, currentUrl])

  // Build items list with live fuzzy matching
  const items = useMemo<OmniboxItem[]>(() => {
    const q = inputVal.trim()
    const result: OmniboxItem[] = []

    // 1. Actions based on query
    if (q) {
      const isUrlLike =
        q.includes('.') &&
        !q.includes(' ') &&
        (q.startsWith('http://') || q.startsWith('https://') || !q.includes('://'))

      if (isUrlLike) {
        const fullUrl = q.startsWith('http://') || q.startsWith('https://') ? q : `https://${q}`
        const detected = detectModelFromUrl(fullUrl)
        result.push({
          kind: 'action',
          id: 'action-direct-url',
          title: `Navigate to ${fullUrl}`,
          subtitle: detected ? `Detected AI: ${detected}` : 'Open website in active workspace',
          url: fullUrl,
          detectedModel: detected,
          category: 'Actions'
        })
      }

      const defaultEngine = loadInterfaceSettings().defaultSearchEngine

      const searchActions: OmniboxActionItem[] = [
        {
          kind: 'action',
          id: 'action-perplexity',
          title: `Search with Perplexity AI: "${q}"`,
          subtitle: 'Ask Perplexity AI with citations and web search',
          url: `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`,
          detectedModel: 'perplexity',
          category: 'Actions'
        },
        {
          kind: 'action',
          id: 'action-google',
          title: `Search Google: "${q}"`,
          subtitle: 'Search the web using Google Search',
          url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
          detectedModel: undefined,
          category: 'Actions'
        },
        {
          kind: 'action',
          id: 'action-duckduckgo',
          title: `Search DuckDuckGo: "${q}"`,
          subtitle: 'Search privately with DuckDuckGo',
          url: `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
          detectedModel: undefined,
          category: 'Actions'
        }
      ]

      // Place default engine at the top of search actions
      searchActions.sort((a, b) => {
        if (a.id === `action-${defaultEngine}`) return -1
        if (b.id === `action-${defaultEngine}`) return 1
        return 0
      })

      result.push(...searchActions)
    }

    // 2. AI Providers
    for (const m of models) {
      if (!q || fzfMatch(m.label || m.key, q) || fzfMatch(m.key, q) || fzfMatch(m.url, q)) {
        result.push({
          kind: 'provider',
          id: `provider-${m.key}`,
          title: m.label || m.key,
          subtitle: m.url,
          url: m.url,
          detectedModel: m.key,
          color: m.color || modelColor(m.key),
          category: 'AI Providers'
        })
      }
    }

    // 3. System Commands
    for (const cmd of SYSTEM_COMMANDS) {
      if (!q || fzfMatch(cmd.title, q) || fzfMatch(cmd.subtitle, q) || fzfMatch(cmd.id, q)) {
        result.push({
          kind: 'command',
          id: cmd.id,
          title: cmd.title,
          subtitle: cmd.subtitle,
          shortcut: cmd.shortcutId ? getShortcutKeys(cmd.shortcutId).join('+') : undefined,
          category: 'System Commands'
        })
      }
    }

    return result
  }, [inputVal, models])

  // Keep selected index within bounds
  useEffect(() => {
    setSelectedIndex((prev) => (items.length > 0 ? Math.min(prev, items.length - 1) : 0))
  }, [items.length])

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return
    const activeEl = listRef.current.querySelector<HTMLDivElement>(`[data-index="${selectedIndex}"]`)
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (!isOpen) return null

  const handleSelect = (item?: OmniboxItem, inNewTab = false) => {
    if (!item) {
      const { url, detectedModel } = normalizeInputUrl(inputVal)
      onNavigate(url, detectedModel, inNewTab)
      onClose()
      return
    }

    if (item.kind === 'action' || item.kind === 'provider') {
      onNavigate(item.url, item.detectedModel, inNewTab)
      onClose()
    } else if (item.kind === 'command') {
      if (onExecuteCommand) {
        onExecuteCommand(item.id)
      }
      onClose()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || matchesShortcut(e.nativeEvent, getShortcutKeys('url-bar'))) {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key.toLowerCase() === 'j')) {
      e.preventDefault()
      setSelectedIndex((i) => (items.length > 0 ? (i + 1) % items.length : 0))
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key.toLowerCase() === 'k')) {
      e.preventDefault()
      setSelectedIndex((i) => (items.length > 0 ? (i - 1 + items.length) % items.length : 0))
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const currentItem = items[selectedIndex]
      if (currentItem) {
        if (currentItem.kind === 'provider') {
          setInputVal(currentItem.url)
        } else if (currentItem.kind === 'action') {
          setInputVal(currentItem.url)
        } else {
          setSelectedIndex((i) => (items.length > 0 ? (i + 1) % items.length : 0))
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const inNewTab = e.altKey
      handleSelect(items[selectedIndex], inNewTab)
    }
  }

  const previewDetected = detectModelFromUrl(inputVal) || currentModel
  const currentModelDef = models.find((m) => m.key === previewDetected)
  const currentBadgeColor = currentModelDef?.color || modelColor(previewDetected)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/65 backdrop-blur-md cosmic-backdrop-fade"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-4 rounded-2xl border shadow-2xl overflow-hidden flex flex-col transition-all duration-200 cosmic-modal-pop"
        style={{
          background: 'var(--surface, #1e1e2e)',
          borderColor: 'var(--border, rgba(255, 255, 255, 0.12))',
          boxShadow: '0 25px 60px -10px rgba(0, 0, 0, 0.7)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSelect(items[selectedIndex], false)
          }}
          className="flex items-center gap-3 p-3.5 border-b"
          style={{ borderColor: 'var(--border, rgba(255, 255, 255, 0.08))' }}
        >
          <div
            className="flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 border transition-all"
            style={{
              background: 'var(--surface2, rgba(255, 255, 255, 0.06))',
              borderColor: 'var(--border, rgba(255, 255, 255, 0.1))',
              color: currentBadgeColor
            }}
          >
            <BrandIcon id={previewDetected} size={14} customSvg={currentModelDef?.icon} />
            <span className="capitalize">{currentModelDef?.label || previewDetected}</span>
          </div>

          <div className="flex-1 relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={inputVal}
              onChange={(e) => {
                setInputVal(e.target.value)
                setSelectedIndex(0)
              }}
              onKeyDown={handleKeyDown}
              placeholder="Type a URL, search query, or command..."
              className="w-full bg-transparent border-none outline-none font-mono text-sm px-1"
              style={{ color: 'var(--text, #f8fafc)' }}
            />
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-90 flex items-center gap-1.5 shadow-sm"
              style={{ background: 'var(--accent, #6366f1)', color: '#fff' }}
              title="Navigate active tab (Enter)"
            >
              Go
              <span className="opacity-70 font-mono text-[10px]">↵</span>
            </button>
          </div>
        </form>

        {/* Suggestion Dropdown List */}
        <div
          ref={listRef}
          className="max-h-72 overflow-y-auto p-2 flex flex-col gap-1 select-none custom-scrollbar"
        >
          {items.length === 0 ? (
            <div className="p-4 text-center text-xs opacity-60" style={{ color: 'var(--text2, #94a3b8)' }}>
              No matching actions or AI providers found
            </div>
          ) : (
            items.map((item, idx) => {
              const isSelected = idx === selectedIndex
              const provDef = item.kind === 'provider' ? models.find((m) => m.key === item.detectedModel) : undefined
              return (
                <div
                  key={item.id}
                  data-index={idx}
                  onClick={() => handleSelect(item, false)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl cursor-pointer transition-all text-xs"
                  style={{
                    background: isSelected ? 'var(--accent, #6366f1)' : 'transparent',
                    color: isSelected ? '#ffffff' : 'var(--text, #f8fafc)'
                  }}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {item.kind === 'provider' ? (
                      <span className="p-1 rounded-md shrink-0 flex items-center justify-center" style={{ color: isSelected ? '#fff' : item.color }}>
                        <BrandIcon id={item.detectedModel} size={15} customSvg={provDef?.icon} />
                      </span>
                    ) : item.kind === 'action' ? (
                      <span className="p-1 rounded-md shrink-0 opacity-80 flex items-center justify-center">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8" />
                          <path d="m21 21-4.35-4.35" />
                        </svg>
                      </span>
                    ) : (
                      <span className="p-1 rounded-md shrink-0 opacity-80 flex items-center justify-center">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                      </span>
                    )}

                    <div className="flex flex-col min-w-0">
                      <span className="font-medium truncate">{item.title}</span>
                      {item.subtitle && (
                        <span
                          className="text-[11px] truncate opacity-70"
                          style={{ color: isSelected ? 'rgba(255, 255, 255, 0.85)' : 'var(--text2, #94a3b8)' }}
                        >
                          {item.subtitle}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 text-[10px]">
                    {item.kind === 'command' && item.shortcut && (
                      <kbd
                        className="px-1.5 py-0.5 rounded font-mono border"
                        style={{
                          background: isSelected ? 'rgba(255, 255, 255, 0.2)' : 'var(--surface2, rgba(255, 255, 255, 0.08))',
                          borderColor: isSelected ? 'rgba(255, 255, 255, 0.3)' : 'var(--border, rgba(255, 255, 255, 0.1))'
                        }}
                      >
                        {item.shortcut}
                      </kbd>
                    )}
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold opacity-60"
                      style={{
                        background: isSelected ? 'rgba(255, 255, 255, 0.15)' : 'var(--surface2, rgba(255, 255, 255, 0.05))'
                      }}
                    >
                      {item.category}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer Shortcut Hints */}
        <div
          className="flex items-center justify-between px-4 py-2 border-t text-[11px] opacity-75"
          style={{
            background: 'var(--surface2, rgba(0, 0, 0, 0.2))',
            borderColor: 'var(--border, rgba(255, 255, 255, 0.08))',
            color: 'var(--text2, #94a3b8)'
          }}
        >
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono text-[10px]">↑↓</kbd> or{' '}
              <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono text-[10px]">Ctrl+J/K</kbd> Navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono text-[10px]">↵</kbd> Open in tab
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono text-[10px]">Alt+↵</kbd> Open in new tab
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono text-[10px]">Tab</kbd> Autocomplete
            </span>
          </div>
          <span className="font-mono">ESC to cancel</span>
        </div>
      </div>
    </div>
  )
}
