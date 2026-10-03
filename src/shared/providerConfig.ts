export interface ProviderFeatureConfig {
  promptNavSelector?: string            // Alt+J/K user query selector
  chatTitleSelector?: string            // DOM selector for active chat title in sidebar/header
  chatTitlePollingIntervalMs?: number   // Polling interval in ms (0 for event-based)
  defaultChatTitles?: string[]          // Filter out generic titles (e.g. "New Chat", "ChatGPT", "Claude", "Untitled")
  composerSelector?: string             // Prompt textarea/contenteditable for '/' hotkey & tab focus
  sendButtonSelector?: string           // Send button selector for skill prompt injection
  autoSubmitSkillPrompt?: boolean       // Whether skill prompt auto-clicks send
  newChatSelector?: string              // Site's "+ New Chat" button selector
  stopGenerationSelector?: string       // Site's "Stop generating" button selector
  virtualizationSelector?: string       // Selector for content-visibility: auto memory optimization
  enableSlashFocus?: boolean            // Whether '/' hotkey focuses prompt
  enableFocusRetention?: boolean        // Whether caret position is remembered on blur
  attachmentSelector?: string           // File upload input/button selector
  customInitScript?: string             // Custom JavaScript to execute on DOM ready
}

export interface ThemeSelectors {
  // Group A: Macro Shell & Layout
  appContainer?: string
  chatWrapper?: string
  sidebar?: string
  header?: string
  modelDropdown?: string

  // Group B: Chat Messages & Content
  userMessage?: string
  aiMessage?: string
  markdownProse?: string
  thinkingBlock?: string
  codeBlock?: string

  // Group C: Composer & Actions
  composer?: string
  sendButton?: string
  actionButtons?: string
}

export interface ProviderOverrides {
  on?: 'default' | 'on' | 'off' // tri-state vs global master toggle
  cssFeatures?: {
    structural?: boolean
    colors?: boolean
    bubbles?: boolean
    typography?: boolean
  }
  colors?: Partial<
    Record<'bg' | 'surface' | 'surface2' | 'accent' | 'text' | 'text2' | 'border', string>
  >
  accentColor?: string
  accentGlowColor?: string
  surfaceBgColor?: string
  geometry?: { radius?: number; borderWidth?: number }
  themeSelectors?: ThemeSelectors
  typography?: {
    fontWeight?: number
    fontWeightHeadings?: number
    fontSize?: number
    fontFamily?: string
    lineHeight?: number
    letterSpacing?: number
  }
  layout?: { pageWidth?: number; bubbleMaxWidth?: number; composerWidth?: number }
  effects?: {
    selectionBg?: string
    selectionFg?: string
    scrollbarThumb?: string
    scrollbarTrack?: string
    shadowAlpha?: number
    hoverTintAlpha?: number
    codeBlockBg?: string
    codeBlockRadius?: number
  }
  surfaceDarkness?: number
  accentContrast?: number
  fontVibe?: 'sans' | 'tech' | 'mono'
  glassmorphism?: 'glassmorphic' | 'ultra-glass' | 'solid-opaque'
  motionSpeed?: 'smooth' | 'snappy' | 'reduced'
  iconPack?: 'lucide-line' | 'cyber-hud' | 'duotone-glow' | 'solid-silhouette' | 'retro-monoline'
  iconStrokeWeight?: 'thin' | 'standard' | 'bold'
  iconGlowEffect?: boolean
  tabGlowStyle?: 'pill-glow' | 'laser-line' | 'badge-neon' | 'subtle-dot'
  tabAccentMode?: 'provider' | 'custom'
  ambientAura?: boolean
  ambientAuraMode?: 'viewport-frame' | 'chat-center'
  ambientAuraIntensity?: number
  ambientAuraColor?: string
  bubbleStyle?: 'gradient-pill' | 'glass-slate' | 'minimal-outline'
  bubbleGradientDepth?: number
  codeBlockStyle?: 'oled-contrast' | 'matrix-terminal' | 'soft-slate'
  codeBlockMargin?: number
  composerGlow?: 'electric-neon' | 'clean-border' | 'underglow-pill'
  composerHaloIntensity?: number
  messageGap?: number
  aiResponseWidthPx?: number | string
  userPromptWidthPx?: number | string
  customCss?: string
  features?: ProviderFeatureConfig
}

export interface CustomProviderTheme {
  id: string; // e.g. "custom-z-ai"
  hosts: string[]; // e.g. ["z.ai", "chat.z.ai"]
  css: string; // The raw CSS string using var(--bg) etc.
}

export type ProviderConfigMap = Record<string, ProviderOverrides>

export const DEFAULT_PROVIDER_FEATURES: Record<string, ProviderFeatureConfig> = {
  chatgpt: {
    promptNavSelector: '[data-message-author-role="user"]',
    chatTitleSelector: 'nav a[class*="active"], nav [class*="bg-token-sidebar-surface-secondary"], header h1',
    chatTitlePollingIntervalMs: 1500,
    defaultChatTitles: ['ChatGPT', 'New chat', 'Untitled', 'OpenAI'],
    composerSelector: '#prompt-textarea, div#prompt-textarea, textarea[data-id="root"]',
    sendButtonSelector: 'button[data-testid="send-button"], button[aria-label*="Send"]',
    autoSubmitSkillPrompt: true,
    newChatSelector: 'a[href="/"], button[aria-label*="New chat"]',
    stopGenerationSelector: 'button[aria-label*="Stop generating"], button[data-testid="stop-button"]',
    virtualizationSelector: '[data-message-author-role="user"], [data-message-author-role="assistant"]',
    enableSlashFocus: true,
    enableFocusRetention: true,
    attachmentSelector: 'input[type="file"]'
  },
  claude: {
    promptNavSelector: '[data-testid="user-message"], .font-user-message, [class*="UserMessage"]',
    chatTitleSelector: '[data-testid="chat-title"], header [class*="truncate"], nav a[class*="active"]',
    chatTitlePollingIntervalMs: 1500,
    defaultChatTitles: ['Claude', 'New chat', 'Untitled', 'Anthropic'],
    composerSelector: '.ProseMirror, fieldset[class*="border"] [contenteditable="true"], div[contenteditable="true"]',
    sendButtonSelector: 'button[aria-label="Send Message"], button[aria-label*="Send"]',
    autoSubmitSkillPrompt: true,
    newChatSelector: 'a[href="/new"], button[aria-label*="New chat"]',
    stopGenerationSelector: 'button[aria-label*="Stop Response"], button[aria-label*="Stop"]',
    virtualizationSelector: '[data-testid="user-message"], [data-testid="assistant-message"]',
    enableSlashFocus: true,
    enableFocusRetention: true,
    attachmentSelector: 'input[type="file"]'
  },
  gemini: {
    promptNavSelector: 'user-query, [data-test-id="user-query"], .user-query-container, [class*="user-query"]',
    chatTitleSelector: '.conversation-title, .chat-title-text, [data-test-id="conversation-title"]',
    chatTitlePollingIntervalMs: 1500,
    defaultChatTitles: ['Gemini', 'Google Gemini', 'New chat', 'Untitled conversation'],
    composerSelector: 'rich-textarea [contenteditable="true"], .ql-editor, div[contenteditable="true"]',
    sendButtonSelector: 'button[aria-label*="Send"], button.send-button, .send-button-container button',
    autoSubmitSkillPrompt: true,
    newChatSelector: 'button[aria-label*="New chat"], .new-chat-button',
    stopGenerationSelector: 'button[aria-label*="Stop"], button.stop-button',
    virtualizationSelector: 'user-query, model-response, .user-query-bubble-with-background',
    enableSlashFocus: true,
    enableFocusRetention: true,
    attachmentSelector: 'input[type="file"], button[aria-label*="Upload image"]'
  },
  deepseek: {
    promptNavSelector: '.ds-message, [class*="ds-message-user"], [class*="user-message"]',
    chatTitleSelector: '[class*="chat-title"], [class*="session-item-active"], header h2',
    chatTitlePollingIntervalMs: 1500,
    defaultChatTitles: ['DeepSeek', 'DeepSeek Coder', 'New chat', 'Untitled'],
    composerSelector: 'textarea.ant-input, #chat-input, textarea[placeholder*="DeepSeek"]',
    sendButtonSelector: 'button[class*="send"], [class*="send-btn"], button[type="submit"]',
    autoSubmitSkillPrompt: true,
    newChatSelector: 'button[class*="new-chat"], [class*="add-chat-btn"]',
    stopGenerationSelector: 'button[class*="stop-btn"], [class*="stop-generating"]',
    virtualizationSelector: '[class*="ds-message"]',
    enableSlashFocus: true,
    enableFocusRetention: true
  },
  perplexity: {
    promptNavSelector: '[data-testid="query-bubble"], [class*="user-query"], [class*="query-text"]',
    chatTitleSelector: 'header h1, [data-testid="thread-title"], [class*="thread-title"]',
    chatTitlePollingIntervalMs: 1500,
    defaultChatTitles: ['Perplexity', 'Where knowledge begins', 'New Thread', 'Untitled'],
    composerSelector: 'textarea[placeholder*="Ask"], textarea[placeholder*="search"], textarea',
    sendButtonSelector: 'button[aria-label*="Submit"], button[aria-label*="Search"], button.bg-super',
    autoSubmitSkillPrompt: true,
    newChatSelector: 'a[href="/"], button[aria-label*="New Thread"]',
    stopGenerationSelector: 'button[aria-label*="Stop"]',
    virtualizationSelector: '[data-testid="thread-turn"]',
    enableSlashFocus: true,
    enableFocusRetention: true
  },
  qwen: {
    promptNavSelector: '.chat-user-message, .qwen-chat-message-user, [class*="chat-user-message"]',
    chatTitleSelector: '.chat-item-drag-active .chat-item-drag-link-content-tip-text, .chat-item-active',
    chatTitlePollingIntervalMs: 1000,
    defaultChatTitles: ['Qwen', 'Tongyi Qianwen', 'New chat', 'Untitled'],
    composerSelector: 'textarea#chat-input, textarea[class*="chat-input"], textarea.ant-input:not([style*="display: none"]):not([disabled])',
    sendButtonSelector: 'button[class*="send-btn"], button[type="submit"]',
    autoSubmitSkillPrompt: true,
    newChatSelector: 'button[class*="new-chat"]',
    stopGenerationSelector: 'button[class*="stop-btn"]',
    virtualizationSelector: '.qwen-chat-message-user, .qwen-chat-message-assistant',
    enableSlashFocus: true,
    enableFocusRetention: true
  },
  kimi: {
    promptNavSelector: '.segment.segment-user, [class*="segment-user"], [class*="user-segment"]',
    chatTitleSelector: '[class*="chat-item-active"] [class*="title"], header [class*="chat-title"]',
    chatTitlePollingIntervalMs: 1500,
    defaultChatTitles: ['Kimi', 'Kimi.ai', 'Moonshot AI', '未命名对话', 'New chat'],
    composerSelector: 'div.chat-input-editor, .chat-input [contenteditable="true"], .chat-input textarea',
    sendButtonSelector: 'button[class*="send-button"], button[class*="send"]',
    autoSubmitSkillPrompt: true,
    newChatSelector: 'button[class*="new-chat-button"]',
    stopGenerationSelector: 'button[class*="stop-button"]',
    virtualizationSelector: '.segment.segment-user, .segment.segment-assistant',
    enableSlashFocus: true,
    enableFocusRetention: true
  },
  generic: {
    promptNavSelector: '[class*="user-query"]:not([class*="assistant"]), [class*="user-message"], [class*="UserMessage"], [data-message-author="user"]',
    chatTitleSelector: 'header h1, header h2, nav a[class*="active"], [class*="active"] [class*="title"]',
    chatTitlePollingIntervalMs: 2000,
    defaultChatTitles: ['New Chat', 'Untitled', 'Chat', 'AI Chat'],
    composerSelector: 'textarea:not([disabled]), [contenteditable="true"][role="textbox"], div[contenteditable="true"], #prompt-textarea, .ProseMirror',
    sendButtonSelector: 'button[aria-label*="Send"], button[type="submit"], button[data-testid*="send"], .send-button',
    autoSubmitSkillPrompt: true,
    newChatSelector: 'a[href*="new"], a[href*="chat"], button[aria-label*="New"], button[class*="new"]',
    stopGenerationSelector: 'button[aria-label*="Stop"], button[class*="stop"]',
    virtualizationSelector: '[class*="user"], [class*="assistant"], [class*="message"]',
    enableSlashFocus: true,
    enableFocusRetention: true,
    attachmentSelector: 'input[type="file"], button[aria-label*="Attach"], button[aria-label*="Upload"]'
  }
}

export function getProviderDefaultFeatures(providerKey?: string): ProviderFeatureConfig {
  if (!providerKey) return DEFAULT_PROVIDER_FEATURES.generic
  const key = providerKey.toLowerCase()
  for (const [k, v] of Object.entries(DEFAULT_PROVIDER_FEATURES)) {
    if (key.includes(k)) return v
  }
  return DEFAULT_PROVIDER_FEATURES.generic
}

export function getMergedProviderFeatures(
  providerKey: string,
  overrides?: ProviderOverrides,
  globalOverrides?: ProviderOverrides
): ProviderFeatureConfig {
  const defaults = getProviderDefaultFeatures(providerKey)
  const globalUser = globalOverrides?.features || {}
  const user = overrides?.features || {}

  let combinedScript: string | undefined = undefined
  if (globalUser.customInitScript && user.customInitScript) {
    combinedScript = `${globalUser.customInitScript}\n\n${user.customInitScript}`
  } else {
    combinedScript = user.customInitScript || globalUser.customInitScript
  }

  return {
    ...defaults,
    ...globalUser,
    ...user,
    customInitScript: combinedScript,
    defaultChatTitles:
      user.defaultChatTitles && user.defaultChatTitles.length > 0
        ? user.defaultChatTitles
        : globalUser.defaultChatTitles && globalUser.defaultChatTitles.length > 0
          ? globalUser.defaultChatTitles
          : defaults.defaultChatTitles
  }
}

