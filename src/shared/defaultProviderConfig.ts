// Built-in default provider configurations extracted from verified user settings.
// Seeded automatically on fresh installs and used to safely fallback missing provider keys.
import type { ProviderConfigMap } from './providerConfig'

export const DEFAULT_BUILTIN_PROVIDER_CONFIG: ProviderConfigMap = {
  "glm": {
    "accentColor": "#8b5cf6",
    "accentContrast": 150,
    "aiResponseWidthPx": 1200,
    "ambientAura": true,
    "ambientAuraColor": "#8b5cf6",
    "ambientAuraIntensity": 37,
    "ambientAuraMode": "chat-center",
    "bubbleStyle": "glass-slate",
    "cssFeatures": {
      "bubbles": true,
      "colors": true,
      "structural": true,
      "typography": true
    },
    "customCss": "",
    "glassmorphism": "glassmorphic",
    "iconGlowEffect": false,
    "iconStrokeWeight": "standard",
    "on": "on",
    "surfaceDarkness": 100,
    "tabGlowStyle": "laser-line",
    "themeSelectors": {
      "aiMessage": ".chat-assistant",
      "appContainer": "#chat-container",
      "chatWrapper": "#messages-container",
      "codeBlock": "[class^=\"language-\"]",
      "composer": "#messages-container ~ div:last-child",
      "header": "nav.drag-region",
      "markdownProse": ".markdown-prose, .prose",
      "sidebar": "#sidebar > div",
      "thinkingBlock": ".thinking-chain-container",
      "userMessage": ".chat-user div.rounded-xl"
    },
    "userPromptWidthPx": 533
  },
  "kimi": {
    "accentColor": "#6366f1",
    "accentContrast": 49,
    "accentGlowColor": "#f59e0b",
    "ambientAuraColor": "#8b5cf6",
    "ambientAuraIntensity": 65,
    "ambientAuraMode": "chat-center",
    "geometry": {
      "radius": 19
    },
    "surfaceDarkness": 100
  },
  "qwen": {
    "aiResponseWidthPx": 1185
  },
  "gemini": {
    "aiResponseWidthPx": 1108,
    "on": "on",
    "ambientAuraColor": "#3b82f6",
    "features": {
      "chatTitleSelector": ".conversation-title, .chat-title-text, [data-test-id=\"conversation-title\"], div[class*=\"conversation-title\"], header h1"
    },
    "customCss": "ARENA.AI \u2014 OLED BLACK\n   Replaces the earlier transparency/scrim experiments.\n   Verified: text 20.10:1 on pure black, muted 6.27:1, accent 9.48:1\n   ============================================================ */\n/* ---------- 0. DELETE THESE FROM YOUR EXISTING CSS ----------\n   They are what's making it muddy \u2014 a neutral #202020 veil over a\n   warm app, plus a blue-tinted bubble.\n   main.bg-background,\n   div[data-sidebar=\"sidebar\"] { background: rgb(37 37 35 / .55) !important;\n                                 backdrop-filter: blur(10px); }\n   --nexus-surface: transparent\n   --nexus-bg: transparent\n   --nexus-bubble-bg: linear-gradient(135deg, hsl(24 6% 22%) ...)\n   --nexus-composer-focus-* (the blue glow)\n   Your pasted block is also duplicated (every rule appears twice).\n   Keep one copy only.\n   ------------------------------------------------------------ */\n/* ---------- 1. SURFACES: pure black with OLED-safe elevation ---------- */\n:root, body {\n  color-scheme: dark;\n  --background:        0 0% 0%;      /* #000000 */\n  --surface-primary:   0 0% 0%;      /* #000000 */\n  --surface-secondary: 0 0% 4%;      /* #0a0a0a */\n  --surface-tertiary:  0 0% 7%;      /* #121212 */\n  --surface-raised:    0 0% 10%;     /* #1a1a1a */\n  --surface-raised-alt:0 0% 10%;\n  --surface-floating:  0 0% 8%;\n  --surface-highlight: 0 0% 12%;\n  --surface-skeleton:  0 0% 8%;\n  --sidebar-background: 0 0% 0%;\n  --sidebar-accent:     0 0% 8%;\n  --sidebar-border:     0 0% 14%;\n  --card:     0 0% 3%;\n  --popover:  0 0% 3%;\n  --secondary:0 0% 6%;\n  --muted:    0 0% 10%;\n  --accent:   0 0% 10%;\n  /* Nexus-native tokens */\n  --nexus-bg:       #000000;\n  --nexus-surface:  #000000;\n  --nexus-surface2: #0a0a0a;\n  /* user bubble \u2014 neutral, no blue */\n  --nexus-bubble-bg:       #141414;\n  --nexus-bubble-bg-color: #141414;\n  --nexus-bubble-border:   1px solid #262626;\n  --nexus-bubble-shadow:   none;\n  /* code */\n  --nexus-code-bg:     #050505;\n  --nexus-code-border: 1px solid #1c1c1c;\n  --nexus-code-shadow: none;\n  /* composer \u2014 no blue glow */\n  --nexus-composer-focus-border:        1px solid #2a2a2a;\n  --nexus-composer-focus-border-bottom: none;\n  --nexus-composer-focus-shadow:        none;\n}\nhtml, body { background: #000 !important; }\n/* ---------- 2. BORDERS: OLED needs them subtle but visible ---------- */\n:root, body {\n  --border:        0 0% 12%;\n  --border-faint:  0 0% 12%;\n  --border-medium: 0 0% 18%;\n  --border-strong: 0 0% 26%;\n  --input:         0 0% 98% / 20%;\n  --ring:          0 0% 30%;\n}\n/* ---------- 3. TEXT: neutral grey ramp, no warm cast ---------- */\n:root, body {\n  --text-primary:     0 0% 98%;      /* 20.10:1 */\n  --text-secondary:   0 0% 80%;      /* 13.08:1 */\n  --text-tertiary:    0 0% 66%;      /*  8.86:1 */\n  --text-placeholder: 0 0% 98% / 45%;/*  4.27:1  (raise to /55% for 5.5:1) */\n  --foreground:        0 0% 98%;\n  --card-foreground:   0 0% 98%;\n  --popover-foreground:0 0% 98%;\n  --sidebar-foreground:0 0% 90%;\n  --secondary-foreground:0 0% 90%;\n  --muted-foreground:  0 0% 55%;\n  --accent-foreground: 0 0% 95%;\n  --nexus-text:  #fafafa;\n  --nexus-text2: #a1a1aa;\n  --interactive-normal:   0 0% 90%;\n  --interactive-active:   0 0% 100%;\n  --header-primary:       0 0% 98%;\n  --header-secondary:     0 0% 78%;\n}\n/* ---------- 4. ACCENT: one cool blue for everything interactive ---------- */\n:root, body {\n  --nexus-accent:      #7ab0ff;   /* 9.48:1 on #000 */\n  --interactive-link:  210 100% 66%;\n  --primary:           0 0% 98%;  /* white send button */\n  --primary-foreground:0 0% 0%;\n  --interactive-cta:        0 0% 98%;\n  --interactive-on-cta:     0 0% 0%;\n  --interactive-cta-hover:  0 0% 88%;\n  --interactive-cta-secondary:      0 0% 8%;\n  --interactive-cta-secondary-hover:0 0% 14%;\n  --interactive-cta-focus:  0 0% 40%;\n  --highlight-background: 0 0% 100%;\n  --highlight-text:       0 0% 0%;\n}\n/* ---------- 5. SURFACE PAINTS ---------- */\nmain.bg-background,\ndiv[data-sidebar=\"sidebar\"],\ndiv[data-sidebar=\"content\"],\ndiv[data-sidebar=\"footer\"],\ndiv[class*=\"sidebar-wrapper\"] { background: #000 !important; }\n/* header gradient must not fade to a grey \u2014 fade to black */\ndiv[class*=\"from-surface-primary\"] {\n  background-image: linear-gradient(to bottom, #000 75%, rgb(0 0 0 / 0)) !important;\n}\n/* composer shell */\n[class*=\"rounded-[14px]\"] {\n  background: #0a0a0a !important;\n  border-color: #242424 !important;\n}\n[class*=\"rounded-[14px]\"]:focus-within {\n  border-color: #3a3a3a !important;\n  box-shadow: none !important;\n}\n/* sidebar rail */\nbutton[data-sidebar=\"rail\"] { background: transparent !important; }\nbutton[data-sidebar=\"rail\"]:hover { background: rgb(255 255 255 / .07) !important; }\n/* ---------- 6. CODE BLOCKS (keep your per-layer rules) ---------- */\n[data-streamdown=\"code-block\"] { border: 1px solid #1c1c1c !important; background: transparent !important; }\n[data-streamdown=\"code-block-header\"] { background: #0d0d0d !important; border: none !important; }\n[data-streamdown=\"code-block-body\"] { background: var(--nexus-code-bg) !important; }\ncode[data-streamdown=\"inline-code\"] { background: #1a1a1a !important; color: #fafafa !important; }\n/* ---------- 7. MESSAGE SURFACES ---------- */\n[data-agent-transcript-message=\"true\"] > div.bg-surface-primary.rounded-xl {\n  background: transparent !important;    /* assistant: flat on black */\n}\n[data-user-message-body-row=\"true\"] > div {\n  background: var(--nexus-bubble-bg) !important;\n  border: var(--nexus-bubble-border) !important;\n}\n/* ---------- 8. KILL ALL GLOWS / TINTS ---------- */\n* { text-shadow: none !important; }\n[data-perf-target=\"composer\"] ::selection { background: #7ab0ff33; }\n/* scrollbars */\n* { scrollbar-color: #2a2a2a #000; scrollbar-width: thin; }\n::-webkit-scrollbar { width: 10px; height: 10px; }\n::-webkit-scrollbar-track { background: #000; }\n::-webkit-scrollbar-thumb { background: #242424; border-radius: 6px; }\n::-webkit-scrollbar-thumb:hover { background: #333; }\n:root, html.dark, html.light, body { --text-primary: 0 0% 98%; \u2026 }"
  },
  "z-glm": {
    "accentColor": "#3b82f6",
    "on": "off",
    "features": {
      "chatTitleSelector": "div.group > button[data-selected=\"true\"] .truncate, [data-testid*=\"chat-title\" i], nav a[aria-current=\"page\"]",
      "attachmentSelector": "input[type=\"file\"]",
      "promptNavSelector": "div.user-message, [data-message-author-role=\"user\"]",
      "composerSelector": "div[contenteditable=\"true\"][role=\"textbox\"], .ProseMirror[contenteditable=\"true\"], div[contenteditable=\"plaintext-only\"], textarea#prompt-textarea",
      "sendButtonSelector": "button[aria-label*=\"send\" i], button[aria-label*=\"\u53d1\u9001\" i], button[data-testid*=\"send\" i], form button[class*=\"send\" i]",
      "newChatSelector": "button[aria-label*=\"new\" i], button[aria-label*=\"\u65b0\u5efa\" i], button[aria-label*=\"\u65b0\u5bf9\u8bdd\" i], button[data-testid*=\"new-chat\" i]",
      "stopGenerationSelector": "button[aria-label*=\"stop\" i], button[aria-label*=\"\u505c\u6b62\" i], button[data-testid*=\"stop\" i], button[class*=\"stop\" i]",
      "virtualizationSelector": "[id^=\"message-\"], [data-message-id], [data-message-author-role]"
    }
  },
  "arena-ai": {
    "on": "on",
    "features": {
      "chatTitleSelector": "button[aria-haspopup=\"menu\"] > span[dir=\"auto\"].truncate",
      "attachmentSelector": "[data-perf-target=\"composer\"] input[type=\"file\"]",
      "promptNavSelector": "[data-agent-transcript-message=\"true\"][data-chat-message-id]:has(> [data-user-message-layout=\"true\"])",
      "composerSelector": "[data-perf-target=\"composer\"] div.ProseMirror[contenteditable=\"true\"]:not([aria-disabled=\"true\"])",
      "sendButtonSelector": "button[data-perf-target=\"send\"][aria-label=\"Send message\"]",
      "newChatSelector": "a[data-sidebar=\"menu-button\"][href=\"/agent\"]",
      "stopGenerationSelector": "button[data-perf-target=\"send\"][aria-label=\"Stop generating\"]",
      "assistantMessageSelector": "[data-agent-transcript-message=\"true\"][data-chat-message-id]:not(:has(> [data-user-message-layout=\"true\"])), [data-perf-target=\"transcript\"] [role=\"log\"] > div > div.rounded-xl:not([data-agent-transcript-message])",
      "streamingSelector": "button[data-perf-target=\"send\"][aria-label=\"Stop generating\"], [data-perf-target=\"transcript\"] [role=\"log\"] > div > div.rounded-xl:not([data-agent-transcript-message]), [data-perf-target=\"transcript\"] .animate-spin, [data-perf-target=\"sidebar_session\"] a[data-active=\"true\"] .animate-spin",
      "completionActionSelector": "[data-agent-transcript-message=\"true\"]:last-child > div > div > div.mt-3 button[aria-label=\"Copy\"]",
      "statusWatchdogTimeoutMs": 15000,
      "virtualizationSelector": "[data-agent-transcript-message=\"true\"][data-chat-message-id]"
    },
    "ambientAura": true,
    "tabGlowStyle": "laser-line",
    "surfaceDarkness": 100,
    "accentContrast": 72,
    "cssFeatures": {
      "colors": true,
      "bubbles": true,
      "structural": true
    },
    "themeSelectors": {
      "appContainer": "main.bg-background",
      "chatWrapper": "[data-perf-target=\"transcript\"] .max-w-3xl",
      "sidebar": "div[data-sidebar=\"sidebar\"], div[data-sidebar=\"content\"], div[data-sidebar=\"footer\"], button[data-sidebar=\"rail\"]",
      "header": "div.absolute.start-0.top-0.z-20",
      "modelDropdown": "button[aria-label=\"Model\"]",
      "userMessage": "[data-user-message-body-row=\"true\"] > div",
      "aiMessage": "[data-agent-transcript-message=\"true\"] > div.bg-surface-primary.rounded-xl",
      "markdownProse": "[data-agent-transcript-message] div.prose.body-base",
      "thinkingBlock": "div.not-prose[data-state] > button[data-state], div.not-prose[data-state] > div.text-text-secondary",
      "codeBlock": "[data-streamdown=\"code-block\"], [data-streamdown=\"code-block-body\"]",
      "composer": "[data-perf-target=\"composer\"]",
      "actionButtons": "[data-agent-transcript-message] button[aria-label=\"Copy\"], [data-agent-transcript-message] button[aria-label=\"Open file\"]",
      "sendButton": "[data-perf-target=\"composer\"] button[aria-label*=\"send\" i]"
    },
    "aiResponseWidthPx": 936,
    "accentColor": "#3b82f6",
    "ambientAuraColor": "#3b82f6",
    "customCss": "/* ============================================================\n   ARENA.AI \u2014 OLED BLACK\n   Replaces the earlier transparency/scrim experiments.\n   Verified: text 20.10:1 on pure black, muted 6.27:1, accent 9.48:1\n   ============================================================ */\n\n/* ---------- 0. DELETE THESE FROM YOUR EXISTING CSS ----------\n   They are what's making it muddy \u2014 a neutral #202020 veil over a\n   warm app, plus a blue-tinted bubble.\n\n   main.bg-background,\n   div[data-sidebar=\"sidebar\"] { background: rgb(37 37 35 / .55) !important;\n                                 backdrop-filter: blur(10px); }\n   --nexus-surface: transparent\n   --nexus-bg: transparent\n   --nexus-bubble-bg: linear-gradient(135deg, hsl(24 6% 22%) ...)\n   --nexus-composer-focus-* (the blue glow)\n\n   Your pasted block is also duplicated (every rule appears twice).\n   Keep one copy only.\n   ------------------------------------------------------------ */\n\n\n/* ---------- 1. SURFACES: pure black with OLED-safe elevation ---------- */\n:root, body {\n  color-scheme: dark;\n\n  --background:        0 0% 0%;      /* #000000 */\n  --surface-primary:   0 0% 0%;      /* #000000 */\n  --surface-secondary: 0 0% 4%;      /* #0a0a0a */\n  --surface-tertiary:  0 0% 7%;      /* #121212 */\n  --surface-raised:    0 0% 10%;     /* #1a1a1a */\n  --surface-raised-alt:0 0% 10%;\n  --surface-floating:  0 0% 8%;\n  --surface-highlight: 0 0% 12%;\n  --surface-skeleton:  0 0% 8%;\n\n  --sidebar-background: 0 0% 0%;\n  --sidebar-accent:     0 0% 8%;\n  --sidebar-border:     0 0% 14%;\n\n  --card:     0 0% 3%;\n  --popover:  0 0% 3%;\n  --secondary:0 0% 6%;\n  --muted:    0 0% 10%;\n  --accent:   0 0% 10%;\n\n  /* Nexus-native tokens */\n  --nexus-bg:       #000000;\n  --nexus-surface:  #000000;\n  --nexus-surface2: #0a0a0a;\n\n  /* user bubble \u2014 neutral, no blue */\n  --nexus-bubble-bg:       #141414;\n  --nexus-bubble-bg-color: #141414;\n  --nexus-bubble-border:   1px solid #262626;\n  --nexus-bubble-shadow:   none;\n\n  /* code */\n  --nexus-code-bg:     #050505;\n  --nexus-code-border: 1px solid #1c1c1c;\n  --nexus-code-shadow: none;\n\n  /* composer \u2014 no blue glow */\n  --nexus-composer-focus-border:        1px solid #2a2a2a;\n  --nexus-composer-focus-border-bottom: none;\n  --nexus-composer-focus-shadow:        none;\n}\n\nhtml, body { background: #000 !important; }\n\n\n/* ---------- 2. BORDERS: OLED needs them subtle but visible ---------- */\n:root, body {\n  --border:        0 0% 12%;\n  --border-faint:  0 0% 12%;\n  --border-medium: 0 0% 18%;\n  --border-strong: 0 0% 26%;\n  --input:         0 0% 98% / 20%;\n  --ring:          0 0% 30%;\n}\n\n\n/* ---------- 3. TEXT: neutral grey ramp, no warm cast ---------- */\n:root, body {\n  --text-primary:     0 0% 98%;      /* 20.10:1 */\n  --text-secondary:   0 0% 80%;      /* 13.08:1 */\n  --text-tertiary:    0 0% 66%;      /*  8.86:1 */\n  --text-placeholder: 0 0% 98% / 45%;/*  4.27:1  (raise to /55% for 5.5:1) */\n  --foreground:        0 0% 98%;\n  --card-foreground:   0 0% 98%;\n  --popover-foreground:0 0% 98%;\n  --sidebar-foreground:0 0% 90%;\n  --secondary-foreground:0 0% 90%;\n  --muted-foreground:  0 0% 55%;\n  --accent-foreground: 0 0% 95%;\n\n  --nexus-text:  #fafafa;\n  --nexus-text2: #a1a1aa;\n  --interactive-normal:   0 0% 90%;\n  --interactive-active:   0 0% 100%;\n  --header-primary:       0 0% 98%;\n  --header-secondary:     0 0% 78%;\n}\n\n\n/* ---------- 4. ACCENT: one cool blue for everything interactive ---------- */\n:root, body {\n  --nexus-accent:      #7ab0ff;   /* 9.48:1 on #000 */\n  --interactive-link:  210 100% 66%;\n  --primary:           0 0% 98%;  /* white send button */\n  --primary-foreground:0 0% 0%;\n  --interactive-cta:        0 0% 98%;\n  --interactive-on-cta:     0 0% 0%;\n  --interactive-cta-hover:  0 0% 88%;\n  --interactive-cta-secondary:      0 0% 8%;\n  --interactive-cta-secondary-hover:0 0% 14%;\n  --interactive-cta-focus:  0 0% 40%;\n  --highlight-background: 0 0% 100%;\n  --highlight-text:       0 0% 0%;\n}\n\n\n/* ---------- 5. SURFACE PAINTS ---------- */\nmain.bg-background,\ndiv[data-sidebar=\"sidebar\"],\ndiv[data-sidebar=\"content\"],\ndiv[data-sidebar=\"footer\"],\ndiv[class*=\"sidebar-wrapper\"] { background: #000 !important; }\n\n/* header gradient must not fade to a grey \u2014 fade to black */\ndiv[class*=\"from-surface-primary\"] {\n  background-image: linear-gradient(to bottom, #000 75%, rgb(0 0 0 / 0)) !important;\n}\n\n/* composer shell */\n[class*=\"rounded-[14px]\"] {\n  background: #0a0a0a !important;\n  border-color: #242424 !important;\n}\n[class*=\"rounded-[14px]\"]:focus-within {\n  border-color: #3a3a3a !important;\n  box-shadow: none !important;\n}\n\n/* sidebar rail */\nbutton[data-sidebar=\"rail\"] { background: transparent !important; }\nbutton[data-sidebar=\"rail\"]:hover { background: rgb(255 255 255 / .07) !important; }\n\n\n/* ---------- 6. CODE BLOCKS (keep your per-layer rules) ---------- */\n[data-streamdown=\"code-block\"] { border: 1px solid #1c1c1c !important; background: transparent !important; }\n[data-streamdown=\"code-block-header\"] { background: #0d0d0d !important; border: none !important; }\n[data-streamdown=\"code-block-body\"] { background: var(--nexus-code-bg) !important; }\ncode[data-streamdown=\"inline-code\"] { background: #1a1a1a !important; color: #fafafa !important; }\n\n\n/* ---------- 7. MESSAGE SURFACES ---------- */\n[data-agent-transcript-message=\"true\"] > div.bg-surface-primary.rounded-xl {\n  background: transparent !important;    /* assistant: flat on black */\n}\n[data-user-message-body-row=\"true\"] > div {\n  background: var(--nexus-bubble-bg) !important;\n  border: var(--nexus-bubble-border) !important;\n}\n\n\n/* ---------- 8. KILL ALL GLOWS / TINTS ---------- */\n* { text-shadow: none !important; }\n[data-perf-target=\"composer\"] ::selection { background: #7ab0ff33; }\n\n/* scrollbars */\n* { scrollbar-color: #2a2a2a #000; scrollbar-width: thin; }\n::-webkit-scrollbar { width: 10px; height: 10px; }\n::-webkit-scrollbar-track { background: #000; }\n::-webkit-scrollbar-thumb { background: #242424; border-radius: 6px; }\n::-webkit-scrollbar-thumb:hover { background: #333; }\n:root, html.dark, html.light, body { --text-primary: 0 0% 98%; \u2026 }\n\n/* was: max-width: 1108px, then later \u2026 { max-width: 100% !important } won */\nmax-width: var(--nexus-ai-width) !important;\n\n/* and overflow containment split off, so it can't fight the width */\nmain, .main-content, .chat-history \u2026 { overflow-x: hidden !important; }\n\n:root, html.dark, html.light, body { --nexus-code-bg: #050505 !important; }\n"
  },
  "arena": {
    "accentColor": "#0a64f5",
    "features": {
      "chatTitleSelector": "button[aria-haspopup=\"menu\"] > span[dir=\"auto\"].truncate",
      "attachmentSelector": "[data-perf-target=\"composer\"] input[type=\"file\"]",
      "promptNavSelector": "[data-agent-transcript-message=\"true\"][data-chat-message-id]:has(> [data-user-message-layout=\"true\"])",
      "composerSelector": "[data-perf-target=\"composer\"] div.ProseMirror[contenteditable=\"true\"]:not([aria-disabled=\"true\"])",
      "sendButtonSelector": "button[data-perf-target=\"send\"][aria-label=\"Send message\"]",
      "newChatSelector": "a[data-sidebar=\"menu-button\"][href=\"/agent\"]",
      "stopGenerationSelector": "button[data-perf-target=\"send\"][aria-label=\"Stop generating\"]",
      "assistantMessageSelector": "[data-agent-transcript-message=\"true\"][data-chat-message-id]:not(:has(> [data-user-message-layout=\"true\"])), [data-perf-target=\"transcript\"] [role=\"log\"] > div > div.rounded-xl:not([data-agent-transcript-message])",
      "streamingSelector": "button[data-perf-target=\"send\"][aria-label=\"Stop generating\"], [data-perf-target=\"transcript\"] [role=\"log\"] > div > div.rounded-xl:not([data-agent-transcript-message]), [data-perf-target=\"transcript\"] .animate-spin, [data-perf-target=\"sidebar_session\"] a[data-active=\"true\"] .animate-spin",
      "completionActionSelector": "[data-agent-transcript-message=\"true\"]:last-child > div > div > div.mt-3 button[aria-label=\"Copy\"]",
      "statusWatchdogTimeoutMs": 15000,
      "virtualizationSelector": "[data-agent-transcript-message=\"true\"][data-chat-message-id]"
    },
    "customCss": "/* ============================================================\n   ARENA.AI \u2014 OLED BLACK\n   Replaces the earlier transparency/scrim experiments.\n   Verified: text 20.10:1 on pure black, muted 6.27:1, accent 9.48:1\n   ============================================================ */\n\n/* ---------- 0. DELETE THESE FROM YOUR EXISTING CSS ----------\n   They are what's making it muddy \u2014 a neutral #202020 veil over a\n   warm app, plus a blue-tinted bubble.\n\n   main.bg-background,\n   div[data-sidebar=\"sidebar\"] { background: rgb(37 37 35 / .55) !important;\n                                 backdrop-filter: blur(10px); }\n   --nexus-surface: transparent\n   --nexus-bg: transparent\n   --nexus-bubble-bg: linear-gradient(135deg, hsl(24 6% 22%) ...)\n   --nexus-composer-focus-* (the blue glow)\n\n   Your pasted block is also duplicated (every rule appears twice).\n   Keep one copy only.\n   ------------------------------------------------------------ */\n\n\n/* ---------- 1. SURFACES: pure black with OLED-safe elevation ---------- */\n:root, body {\n  color-scheme: dark;\n\n  --background:        0 0% 0%;      /* #000000 */\n  --surface-primary:   0 0% 0%;      /* #000000 */\n  --surface-secondary: 0 0% 4%;      /* #0a0a0a */\n  --surface-tertiary:  0 0% 7%;      /* #121212 */\n  --surface-raised:    0 0% 10%;     /* #1a1a1a */\n  --surface-raised-alt:0 0% 10%;\n  --surface-floating:  0 0% 8%;\n  --surface-highlight: 0 0% 12%;\n  --surface-skeleton:  0 0% 8%;\n\n  --sidebar-background: 0 0% 0%;\n  --sidebar-accent:     0 0% 8%;\n  --sidebar-border:     0 0% 14%;\n\n  --card:     0 0% 3%;\n  --popover:  0 0% 3%;\n  --secondary:0 0% 6%;\n  --muted:    0 0% 10%;\n  --accent:   0 0% 10%;\n\n  /* Nexus-native tokens */\n  --nexus-bg:       #000000;\n  --nexus-surface:  #000000;\n  --nexus-surface2: #0a0a0a;\n\n  /* user bubble \u2014 neutral, no blue */\n  --nexus-bubble-bg:       #141414;\n  --nexus-bubble-bg-color: #141414;\n  --nexus-bubble-border:   1px solid #262626;\n  --nexus-bubble-shadow:   none;\n\n  /* code */\n  --nexus-code-bg:     #050505;\n  --nexus-code-border: 1px solid #1c1c1c;\n  --nexus-code-shadow: none;\n\n  /* composer \u2014 no blue glow */\n  --nexus-composer-focus-border:        1px solid #2a2a2a;\n  --nexus-composer-focus-border-bottom: none;\n  --nexus-composer-focus-shadow:        none;\n}\n\nhtml, body { background: #000 !important; }\n\n\n/* ---------- 2. BORDERS: OLED needs them subtle but visible ---------- */\n:root, body {\n  --border:        0 0% 12%;\n  --border-faint:  0 0% 12%;\n  --border-medium: 0 0% 18%;\n  --border-strong: 0 0% 26%;\n  --input:         0 0% 98% / 20%;\n  --ring:          0 0% 30%;\n}\n\n\n/* ---------- 3. TEXT: neutral grey ramp, no warm cast ---------- */\n:root, body {\n  --text-primary:     0 0% 98%;      /* 20.10:1 */\n  --text-secondary:   0 0% 80%;      /* 13.08:1 */\n  --text-tertiary:    0 0% 66%;      /*  8.86:1 */\n  --text-placeholder: 0 0% 98% / 45%;/*  4.27:1  (raise to /55% for 5.5:1) */\n  --foreground:        0 0% 98%;\n  --card-foreground:   0 0% 98%;\n  --popover-foreground:0 0% 98%;\n  --sidebar-foreground:0 0% 90%;\n  --secondary-foreground:0 0% 90%;\n  --muted-foreground:  0 0% 55%;\n  --accent-foreground: 0 0% 95%;\n\n  --nexus-text:  #fafafa;\n  --nexus-text2: #a1a1aa;\n  --interactive-normal:   0 0% 90%;\n  --interactive-active:   0 0% 100%;\n  --header-primary:       0 0% 98%;\n  --header-secondary:     0 0% 78%;\n}\n\n\n/* ---------- 4. ACCENT: one cool blue for everything interactive ---------- */\n:root, body {\n  --nexus-accent:      #7ab0ff;   /* 9.48:1 on #000 */\n  --interactive-link:  210 100% 66%;\n  --primary:           0 0% 98%;  /* white send button */\n  --primary-foreground:0 0% 0%;\n  --interactive-cta:        0 0% 98%;\n  --interactive-on-cta:     0 0% 0%;\n  --interactive-cta-hover:  0 0% 88%;\n  --interactive-cta-secondary:      0 0% 8%;\n  --interactive-cta-secondary-hover:0 0% 14%;\n  --interactive-cta-focus:  0 0% 40%;\n  --highlight-background: 0 0% 100%;\n  --highlight-text:       0 0% 0%;\n}\n\n\n/* ---------- 5. SURFACE PAINTS ---------- */\nmain.bg-background,\ndiv[data-sidebar=\"sidebar\"],\ndiv[data-sidebar=\"content\"],\ndiv[data-sidebar=\"footer\"],\ndiv[class*=\"sidebar-wrapper\"] { background: #000 !important; }\n\n/* header gradient must not fade to a grey \u2014 fade to black */\ndiv[class*=\"from-surface-primary\"] {\n  background-image: linear-gradient(to bottom, #000 75%, rgb(0 0 0 / 0)) !important;\n}\n\n/* composer shell */\n[class*=\"rounded-[14px]\"] {\n  background: #0a0a0a !important;\n  border-color: #242424 !important;\n}\n[class*=\"rounded-[14px]\"]:focus-within {\n  border-color: #3a3a3a !important;\n  box-shadow: none !important;\n}\n\n/* sidebar rail */\nbutton[data-sidebar=\"rail\"] { background: transparent !important; }\nbutton[data-sidebar=\"rail\"]:hover { background: rgb(255 255 255 / .07) !important; }\n\n\n/* ---------- 6. CODE BLOCKS (keep your per-layer rules) ---------- */\n[data-streamdown=\"code-block\"] { border: 1px solid #1c1c1c !important; background: transparent !important; }\n[data-streamdown=\"code-block-header\"] { background: #0d0d0d !important; border: none !important; }\n[data-streamdown=\"code-block-body\"] { background: var(--nexus-code-bg) !important; }\ncode[data-streamdown=\"inline-code\"] { background: #1a1a1a !important; color: #fafafa !important; }\n\n\n/* ---------- 7. MESSAGE SURFACES ---------- */\n[data-agent-transcript-message=\"true\"] > div.bg-surface-primary.rounded-xl {\n  background: transparent !important;    /* assistant: flat on black */\n}\n[data-user-message-body-row=\"true\"] > div {\n  background: var(--nexus-bubble-bg) !important;\n  border: var(--nexus-bubble-border) !important;\n}\n\n\n/* ---------- 8. KILL ALL GLOWS / TINTS ---------- */\n* { text-shadow: none !important; }\n[data-perf-target=\"composer\"] ::selection { background: #7ab0ff33; }\n\n/* scrollbars */\n* { scrollbar-color: #2a2a2a #000; scrollbar-width: thin; }\n::-webkit-scrollbar { width: 10px; height: 10px; }\n::-webkit-scrollbar-track { background: #000; }\n::-webkit-scrollbar-thumb { background: #242424; border-radius: 6px; }\n::-webkit-scrollbar-thumb:hover { background: #333; }\n:root, html.dark, html.light, body { --text-primary: 0 0% 98%; \u2026 }\n\n/* was: max-width: 1108px, then later \u2026 { max-width: 100% !important } won */\nmax-width: var(--nexus-ai-width) !important;\n\n/* and overflow containment split off, so it can't fight the width */\nmain, .main-content, .chat-history \u2026 { overflow-x: hidden !important; }\n\n:root, html.dark, html.light, body { --nexus-code-bg: #050505 !important; }\n"
  }
}
