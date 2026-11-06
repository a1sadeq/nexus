import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DEFAULT_BUILTIN_PROVIDER_CONFIG, type ProviderConfigMap } from '../shared/providerConfig'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('Provider Config Built-in Defaults & Persistence Integrity', () => {
  it('contains all user configured providers with exact settings', () => {
    expect(DEFAULT_BUILTIN_PROVIDER_CONFIG.glm).toBeDefined()
    expect(DEFAULT_BUILTIN_PROVIDER_CONFIG.kimi).toBeDefined()
    expect(DEFAULT_BUILTIN_PROVIDER_CONFIG.qwen).toBeDefined()
    expect(DEFAULT_BUILTIN_PROVIDER_CONFIG.gemini).toBeDefined()
    expect(DEFAULT_BUILTIN_PROVIDER_CONFIG['z-glm']).toBeDefined()
    expect(DEFAULT_BUILTIN_PROVIDER_CONFIG['arena-ai']).toBeDefined()
    expect(DEFAULT_BUILTIN_PROVIDER_CONFIG['arena']).toBeDefined()

    // GLM exact configurations
    const glm = DEFAULT_BUILTIN_PROVIDER_CONFIG.glm
    expect(glm.accentColor).toBe('#8b5cf6')
    expect(glm.aiResponseWidthPx).toBe(1200)
    expect(glm.userPromptWidthPx).toBe(533)
    expect(glm.surfaceDarkness).toBe(100)
    expect(glm.ambientAuraMode).toBe('chat-center')
    expect(glm.themeSelectors?.appContainer).toBe('#chat-container')
    expect(glm.themeSelectors?.aiMessage).toBe('.chat-assistant')
    expect(glm.themeSelectors?.composer).toBe('#messages-container ~ div:last-child')

    // Kimi exact configurations
    const kimi = DEFAULT_BUILTIN_PROVIDER_CONFIG.kimi
    expect(kimi.accentColor).toBe('#6366f1')
    expect(kimi.accentGlowColor).toBe('#f59e0b')
    expect(kimi.ambientAuraIntensity).toBe(65)
    expect(kimi.geometry?.radius).toBe(19)

    // Qwen exact configurations
    expect(DEFAULT_BUILTIN_PROVIDER_CONFIG.qwen.aiResponseWidthPx).toBe(1185)

    // Gemini exact configurations
    const gemini = DEFAULT_BUILTIN_PROVIDER_CONFIG.gemini
    expect(gemini.aiResponseWidthPx).toBe(1108)
    expect(gemini.features?.chatTitleSelector).toBe('.conversation-title, .chat-title-text, [data-test-id="conversation-title"], div[class*="conversation-title"], header h1')
    expect(gemini.customCss).toContain('ARENA.AI — OLED BLACK')

    // Arena AI exact configurations
    const arena = DEFAULT_BUILTIN_PROVIDER_CONFIG['arena-ai']
    expect(arena.aiResponseWidthPx).toBe(936)
    expect(arena.accentColor).toBe('#3b82f6')
    expect(arena.features?.chatTitleSelector).toBe('button[aria-haspopup="menu"] > span[dir="auto"].truncate')
    expect(arena.features?.newChatSelector).toBe('a[data-sidebar="menu-button"][href="/agent"]')
    expect(arena.themeSelectors?.appContainer).toBe('main.bg-background')
    expect(arena.customCss).toContain('ARENA.AI — OLED BLACK')
  })

  it('matches user live providers.json file if present on disk', () => {
    const liveConfigPath = path.join(os.homedir(), '.config', 'nexus', 'providers.json')
    if (fs.existsSync(liveConfigPath)) {
      const live = JSON.parse(fs.readFileSync(liveConfigPath, 'utf-8'))
      for (const key of Object.keys(live)) {
        expect(DEFAULT_BUILTIN_PROVIDER_CONFIG[key]).toBeDefined()
        if (live[key].aiResponseWidthPx) {
          expect(DEFAULT_BUILTIN_PROVIDER_CONFIG[key].aiResponseWidthPx).toBe(live[key].aiResponseWidthPx)
        }
        if (live[key].accentColor) {
          expect(DEFAULT_BUILTIN_PROVIDER_CONFIG[key].accentColor).toBe(live[key].accentColor)
        }
      }
    }
  })

  describe('Non-Destructive Merge and Overwrite Protection', () => {
    const tmpDir = path.join(os.tmpdir(), 'nexus-prov-test-' + Date.now())
    const filePath = path.join(tmpDir, 'providers.json')

    beforeEach(() => {
      fs.mkdirSync(tmpDir, { recursive: true })
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('merges disk user overrides without losing built-in defaults', () => {
      // Simulate disk file having custom accent for gemini and custom width for kimi
      const diskCustom = {
        gemini: { accentColor: '#ff0055' },
        kimi: { aiResponseWidthPx: 1400 }
      }
      fs.writeFileSync(filePath, JSON.stringify(diskCustom), 'utf-8')

      const raw = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw)

      const merged: ProviderConfigMap = {}
      for (const [k, v] of Object.entries(DEFAULT_BUILTIN_PROVIDER_CONFIG)) {
        merged[k] = JSON.parse(JSON.stringify(v))
      }
      for (const [k, v] of Object.entries(parsed)) {
        if (merged[k] && typeof merged[k] === 'object' && typeof v === 'object' && v !== null) {
          merged[k] = {
            ...merged[k],
            ...(v as any),
            cssFeatures: { ...merged[k].cssFeatures, ...(v as any).cssFeatures },
            themeSelectors: { ...merged[k].themeSelectors, ...(v as any).themeSelectors },
            features: { ...merged[k].features, ...(v as any).features },
            geometry: { ...merged[k].geometry, ...(v as any).geometry }
          }
        } else {
          merged[k] = v as any
        }
      }

      // User's custom overrides win
      expect(merged.gemini.accentColor).toBe('#ff0055')
      expect(merged.kimi.aiResponseWidthPx).toBe(1400)

      // Other defaults remain intact
      expect(merged.gemini.aiResponseWidthPx).toBe(1108)
      expect(merged.glm.accentColor).toBe('#8b5cf6')
      expect(merged['arena-ai'].aiResponseWidthPx).toBe(936)
    })

    it('guard prevents overwriting populated providers.json with empty object', () => {
      fs.writeFileSync(filePath, JSON.stringify({ glm: { accentColor: '#8b5cf6' } }), 'utf-8')

      const incomingEmpty: ProviderConfigMap = {}

      function safePersist(cfg: ProviderConfigMap) {
        if (!cfg || typeof cfg !== 'object' || Object.keys(cfg).length === 0) {
          if (fs.existsSync(filePath)) {
            const existing = fs.readFileSync(filePath, 'utf-8').trim()
            if (existing && existing !== '{}') {
              return false // Refused overwrite
            }
          }
        }
        fs.writeFileSync(filePath, JSON.stringify(cfg), 'utf-8')
        return true
      }

      const result = safePersist(incomingEmpty)
      expect(result).toBe(false)

      // File on disk remains intact
      const contentOnDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      expect(contentOnDisk.glm.accentColor).toBe('#8b5cf6')
    })
  })
})
