import type { InterfaceSettings } from './interfaceSettings'
import type { ThemeColors } from './themes'
import type { ProviderOverrides, ProviderFeatureConfig } from '../../../shared/providerConfig'

export interface PromptGenParams {
  providerName?: string
  providerUrl?: string
  themeName?: string
  colors?: ThemeColors
  interfaceSettings?: InterfaceSettings
  providerOverrides?: ProviderOverrides
  liveDomHtml?: string
  computedCss?: string
}


export function generateAiThemingPrompt(params: PromptGenParams): string {
  const name = params.providerName || 'Target AI Provider (e.g. z.ai)'
  const url = params.providerUrl || 'https://z.ai'

  const computedCssSection = params.computedCss
    ? `## 📋 2. COMPUTED NEXUS BASELINE CSS\nBelow is the full CSS stylesheet computed by Nexus for **${name}** using the active theme variables. Your CSS will be layered on top of (or extend) these baseline rules:\n\n\`\`\`css\n${params.computedCss.trim()}\n\`\`\`\n`
    : ''

  const liveDomSection = params.liveDomHtml
    ? `## 📄 3. LIVE EXTRACTED CHAT DOM / HTML STRUCTURE\nBelow is the real, sanitized DOM hierarchy extracted directly from the live webview of **${name}** (${url}). Analyze the exact tag names, IDs, and CSS classes present in this HTML to craft 100% accurate, high-specificity selectors:\n\n\`\`\`html\n${params.liveDomHtml.trim()}\n\`\`\`\n`
    : `## 🔍 3. DOM INSPECTION INSTRUCTIONS\nSince no live DOM was provided, you MUST assume the standard elements for ${name}. If possible, ask the user for the HTML of the chat messages and composer.\n`

  const it = params.interfaceSettings
  const c = params.colors
  const tokenLines: string[] = []
  if (c?.bg) tokenLines.push(`- App canvas background (\`--nexus-bg\`): \`${c.bg}\``)
  if (c?.surface) tokenLines.push(`- Panel/sidebar surface (\`--nexus-surface\`): \`${c.surface}\``)
  if (c?.surface2) tokenLines.push(`- Elevated surface / bubbles (\`--nexus-surface2\`): \`${c.surface2}\``)
  if (c?.border) tokenLines.push(`- Border color (\`--nexus-border\`): \`${c.border}\``)
  if (c?.accent) tokenLines.push(`- Primary accent (\`--nexus-accent\`): \`${c.accent}\``)
  else if (it?.accentColor) tokenLines.push(`- Primary accent (\`--nexus-accent\`): \`${it.accentColor}\``)
  if (it?.accentGlowColor) tokenLines.push(`- Accent glow / secondary highlight: \`${it.accentGlowColor}\``)
  if (c?.text) tokenLines.push(`- Primary text (\`--nexus-text\`): \`${c.text}\``)
  if (c?.text2) tokenLines.push(`- Muted text (\`--nexus-text2\`): \`${c.text2}\``)
  if (typeof it?.cornerRadius === 'number') tokenLines.push(`- Corner radius (\`--radius\`): \`${it.cornerRadius}px\``)
  if (typeof it?.aiResponseWidthPx === 'number') tokenLines.push(`- AI response column max width: \`${it.aiResponseWidthPx}px\``)
  if (typeof it?.userPromptWidthPx === 'number') tokenLines.push(`- User prompt bubble max width: \`${it.userPromptWidthPx}px\``)
  if (typeof it?.messageGap === 'number') tokenLines.push(`- Vertical gap between messages: \`${it.messageGap}px\``)
  if (it?.webviewBubbleStyle) tokenLines.push(`- Bubble style preset: \`${it.webviewBubbleStyle}\``)
  if (it?.webviewCodeBlockStyle) tokenLines.push(`- Code block style preset: \`${it.webviewCodeBlockStyle}\``)
  const tokensSection = tokenLines.length
    ? `## 🎨 LIVE NEXUS THEME TOKENS (MATCH THESE EXACTLY)\nYour CSS must reuse these exact live values so the themed webview blends seamlessly with the surrounding Nexus chrome:\n\n${tokenLines.join('\n')}\n\n`
    : ''

  return `# MASTER AI THEMING SYSTEM PROMPT: NEXUS WORKSTATION DEEP STYLING

You are a World-Class Frontend CSS & Chromium Webview Theming Specialist for **Nexus**, a native AI desktop workstation.

## 🎯 OBJECTIVE
Your mission is to write comprehensive, pixel-perfect, site-specific CSS to deeply theme **"${name}"** (${url}) into the Nexus Dark/OLED/Porcelain Design System.

---

## 🎨 1. THE NEXUS DYNAMIC VARIABLE ARCHITECTURE
Nexus uses dynamic CSS variables that smoothly adapt between **Pure OLED Black (#000000)**, **Obsidian Midnight (#0b0c14)**, and **Soft Frosted Porcelain (#f8fafc / #ffffff)**:
- \`var(--nexus-bg)\`: Root canvas background
- \`var(--nexus-surface)\`: Sidebar, composer, and elevated panel backgrounds
- \`var(--nexus-surface2)\`: Chat bubble cards, thinking blocks, and scrollbars
- \`var(--nexus-border)\`: Adaptive glass border color
- \`var(--nexus-accent)\`: Primary brand accent color
- \`var(--nexus-text)\`: Primary text color (white in dark mode, deep charcoal in light mode)
- \`var(--nexus-text2)\`: Secondary/muted text color
- \`var(--radius)\`: Dynamic corner radius (e.g. 12px)

---

## 🛠️ 2. YOUR CSS ASSIGNMENT (EXACT PROPERTY BLOCKS TO APPLY)
You MUST map these EXACT CSS property blocks to the real classes of **${name}**. Do NOT hardcode static colors; use the variables precisely as shown below.

### 🏗️ A. MACRO SHELL & LAYOUT

#### 1. App Container & Background Transparency
Strip hardcoded backgrounds and neutralize stubborn utility classes (e.g. \`dark:bg-[#161616]\`, \`bg-[#f8f8f8]\`, \`bg-white\`) so the Nexus canvas and ambient aura shine through:
\`\`\`css
/* Replace .app-canvas with the actual root & scroll container selectors */
.app-canvas, .app-canvas > div, .app-canvas main, #messages-container {
  background-color: transparent !important;
  background-image: none !important;
}
.app-canvas [class*="dark:bg-[#161616]"],
.app-canvas [class*="bg-[#f8f8f8]"],
.app-canvas [class*="bg-white"] {
  background-color: transparent !important;
}
\`\`\`

#### 2. Central Chat Thread Column (Auto-Centering & Width)
Ensure the central conversation column is perfectly centered with no side voids:
\`\`\`css
/* Replace .chat-thread with the central messages wrapper selector */
.chat-thread {
  width: 100% !important;
  max-width: var(--nexus-ai-width) !important;
  margin-left: auto !important;
  margin-right: auto !important;
  box-sizing: border-box !important;
}
\`\`\`

#### 3. Sidebar Navigation Container
\`\`\`css
/* Replace .sidebar-container with the actual sidebar selector */
.sidebar-container {
  background-color: var(--nexus-surface) !important;
  border-right: 1px solid var(--nexus-border) !important;
  color: var(--nexus-text) !important;
}
\`\`\`

#### 4. Nav Bar / Top Header
\`\`\`css
/* Replace .nav-header with the top navigation bar selector */
.nav-header {
  background-color: var(--nexus-bg) !important;
  border-bottom: 1px solid var(--nexus-border) !important;
  color: var(--nexus-text) !important;
}
\`\`\`

#### 5. Model Selector Dropdown / Badge
\`\`\`css
/* Replace .model-badge with the model picker dropdown selector */
.model-badge {
  background-color: var(--nexus-surface) !important;
  color: var(--nexus-text) !important;
  border: 1px solid var(--nexus-border) !important;
  border-radius: var(--radius) !important;
}
\`\`\`

---

### 💬 B. CHAT MESSAGES & CONTENT

#### 6. User Message Bubbles
\`\`\`css
/* Replace .user-bubble with the human message card selector */
.user-bubble {
  background: var(--nexus-bubble-bg) !important;
  background-color: var(--nexus-bubble-bg-color) !important;
  background-image: var(--nexus-bubble-bg) !important;
  border: var(--nexus-bubble-border) !important;
  border-radius: var(--radius) !important;
  box-shadow: var(--nexus-bubble-shadow) !important;
  color: var(--nexus-text) !important;
  width: max-content !important;
  max-width: var(--nexus-user-width) !important;
  margin-left: auto !important;
  margin-right: 0 !important;
  margin-bottom: var(--nexus-message-gap) !important;
  padding: 12px 16px !important;
  word-break: break-word !important;
  overflow-wrap: break-word !important;
}
\`\`\`

#### 7. Assistant Message Container & Text
\`\`\`css
/* Replace .assistant-row with the AI message container selector */
.assistant-row {
  width: 100% !important;
  max-width: 100% !important;
  margin-bottom: var(--nexus-message-gap) !important;
  color: var(--nexus-text) !important;
}
\`\`\`

#### 8. Markdown Prose Typography
\`\`\`css
/* Replace .markdown-prose with the markdown content container selector */
.markdown-prose {
  color: var(--nexus-text) !important;
}
.markdown-prose p, .markdown-prose li, .markdown-prose span {
  color: inherit !important;
}
.markdown-prose h1, .markdown-prose h2, .markdown-prose h3, .markdown-prose h4 {
  color: var(--nexus-text) !important;
  font-weight: 700 !important;
}
.markdown-prose table, .markdown-prose th, .markdown-prose td {
  border-color: var(--nexus-border) !important;
}
\`\`\`

#### 9. Thinking / Reasoning Chain Block
\`\`\`css
/* Replace .thinking-block with the collapsible reasoning container selector */
.thinking-block {
  background-color: var(--nexus-surface2) !important;
  border: 1px solid var(--nexus-border) !important;
  border-radius: var(--radius) !important;
  color: var(--nexus-text2) !important;
}
\`\`\`

#### 10. Code Blocks
\`\`\`css
/* Replace .code-block with the pre / code block wrapper selector */
.code-block {
  background: var(--nexus-code-bg) !important;
  border: var(--nexus-code-border) !important;
  box-shadow: var(--nexus-code-shadow) !important;
  border-radius: var(--radius) !important;
  margin: var(--nexus-code-margin) !important;
  color: var(--nexus-text) !important;
  padding: 14px 18px !important;
  overflow-x: auto !important;
}
.code-block code {
  background: transparent !important;
  color: inherit !important;
  font-size: inherit !important;
  padding: 0 !important;
  border: none !important;
}
\`\`\`

---

### ✍️ C. COMPOSER & ACTIONS

#### 11. Composer (Chat Input)
\`\`\`css
/* Replace .composer-input with the chat textarea / input container selector */
.composer-input {
  background-color: var(--nexus-surface) !important;
  color: var(--nexus-text) !important;
  border: 1px solid var(--nexus-border) !important;
  border-radius: var(--radius) !important;
  transition: box-shadow 0.3s ease, border-color 0.3s ease !important;
}
form:focus-within .composer-input, .composer-input:focus {
  border: var(--nexus-composer-focus-border) !important;
  border-bottom: var(--nexus-composer-focus-border-bottom) !important;
  box-shadow: var(--nexus-composer-focus-shadow) !important;
  outline: none !important;
}
\`\`\`

#### 12. Send Button
\`\`\`css
/* Replace .send-btn with the submit / send prompt button selector */
.send-btn {
  background-color: var(--nexus-accent) !important;
  color: var(--nexus-bg) !important;
  border-radius: var(--radius) !important;
  border-color: transparent !important;
  box-shadow: 0 0 12px var(--nexus-accent) !important;
}
\`\`\`

#### 13. Action Buttons Toolbar
\`\`\`css
/* Replace .action-bar with the message action buttons container selector */
.action-bar {
  color: var(--nexus-text2) !important;
}
.action-bar button, .action-bar svg {
  color: var(--nexus-text2) !important;
}
.action-bar button:hover, .action-bar svg:hover {
  color: var(--nexus-accent) !important;
}
\`\`\`

---

${tokensSection}
${computedCssSection}
---

${liveDomSection}
---

## ⚡ 4. REQUIRED OUTPUT FORMATS

**FORMAT 1: Pure CSS** (primary output) — Provide your final output as a **single, raw \`\`\`css code block** utilizing \`var(--nexus-*)\` variables that directly targets the real classes found in the provided HTML/DOM. Implement ALL the exact styles from sections A, B, and C perfectly. Do NOT wrap it in JSON, JavaScript, or TypeScript objects. Just pure CSS that will be saved directly into \`customthemes.conf\` and injected into the webview.

**FORMAT 2: TypeScript ProviderTheme Definition** (only when explicitly requested) — Instead of CSS, export a \`ProviderTheme\` TypeScript object whose fields map the 13 selector areas (app container, chat thread, sidebar, nav bar, model badge, user message, AI message, markdown prose, thinking block, code block, composer, send button, action bar) to their selectors and Nexus color tokens. Use this format only when the user asks for a theme definition to compile into the app.`
}

export function generateThemeSelectorPrompt(params: PromptGenParams): string {
  const name = params.providerName || 'Target AI Provider (e.g. z.ai)'
  const url = params.providerUrl || 'https://z.ai'

  const liveDomSection = params.liveDomHtml
    ? `Below is the real, sanitized DOM hierarchy extracted directly from the live webview of **${name}** (${url}). Analyze the exact tag names, IDs, and CSS classes present in this HTML to craft high-specificity, accurate CSS selectors:\n\n\`\`\`html\n${params.liveDomHtml.trim()}\n\`\`\`\n`
    : `Please ask me to provide the HTML of the chat messages and composer for ${name}.\n`

  return `# NEXUS AI THEMING SYSTEM: DOM SELECTOR EXTRACTION

You are an expert Frontend Developer & DOM Analyst for **Nexus**, a native AI desktop workstation.
Nexus uses a "Dynamic Theme Engine" that automatically applies styles to AI webviews if it knows the correct CSS selectors for 13 specific areas of the app.

## 🎯 OBJECTIVE
Analyze the provided HTML DOM structure for **"${name}"** (${url}) and provide the exact CSS selectors needed for the 13 Nexus Theme Engine fields grouped into 3 sections.

---

## 📄 EXTRACTED HTML DOM
${liveDomSection}

---

## 🔍 SELECTORS TO FIND
Based on the HTML provided above, identify the most accurate and stable CSS selectors for the following 13 elements:

### 🏗️ Group A: Macro Shell & Layout
1. **App Container**: The main root background canvas of the app (e.g. \`#app, main, #chat-container\`). This needs to be made transparent so the Nexus background shines through.
2. **Chat Thread Wrapper**: The central column container wrapping the chat messages, controlling the max width of the thread (e.g. \`#messages-container, .max-w-3xl, .chat-column\`).
3. **Sidebar**: The native sidebar navigation drawer (e.g. \`#sidebar > div, aside\`).
4. **Nav Bar / Header**: The top navigation bar / drag region (e.g. \`nav.drag-region, header\`).
5. **Model Selector Badge**: The model picker dropdown button in the header/chat (e.g. \`[class*="model-selector"], div.model-badge\`).

### 💬 Group B: Chat Messages & Content
6. **User Message**: The wrapper element for the HUMAN's chat messages (e.g. \`.chat-user div.rounded-xl, [data-message-author-role="user"]\`).
7. **AI Message**: The wrapper element for the ASSISTANT's chat messages (e.g. \`.chat-assistant, .ai-message\`).
8. **Markdown Prose**: The inner formatted typography wrapper containing markdown text, headings, lists, and tables (e.g. \`.markdown-prose, .prose\`).
9. **Thinking Block**: The collapsible thought process or reasoning chain wrapper in AI responses (e.g. \`.thinking-chain-container, .thought-process\`).
10. **Code Block**: The \`pre\` tags or syntax-highlighted code block wrappers (e.g. \`[class^="language-"], pre, .code-wrapper\`).

### ✍️ Group C: Composer & Actions
11. **Composer (Chat Input)**: The chat prompt input container / textarea (e.g. \`#messages-container ~ div:last-child, textarea, form [contenteditable="true"]\`).
12. **Send Button**: The send/submit button for prompting (e.g. \`button[type="submit"], [class*="send"]\`).
13. **Action Buttons / Toolbar**: The message action toolbar for copy, regenerate, edit, and branch buttons (e.g. \`[class*="action-bar"], .message-actions\`).

## ⚡ OUTPUT FORMAT
Output your findings as an organized Markdown Table with columns: \`#\`, \`Section\`, \`Field Name\`, \`Selector\`, and \`Confidence\` matching these exact 13 names. Do NOT write full CSS rules. Just the selector strings.`
}

export interface FeaturePromptGenParams {
  providerName?: string
  providerUrl?: string
  currentFeatures?: ProviderFeatureConfig
  liveDomHtml?: string
}

export function generateFeatureHooksPrompt(params: FeaturePromptGenParams): string {
  const name = params.providerName || 'Target AI Provider'
  const url = params.providerUrl || 'https://example.com'

  const liveDomSection = params.liveDomHtml
    ? `## 📄 EXTRACTED LIVE HTML DOM\nBelow is the real, sanitized DOM hierarchy extracted directly from the active webview of **${name}** (${url}). Analyze the exact tag names, IDs, attributes, and CSS classes present in this HTML:\n\n\`\`\`html\n${params.liveDomHtml.trim()}\n\`\`\`\n`
    : `## 🔍 DOM INSPECTION INSTRUCTIONS\nSince no live DOM was extracted automatically, inspect the webview's developer tools or page source for **${name}** (${url}) to find the elements described below.\n`

  const existingConfig =
    params.currentFeatures && Object.keys(params.currentFeatures).length > 0
      ? `## ⚙️ CURRENT CONFIGURATION (UPDATE OR FILL IN GAPS)\n\`\`\`json\n${JSON.stringify(params.currentFeatures, null, 2)}\n\`\`\`\n`
      : ''

  return `# 🎯 NEXUS AI WEBVIEW AUTOMATION & HOOKS SELECTOR EXTRACTION

You are an expert Frontend Reverse Engineer & DOM Automation Specialist for **Nexus**, a high-performance native desktop AI workstation.
Nexus controls AI webviews through native Chromium DevTools Protocol (CDP) and DOM automation hooks to power desktop keyboard shortcuts, background sync, and smart integrations.

## 🎯 OBJECTIVE
Analyze the DOM structure of **"${name}"** (${url}) and provide the exact, robust, and stable CSS selectors required for the following 8 automation features:

### 1. File Upload / Attachment Input (\`attachmentSelector\`)
- **Purpose**: Powers native file upload (\`Ctrl+O\`) and codebase folder upload (\`Ctrl+Shift+O\`) with review modal & CDP injection.
- **Targets**: Hidden \`input[type="file"]\`, paperclip/attachment trigger button, or drag-and-drop dropzone.
- **Examples**: \`input[type="file"]\`, \`button[aria-label*="Attach"]\`, \`[data-testid*="upload"]\`

### 2. Alt+J / Alt+K Prompt Navigation (\`promptNavSelector\`)
- **Purpose**: Keyboard jumping backward (\`Alt+K\`) and forward (\`Alt+J\`) between user prompts in the conversation.
- **Targets**: Outer container element representing a user/human turn in the chat thread.
- **Examples**: \`[data-message-author-role="user"]\`, \`[data-testid="user-message"]\`, \`.user-query\`

### 3. Prompt Composer Input (\`composerSelector\`)
- **Purpose**: Focuses the input box on \`/\` hotkey and tab switching, and injects prompts from the skills palette.
- **Targets**: The main textarea or contenteditable element where prompts are typed.
- **Examples**: \`#prompt-textarea\`, \`.ProseMirror\`, \`textarea:not([disabled])\`

### 4. Send Button (\`sendButtonSelector\`)
- **Purpose**: Automatically clicks the send button when executing skills or prompts from the skills palette (\`Ctrl+S\`, \`Ctrl+Shift+S\`).
- **Targets**: The primary submit/send arrow button.
- **Examples**: \`button[data-testid="send-button"]\`, \`button[aria-label*="Send"]\`, \`button[type="submit"]\`

### 5. Chat Title Extractor (\`chatTitleSelector\`)
- **Purpose**: Syncs the conversation title from the webview into Nexus tab headers.
- **Targets**: Active conversation link in the sidebar or title heading in the chat header.
- **Examples**: \`nav a[class*="active"]\`, \`header h1\`, \`[data-testid*="chat-title"]\`

### 6. New Chat Button (\`newChatSelector\`)
- **Purpose**: Starts a fresh chat session from keyboard shortcuts (\`Ctrl+T\`).
- **Targets**: "+ New Chat" button or home logo link.
- **Examples**: \`a[href="/"]\`, \`button[aria-label*="New chat"]\`, \`[data-testid="new-chat-button"]\`

### 7. Stop Generation Button (\`stopGenerationSelector\`)
- **Purpose**: Stops streaming output when requested.
- **Targets**: The square stop button that appears while the model is responding.
- **Examples**: \`button[aria-label*="Stop"]\`, \`button.stop-btn\`

### 8. Memory Virtualization (\`virtualizationSelector\`)
- **Purpose**: Applies \`content-visibility: auto\` to off-screen messages to reduce RAM footprint in long threads.
- **Targets**: Repeated chat message container elements.
- **Examples**: \`[data-message-id]\`, \`.conversation-turn\`, \`.chat-message\`

---

${existingConfig}
${liveDomSection}
---

## ⚡ REQUIRED OUTPUT FORMAT
Return your response as a valid JSON object wrapped in a \`\`\`json code block with the exact keys:
\`\`\`json
{
  "attachmentSelector": "...",
  "promptNavSelector": "...",
  "composerSelector": "...",
  "sendButtonSelector": "...",
  "chatTitleSelector": "...",
  "newChatSelector": "...",
  "stopGenerationSelector": "...",
  "virtualizationSelector": "..."
}
\`\`\`
Along with a concise explanation of each chosen selector and why it is resilient to site updates.`
}

