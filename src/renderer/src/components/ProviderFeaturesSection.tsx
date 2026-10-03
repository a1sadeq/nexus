import React, { useState } from 'react'
import {
  BrandIcon,
  IconSliders,
  IconSparkles,
  IconSearch,
  IconZap,
  IconRotate,
  IconMonitor,
  IconLayers,
  IconKeyboard,
  IconTerminal,
  IconFolder,
  IconCopy,
  IconCheck,
  IconDownload,
  IconX
} from './BrandIcons'
import { modelColor, modelLabel } from '../lib/modelVisuals'
import type { ModelDef } from '../App'
import {
  type ProviderConfigMap,
  type ProviderFeatureConfig,
  getMergedProviderFeatures
} from '../../../shared/providerConfig'
import { generateFeatureHooksPrompt } from '../lib/promptGenerator'

interface Props {
  models: ModelDef[]
  providerConfig: ProviderConfigMap
  setProviderConfig: (updater: (prev: ProviderConfigMap) => ProviderConfigMap) => void
  setToast?: (msg: string | null) => void
}

export const ProviderFeaturesSection: React.FC<Props> = ({
  models,
  providerConfig,
  setProviderConfig,
  setToast
}) => {
  const [selectedKey, setSelectedKey] = useState<string>(() => models[0]?.key ?? 'chatgpt')
  const [searchQuery, setSearchQuery] = useState('')
  const [newTitleInput, setNewTitleInput] = useState('')

  // AI Prompt & Import Modals
  const [showPromptModal, setShowPromptModal] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState(false)

  const [showImportModal, setShowImportModal] = useState(false)
  const [importJsonText, setImportJsonText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)

  const activeModel = models.find((m) => m.key === selectedKey)
  const currentOverrides = providerConfig[selectedKey] || {}
  const mergedFeatures = getMergedProviderFeatures(selectedKey, currentOverrides)
  const userFeatures = currentOverrides.features || {}

  const hasCustomFeatures = Boolean(currentOverrides.features && Object.keys(currentOverrides.features).length > 0)

  const updateFeatureField = <K extends keyof ProviderFeatureConfig>(
    field: K,
    val: ProviderFeatureConfig[K]
  ) => {
    setProviderConfig((prev) => {
      const cur = prev[selectedKey] || {}
      const nextFeats: ProviderFeatureConfig = {
        ...(cur.features || {}),
        [field]: val
      }
      return {
        ...prev,
        [selectedKey]: {
          ...cur,
          features: nextFeats
        }
      }
    })
  }

  const resetFeaturesToDefaults = () => {
    setProviderConfig((prev) => {
      const cur = prev[selectedKey] || {}
      const next = { ...cur }
      delete next.features
      return {
        ...prev,
        [selectedKey]: next
      }
    })
    if (setToast) {
      setToast(`✓ Reset ${modelLabel(selectedKey)} features to built-in defaults`)
      setTimeout(() => setToast(null), 3000)
    }
  }

  const handleAutoDetectFromLiveWebview = async () => {
    try {
      // @ts-ignore
      const res = await window.electron?.ipcRenderer?.invoke(
        'extract_provider_live_dom',
        selectedKey,
        activeModel?.url
      )

      if (!res || !res.success || !res.html) {
        if (setToast) {
          setToast(`⚠️ Please open a tab for ${modelLabel(selectedKey)} first to auto-detect selectors!`)
          setTimeout(() => setToast(null), 4000)
        }
        return
      }

      const html = res.html as string
      const detected: Partial<ProviderFeatureConfig> = {}

      // Heuristic detection based on extracted live HTML classes
      if (html.includes('input type="file"') || html.includes('type="file"')) {
        detected.attachmentSelector = 'input[type="file"]'
      } else if (html.includes('aria-label="Attach') || html.includes('aria-label=\"Attach') || html.includes('aria-label="Upload') || html.includes('aria-label=\"Upload')) {
        detected.attachmentSelector = 'button[aria-label*="Attach"], button[aria-label*="Upload"]'
      } else if (html.includes('data-testid="attach') || html.includes('data-testid="upload')) {
        detected.attachmentSelector = '[data-testid*="attach"], [data-testid*="upload"]'
      }

      if (html.includes('data-message-author-role="user"')) {
        detected.promptNavSelector = '[data-message-author-role="user"]'
      } else if (html.includes('data-testid="user-message"')) {
        detected.promptNavSelector = '[data-testid="user-message"]'
      } else if (html.includes('class="') && html.includes('user-query')) {
        detected.promptNavSelector = '[class*="user-query"]'
      } else if (html.includes('class="') && html.includes('user-message')) {
        detected.promptNavSelector = '[class*="user-message"]'
      }

      if (html.includes('id="prompt-textarea"')) {
        detected.composerSelector = '#prompt-textarea'
      } else if (html.includes('class="ProseMirror"') || html.includes('ProseMirror')) {
        detected.composerSelector = '.ProseMirror, [contenteditable="true"]'
      } else if (html.includes('rich-textarea')) {
        detected.composerSelector = 'rich-textarea [contenteditable="true"]'
      } else if (html.includes('textarea')) {
        detected.composerSelector = 'textarea:not([disabled])'
      }

      if (html.includes('data-testid="send-button"')) {
        detected.sendButtonSelector = 'button[data-testid="send-button"]'
      } else if (html.includes('aria-label="Send') || html.includes('aria-label=\"Send')) {
        detected.sendButtonSelector = 'button[aria-label*="Send"]'
      } else if (html.includes('type="submit"')) {
        detected.sendButtonSelector = 'button[type="submit"]'
      }

      // Update state
      setProviderConfig((prev) => {
        const cur = prev[selectedKey] || {}
        return {
          ...prev,
          [selectedKey]: {
            ...cur,
            features: {
              ...(cur.features || {}),
              ...detected
            }
          }
        }
      })

      if (setToast) {
        setToast(`✨ Auto-detected and configured live DOM hooks for ${modelLabel(selectedKey)}!`)
        setTimeout(() => setToast(null), 4000)
      }
    } catch (err) {
      console.error('Auto-detect error:', err)
      if (setToast) {
        setToast('Failed to auto-detect selectors')
        setTimeout(() => setToast(null), 3000)
      }
    }
  }

  const handleGenerateAiPrompt = async () => {
    setIsGeneratingPrompt(true)
    try {
      let extractedHtml = ''
      try {
        // @ts-ignore
        const res = await window.electron?.ipcRenderer?.invoke(
          'extract_provider_live_dom',
          selectedKey,
          activeModel?.url
        )
        if (res && res.success && res.html) {
          extractedHtml = res.html
        }
      } catch (e) {
        console.warn('Failed to extract live dom for prompt generation:', e)
      }

      const generated = generateFeatureHooksPrompt({
        providerName: activeModel?.label || modelLabel(selectedKey),
        providerUrl: activeModel?.url,
        currentFeatures: mergedFeatures,
        liveDomHtml: extractedHtml || undefined
      })

      setPromptText(generated)
      setShowPromptModal(true)

      // Auto-copy to clipboard
      try {
        await navigator.clipboard.writeText(generated)
        setCopiedPrompt(true)
        setTimeout(() => setCopiedPrompt(false), 2500)
        if (setToast) {
          setToast(`📋 Copied AI reverse-engineering prompt for ${modelLabel(selectedKey)} to clipboard!`)
          setTimeout(() => setToast(null), 3500)
        }
      } catch {
        // Clipboard write failed or blocked, modal is still open
      }
    } catch (err) {
      console.error('Error generating AI prompt:', err)
      if (setToast) {
        setToast('Failed to generate AI prompt')
        setTimeout(() => setToast(null), 3000)
      }
    } finally {
      setIsGeneratingPrompt(false)
    }
  }

  const handleApplyAiJson = () => {
    try {
      setImportError(null)
      let raw = importJsonText.trim()
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      if (jsonMatch && jsonMatch[1]) {
        raw = jsonMatch[1].trim()
      }
      const parsed = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Imported content must be a JSON object')
      }

      const validKeys: (keyof ProviderFeatureConfig)[] = [
        'attachmentSelector',
        'promptNavSelector',
        'composerSelector',
        'sendButtonSelector',
        'chatTitleSelector',
        'newChatSelector',
        'stopGenerationSelector',
        'virtualizationSelector',
        'enableSlashFocus',
        'enableFocusRetention',
        'autoSubmitSkillPrompt',
        'customInitScript',
        'defaultChatTitles'
      ]

      const nextUpdates: Partial<ProviderFeatureConfig> = {}
      for (const key of validKeys) {
        if (key in parsed && parsed[key] !== undefined) {
          // @ts-ignore
          nextUpdates[key] = parsed[key]
        }
      }

      if (Object.keys(nextUpdates).length === 0) {
        throw new Error('No recognized feature selectors found in JSON')
      }

      setProviderConfig((prev) => {
        const cur = prev[selectedKey] || {}
        return {
          ...prev,
          [selectedKey]: {
            ...cur,
            features: {
              ...(cur.features || {}),
              ...nextUpdates
            }
          }
        }
      })

      setShowImportModal(false)
      setImportJsonText('')
      if (setToast) {
        setToast(`✨ Successfully imported AI selectors for ${modelLabel(selectedKey)}!`)
        setTimeout(() => setToast(null), 3500)
      }
    } catch (e: any) {
      setImportError(e?.message || 'Invalid JSON format')
    }
  }

  const addNoiseTitle = () => {
    if (!newTitleInput.trim()) return
    const current = mergedFeatures.defaultChatTitles || []
    if (!current.includes(newTitleInput.trim())) {
      updateFeatureField('defaultChatTitles', [...current, newTitleInput.trim()])
    }
    setNewTitleInput('')
  }

  const removeNoiseTitle = (titleToRemove: string) => {
    const current = mergedFeatures.defaultChatTitles || []
    updateFeatureField(
      'defaultChatTitles',
      current.filter((t) => t !== titleToRemove)
    )
  }

  const filteredModels = models.filter((m) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase().trim()
    return m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q)
  })

  return (
    <div className="flex-1 min-h-0 flex flex-row gap-4 p-4 overflow-hidden" style={{ color: 'var(--text)' }}>
      {/* LEFT COLUMN: Provider Selector Sidebar */}
      <div
        className="w-[280px] shrink-0 min-h-0 flex flex-col gap-3 rounded-2xl border p-3.5 shadow-lg overflow-hidden"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between shrink-0 pb-1 border-b border-white/5">
          <div className="flex items-center gap-2">
            <IconSliders size={16} style={{ color: 'var(--accent)' }} />
            <span className="text-xs font-bold uppercase tracking-wider text-(--text)">AI Integrations</span>
          </div>
          <span className="text-[10px] font-mono text-(--text2)">{models.length} Providers</span>
        </div>

        {/* Search filter */}
        <div className="relative shrink-0">
          <IconSearch size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--text2)" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search provider..."
            className="w-full pl-7 pr-2.5 py-1.5 rounded-lg text-xs bg-black/40 border border-white/10 text-gray-200 placeholder:text-gray-500 focus:border-amber-400 focus:outline-none"
          />
        </div>

        {/* Provider List */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col gap-1.5 pr-1">
          {filteredModels.map((m) => {
            const isSel = m.key === selectedKey
            const hasCustom = Boolean(providerConfig[m.key]?.features && Object.keys(providerConfig[m.key]?.features || {}).length > 0)
            const brandCol = modelColor(m.key)

            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setSelectedKey(m.key)}
                className={`flex items-center justify-between p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  isSel
                    ? 'border-indigo-500/60 bg-indigo-500/15 shadow-md'
                    : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/10'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border border-white/10"
                    style={{ background: brandCol + '20', color: brandCol }}
                  >
                    <BrandIcon id={m.key} customSvg={m.icon} size={16} />
                  </div>
                  <div className="min-w-0 flex flex-col">
                    <span className="text-xs font-semibold text-(--text) truncate">{m.label}</span>
                    <span className="text-[10px] font-mono text-(--text2) truncate">{m.url || 'custom'}</span>
                  </div>
                </div>

                {hasCustom ? (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                    Custom
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono text-(--text2) bg-white/5 shrink-0">
                    Default
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Quick Sidebar Actions */}
        <div className="shrink-0 flex flex-col gap-1.5 pt-2 border-t border-white/5">
          <button
            type="button"
            onClick={handleGenerateAiPrompt}
            disabled={isGeneratingPrompt}
            className="w-full py-2 px-3 rounded-xl text-xs font-bold border border-amber-500/40 text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
            title="Extracts live webview DOM and builds a ready-to-copy AI reverse engineering prompt"
          >
            <IconSparkles size={13} />
            <span>{isGeneratingPrompt ? 'Generating Prompt...' : 'Generate AI Prompt'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setImportError(null)
              setShowImportModal(true)
            }}
            className="w-full py-1.5 px-3 rounded-xl text-xs font-semibold border border-emerald-500/30 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
            title="Import selectors from AI JSON response"
          >
            <IconDownload size={12} />
            <span>Import AI JSON</span>
          </button>

          <button
            type="button"
            onClick={handleAutoDetectFromLiveWebview}
            className="w-full py-1.5 px-3 rounded-xl text-[11px] font-medium border border-indigo-500/30 text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
            title="Inspects the live open tab and auto-fills selectors"
          >
            <IconZap size={12} />
            <span>Quick Auto-Detect</span>
          </button>

          {hasCustomFeatures && (
            <button
              type="button"
              onClick={resetFeaturesToDefaults}
              className="w-full py-1.5 px-3 rounded-xl text-[11px] font-medium border border-white/10 text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
            >
              <IconRotate size={12} />
              <span>Reset to Defaults</span>
            </button>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: Feature Settings Studio Canvas */}
      <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">
        {/* Active Provider Header Banner */}
        <div
          className="shrink-0 flex items-center justify-between p-3.5 rounded-2xl border shadow-sm"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/10"
              style={{ background: modelColor(selectedKey) + '25', color: modelColor(selectedKey) }}
            >
              <BrandIcon id={selectedKey} customSvg={activeModel?.icon} size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-(--text)">{modelLabel(selectedKey)} Feature Hooks & DOM Selectors</h3>
                {hasCustomFeatures && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Custom Overrides Active
                  </span>
                )}
              </div>
              <p className="text-[11px] text-(--text2)">
                Configure keyboard navigation, chat title sync, prompt focusing, and DOM automation for this provider.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGenerateAiPrompt}
              disabled={isGeneratingPrompt}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-amber-500/40 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
              title="Extracts live webview DOM and builds a ready-to-copy AI reverse engineering prompt"
            >
              <IconSparkles size={13} />
              <span>{isGeneratingPrompt ? 'Extracting DOM...' : 'Generate AI Prompt'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setImportError(null)
                setShowImportModal(true)
              }}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-emerald-500/40 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors cursor-pointer flex items-center gap-1.5"
              title="Paste AI JSON response to automatically set all selectors"
            >
              <IconDownload size={13} />
              <span>Import AI JSON</span>
            </button>

            <button
              type="button"
              onClick={handleAutoDetectFromLiveWebview}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-indigo-500/30 text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors cursor-pointer flex items-center gap-1.5"
              title="Fast heuristic DOM scan from currently active tab"
            >
              <IconZap size={13} />
              <span>Quick Scan</span>
            </button>
          </div>
        </div>

        {/* FEATURE CARDS GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* CARD: File & Folder Upload Automation (Ctrl+O / Ctrl+Shift+O) */}
          <div className="p-3.5 rounded-2xl border flex flex-col gap-2.5 shadow-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between pb-1 border-b border-white/5">
              <div className="flex items-center gap-2">
                <IconFolder size={15} className="text-amber-400" />
                <span className="text-xs font-bold text-(--text)">File & Folder Upload Automation</span>
              </div>
              <span className="text-[10px] font-mono text-(--text2)">CDP Injector</span>
            </div>
            <p className="text-[11px] text-(--text2) leading-relaxed">
              DOM selector targeting the file input or attach button. Powers native single-file (<kbd className="px-1 rounded bg-white/10 text-white font-mono text-[10px]">Ctrl+O</kbd>) and smart folder reviews (<kbd className="px-1 rounded bg-white/10 text-white font-mono text-[10px]">Ctrl+Shift+O</kbd>) via CDP.
            </p>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-(--text2)">File Input / Attach Trigger Selector:</label>
              <input
                type="text"
                value={userFeatures.attachmentSelector ?? mergedFeatures.attachmentSelector ?? ''}
                onChange={(e) => updateFeatureField('attachmentSelector', e.target.value)}
                placeholder='e.g. input[type="file"], button[aria-label*="Attach"], [data-testid*="upload"]'
                className="w-full p-2 rounded-lg text-xs font-mono bg-black/50 border border-white/10 text-gray-200 focus:border-amber-400 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1 items-center pt-1">
              <span className="text-[10px] text-(--text2)">Chips:</span>
              {[
                'input[type="file"]',
                'button[aria-label*="Attach"]',
                'button[aria-label*="Upload"]',
                '[data-testid*="attach"]',
                'input[type="file"][multiple]'
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => updateFeatureField('attachmentSelector', chip)}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/5 hover:bg-white/10 text-amber-300 border border-white/5 cursor-pointer"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* CARD 1: Alt+J/K Prompt Navigation */}
          <div className="p-3.5 rounded-2xl border flex flex-col gap-2.5 shadow-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between pb-1 border-b border-white/5">
              <div className="flex items-center gap-2">
                <IconKeyboard size={15} className="text-indigo-400" />
                <span className="text-xs font-bold text-(--text)">Alt+J / Alt+K Prompt Navigation</span>
              </div>
              <span className="text-[10px] font-mono text-(--text2)">Message Hopping</span>
            </div>
            <p className="text-[11px] text-(--text2) leading-relaxed">
              CSS selector that identifies user query turns. Pressing <kbd className="px-1 rounded bg-white/10 text-white font-mono text-[10px]">Alt+K</kbd> jumps backward to older user prompts; <kbd className="px-1 rounded bg-white/10 text-white font-mono text-[10px]">Alt+J</kbd> jumps forward.
            </p>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-(--text2)">User Query DOM Selector:</label>
              <input
                type="text"
                value={userFeatures.promptNavSelector ?? mergedFeatures.promptNavSelector ?? ''}
                onChange={(e) => updateFeatureField('promptNavSelector', e.target.value)}
                placeholder='e.g. [data-message-author-role="user"], .user-query'
                className="w-full p-2 rounded-lg text-xs font-mono bg-black/50 border border-white/10 text-gray-200 focus:border-indigo-400 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1 items-center pt-1">
              <span className="text-[10px] text-(--text2)">Chips:</span>
              {[
                '[data-message-author-role="user"]',
                '[data-testid="user-message"]',
                '.user-query',
                '.segment-user',
                '.font-user-message'
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => updateFeatureField('promptNavSelector', chip)}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/5 hover:bg-white/10 text-indigo-300 border border-white/5 cursor-pointer"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* CARD 2: Chat Title Extractor & Noise Filter */}
          <div className="p-3.5 rounded-2xl border flex flex-col gap-2.5 shadow-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between pb-1 border-b border-white/5">
              <div className="flex items-center gap-2">
                <IconZap size={15} className="text-amber-400" />
                <span className="text-xs font-bold text-(--text)">Chat Title Extractor & Tab Sync</span>
              </div>
              <span className="text-[10px] font-mono text-(--text2)">Tab Indicator</span>
            </div>
            <p className="text-[11px] text-(--text2) leading-relaxed">
              DOM selector used to extract the active conversation title from the webview and sync it to Nexus tab headers.
            </p>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-(--text2)">Active Chat Title Selector:</label>
              <input
                type="text"
                value={userFeatures.chatTitleSelector ?? mergedFeatures.chatTitleSelector ?? ''}
                onChange={(e) => updateFeatureField('chatTitleSelector', e.target.value)}
                placeholder='e.g. nav a[class*="active"], header h1, [data-testid="chat-title"]'
                className="w-full p-2 rounded-lg text-xs font-mono bg-black/50 border border-white/10 text-gray-200 focus:border-amber-400 focus:outline-none"
              />
            </div>

            {/* Noise Title Filtering */}
            <div className="flex flex-col gap-1.5 pt-1">
              <label className="text-[11px] font-semibold text-(--text2)">Ignored Generic Titles (Noise Filter):</label>
              <div className="flex flex-wrap gap-1 p-2 rounded-lg bg-black/40 border border-white/10 min-h-[36px]">
                {(mergedFeatures.defaultChatTitles || []).map((title) => (
                  <span
                    key={title}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30"
                  >
                    <span>{title}</span>
                    <button
                      type="button"
                      onClick={() => removeNoiseTitle(title)}
                      className="hover:text-red-400 cursor-pointer font-bold ml-0.5"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newTitleInput}
                  onChange={(e) => setNewTitleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addNoiseTitle()
                    }
                  }}
                  placeholder="Add generic title to ignore (e.g. 'New Chat')..."
                  className="flex-1 p-1.5 rounded-lg text-xs bg-black/50 border border-white/10 text-gray-200 focus:border-amber-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={addNoiseTitle}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/15 text-white border border-white/10 cursor-pointer"
                >
                  + Add
                </button>
              </div>
            </div>
          </div>

          {/* CARD 3: Prompt Composer & Slash Focus */}
          <div className="p-3.5 rounded-2xl border flex flex-col gap-2.5 shadow-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between pb-1 border-b border-white/5">
              <div className="flex items-center gap-2">
                <IconTerminal size={15} className="text-emerald-400" />
                <span className="text-xs font-bold text-(--text)">Composer Input & Slash Focus (/)</span>
              </div>
              <span className="text-[10px] font-mono text-(--text2)">Focus Engine</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-(--text2)">Textarea / Composer DOM Selector:</label>
              <input
                type="text"
                value={userFeatures.composerSelector ?? mergedFeatures.composerSelector ?? ''}
                onChange={(e) => updateFeatureField('composerSelector', e.target.value)}
                placeholder='e.g. #prompt-textarea, .ProseMirror, textarea'
                className="w-full p-2 rounded-lg text-xs font-mono bg-black/50 border border-white/10 text-gray-200 focus:border-emerald-400 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <div>
                <span className="text-xs font-semibold text-(--text)">Enable Slash Focus (/)</span>
                <p className="text-[10px] text-(--text2)">Pressing / anywhere focuses the prompt composer</p>
              </div>
              <input
                type="checkbox"
                checked={mergedFeatures.enableSlashFocus !== false}
                onChange={(e) => updateFeatureField('enableSlashFocus', e.target.checked)}
                className="w-4 h-4 rounded cursor-pointer accent-emerald-500"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <div>
                <span className="text-xs font-semibold text-(--text)">Caret & Focus Retention</span>
                <p className="text-[10px] text-(--text2)">Preserve cursor position across window switches</p>
              </div>
              <input
                type="checkbox"
                checked={mergedFeatures.enableFocusRetention !== false}
                onChange={(e) => updateFeatureField('enableFocusRetention', e.target.checked)}
                className="w-4 h-4 rounded cursor-pointer accent-emerald-500"
              />
            </div>
          </div>

          {/* CARD 4: Send Button & Skill Prompt Submission */}
          <div className="p-3.5 rounded-2xl border flex flex-col gap-2.5 shadow-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between pb-1 border-b border-white/5">
              <div className="flex items-center gap-2">
                <IconZap size={15} className="text-cyan-400" />
                <span className="text-xs font-bold text-(--text)">Send Button & Skill Auto-Submit</span>
              </div>
              <span className="text-[10px] font-mono text-(--text2)">Automation</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-(--text2)">Send Button DOM Selector:</label>
              <input
                type="text"
                value={userFeatures.sendButtonSelector ?? mergedFeatures.sendButtonSelector ?? ''}
                onChange={(e) => updateFeatureField('sendButtonSelector', e.target.value)}
                placeholder='e.g. button[data-testid="send-button"], button[type="submit"]'
                className="w-full p-2 rounded-lg text-xs font-mono bg-black/50 border border-white/10 text-gray-200 focus:border-cyan-400 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <div>
                <span className="text-xs font-semibold text-(--text)">Auto-Submit Skill Injections</span>
                <p className="text-[10px] text-(--text2)">Click send button immediately after injecting skill template</p>
              </div>
              <input
                type="checkbox"
                checked={mergedFeatures.autoSubmitSkillPrompt !== false}
                onChange={(e) => updateFeatureField('autoSubmitSkillPrompt', e.target.checked)}
                className="w-4 h-4 rounded cursor-pointer accent-cyan-500"
              />
            </div>
          </div>

          {/* CARD 5: New Chat & Stop Generation */}
          <div className="p-3.5 rounded-2xl border flex flex-col gap-2.5 shadow-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between pb-1 border-b border-white/5">
              <div className="flex items-center gap-2">
                <IconLayers size={15} className="text-purple-400" />
                <span className="text-xs font-bold text-(--text)">New Chat & Stop Actions</span>
              </div>
              <span className="text-[10px] font-mono text-(--text2)">Session Control</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-(--text2)">New Chat Button Selector:</label>
              <input
                type="text"
                value={userFeatures.newChatSelector ?? mergedFeatures.newChatSelector ?? ''}
                onChange={(e) => updateFeatureField('newChatSelector', e.target.value)}
                placeholder='e.g. a[href="/"], button[aria-label*="New chat"]'
                className="w-full p-2 rounded-lg text-xs font-mono bg-black/50 border border-white/10 text-gray-200 focus:border-purple-400 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-(--text2)">Stop Generation Button Selector:</label>
              <input
                type="text"
                value={userFeatures.stopGenerationSelector ?? mergedFeatures.stopGenerationSelector ?? ''}
                onChange={(e) => updateFeatureField('stopGenerationSelector', e.target.value)}
                placeholder='e.g. button[aria-label*="Stop"], button.stop-btn'
                className="w-full p-2 rounded-lg text-xs font-mono bg-black/50 border border-white/10 text-gray-200 focus:border-purple-400 focus:outline-none"
              />
            </div>
          </div>

          {/* CARD 6: Memory Virtualization */}
          <div className="p-3.5 rounded-2xl border flex flex-col gap-2.5 shadow-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between pb-1 border-b border-white/5">
              <div className="flex items-center gap-2">
                <IconMonitor size={15} className="text-blue-400" />
                <span className="text-xs font-bold text-(--text)">Memory Virtualization & DOM Pruning</span>
              </div>
              <span className="text-[10px] font-mono text-(--text2)">RAM Optimizer</span>
            </div>
            <p className="text-[11px] text-(--text2) leading-relaxed">
              Applies CSS `content-visibility: auto` to off-screen messages to keep memory consumption low during long conversations.
            </p>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-(--text2)">Off-Screen Chat Messages Selector:</label>
              <input
                type="text"
                value={userFeatures.virtualizationSelector ?? mergedFeatures.virtualizationSelector ?? ''}
                onChange={(e) => updateFeatureField('virtualizationSelector', e.target.value)}
                placeholder='e.g. [class*="user"], [class*="assistant"], .segment'
                className="w-full p-2 rounded-lg text-xs font-mono bg-black/50 border border-white/10 text-gray-200 focus:border-blue-400 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* CARD 7: Custom Injected JavaScript (Full Width) */}
        <div className="p-3.5 rounded-2xl border flex flex-col gap-2.5 shadow-sm shrink-0" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between pb-1 border-b border-white/5">
            <div className="flex items-center gap-2">
              <IconTerminal size={15} className="text-rose-400" />
              <span className="text-xs font-bold text-(--text)">Custom Injected JavaScript / User Scripts</span>
            </div>
            <span className="text-[10px] font-mono text-(--text2)">DOM Ready Script</span>
          </div>
          <p className="text-[11px] text-(--text2)">
            Execute custom JavaScript inside the webview whenever ${modelLabel(selectedKey)} finishes loading.
          </p>
          <textarea
            value={userFeatures.customInitScript ?? ''}
            onChange={(e) => updateFeatureField('customInitScript', e.target.value)}
            placeholder={`// Custom JavaScript for ${modelLabel(selectedKey)}\n// console.log("Custom script loaded");`}
            rows={4}
            className="w-full p-3 rounded-lg text-xs font-mono bg-black/60 border border-white/10 text-gray-200 focus:border-rose-400 focus:outline-none custom-scrollbar"
            spellCheck={false}
          />
        </div>
      </div>

      {/* MODAL 1: AI Prompt Modal */}
      {showPromptModal && (
        <div
          className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setShowPromptModal(false)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <IconSparkles size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-(--text)">
                    AI Reverse-Engineering Prompt: {modelLabel(selectedKey)}
                  </h2>
                  <p className="text-[11px] text-(--text2)">
                    Copy this prompt into ChatGPT, Claude, or Gemini to extract bulletproof DOM selectors.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPromptModal(false)}
                className="p-1.5 rounded-lg text-(--text2) hover:text-(--text) hover:bg-white/5 transition-colors cursor-pointer"
              >
                <IconX size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-0 custom-scrollbar">
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs flex items-center justify-between">
                <span>
                  💡 This prompt includes your live extracted DOM from {modelLabel(selectedKey)} and requests an exact JSON response for all 8 automation hooks.
                </span>
                {copiedPrompt && (
                  <span className="flex items-center gap-1 font-semibold text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded text-[11px]">
                    <IconCheck size={12} /> Auto-Copied!
                  </span>
                )}
              </div>

              <textarea
                readOnly
                value={promptText}
                rows={16}
                className="w-full flex-1 p-3 rounded-xl font-mono text-xs bg-black/60 border border-white/10 text-gray-200 focus:outline-none custom-scrollbar select-all"
              />
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 border-t border-white/10 flex items-center justify-between bg-black/20">
              <button
                type="button"
                onClick={() => {
                  setShowPromptModal(false)
                  setImportError(null)
                  setShowImportModal(true)
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-emerald-500/30 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <IconDownload size={13} />
                <span>Next: Import AI JSON Response →</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(promptText)
                    setCopiedPrompt(true)
                    setTimeout(() => setCopiedPrompt(false), 2500)
                  }}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black transition-all cursor-pointer flex items-center gap-1.5 shadow-md"
                >
                  {copiedPrompt ? <IconCheck size={13} /> : <IconCopy size={13} />}
                  <span>{copiedPrompt ? 'Copied to Clipboard!' : 'Copy Prompt'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPromptModal(false)}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium border border-white/10 text-gray-300 hover:bg-white/5 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Import AI Selectors JSON Modal */}
      {showImportModal && (
        <div
          className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setShowImportModal(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <IconDownload size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-(--text)">
                    Import AI Selectors: {modelLabel(selectedKey)}
                  </h2>
                  <p className="text-[11px] text-(--text2)">
                    Paste the JSON returned by the AI to automatically configure all hooks.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="p-1.5 rounded-lg text-(--text2) hover:text-(--text) hover:bg-white/5 transition-colors cursor-pointer"
              >
                <IconX size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 flex flex-col gap-3">
              {importError && (
                <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs">
                  ⚠️ {importError}
                </div>
              )}

              <p className="text-xs text-(--text2)">
                Paste the full AI answer or JSON code block here. Any matching selectors (attachment, composer, send button, navigation, titles) will be applied instantly.
              </p>

              <textarea
                value={importJsonText}
                onChange={(e) => {
                  setImportJsonText(e.target.value)
                  if (importError) setImportError(null)
                }}
                rows={10}
                placeholder={`{\n  "attachmentSelector": "input[type=\\"file\\"]",\n  "composerSelector": "#prompt-textarea",\n  "sendButtonSelector": "button[data-testid=\\"send-button\\"]"\n}`}
                className="w-full p-3 rounded-xl font-mono text-xs bg-black/60 border border-white/10 text-gray-200 focus:border-emerald-400 focus:outline-none custom-scrollbar"
                autoFocus
              />
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 border-t border-white/10 flex items-center justify-end gap-2 bg-black/20">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-3 py-1.5 rounded-xl text-xs font-medium border border-white/10 text-gray-300 hover:bg-white/5 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyAiJson}
                disabled={!importJsonText.trim()}
                className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-black transition-all cursor-pointer flex items-center gap-1.5 shadow-md"
              >
                <IconCheck size={13} />
                <span>Apply Selectors</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
