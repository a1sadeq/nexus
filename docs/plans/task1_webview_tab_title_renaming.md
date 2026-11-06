# Task 1 Plan: AI Webview Tabs Dynamic Title Renaming & Synchronization Engine (1.0.3 Heritage)

## 1. Problem Statement & User Direction
The user reported:
> "the AI webview tabs titles doesn't get renamed correctly its stands by default name before it was perfect ."
> "learn from 1.03 release it had good tabs title naming"
> "i meant it has the best tabs titles names that are accurate of the seission's title in the ai web view"

In release 1.0.3, tabs accurately reflected the true conversation/session title from the active chat inside the AI web view (e.g. "Quantum Computing Basics", "Fix Electron WASD Zoom", "Audit Plan v3"). In recent updates, tabs became stuck on generic default names ("ChatGPT", "Gemini", "New Chat") or dropped title updates.

---

## 2. Deep Comparison: Release 1.0.3 vs Current Head

### Finding 1: The Gemini Selector Regression
- **In v1.0.3 (`src/shared/providerConfig.ts` line 184)**:
  ```typescript
  gemini: {
    chatTitleSelector: '.conversation-title, .chat-title-text, [data-test-id="conversation-title"]',
    defaultChatTitles: ['Gemini', 'Google Gemini', 'New chat', 'Untitled conversation'],
  }
  ```
  This worked reliably because `gemini.google.com` dynamically renders active chat titles in elements with `.conversation-title` and `[data-test-id="conversation-title"]`.
- **In Current Head & User Config (`~/.config/nexus/providers.json` line 58)**:
  `chatTitleSelector` was corrupted to `"#radix-_r_gr_ > span"`.
  Radix UI is not used by Gemini (Gemini uses Angular/Lit Web Components). Querying `#radix-...` returns `null` on 100% of ticks. As a result, Gemini's in-guest title poller never updated `document.title`, and the tab stayed stuck on `"Gemini"` forever.

### Finding 2: Destructive Provider Overrides in `getMergedProviderFeatures`
- In [src/shared/providerConfig.ts](file:///home/elsadek/vicinae/nexus%20electron/src/shared/providerConfig.ts#L312-L315):
  `{ ...defaults, ...globalUser, ...user }`
  When `user.chatTitleSelector` was set to the broken `#radix` string, it completely discarded the built-in tested selectors from 1.0.3 instead of falling back to them.

### Finding 3: Premature Discarding of Provider-Prefixed Titles
- Both `shouldIgnoreProviderTitle()` in `src/main/index.ts` and `checkIsDefaultTitle()` in `src/renderer/src/App.tsx` treated `titleLower.startsWith(defaultLower + ' -')` as a reason to discard the title or reject the update.
- When providers output `"Kimi - Fix WASD Zoom"` or `"ChatGPT - Quantum Logic"`, the title was treated as default noise rather than extracting the session title.

---

## 3. Targeted Solution (Restoring & Enhancing 1.0.3 Accurate Session Naming)

### 3.1. Restore Proven 1.0.3 Selectors for All Providers
Ensure `src/shared/providerConfig.ts` and `src/shared/defaultProviderConfig.ts` have the battle-tested 1.0.3 selectors:
- **gemini**: `'.conversation-title, .chat-title-text, [data-test-id="conversation-title"], div[class*="conversation-title"], header h1'`
- **chatgpt**: `'nav a[class*="active"], nav [class*="bg-token-sidebar-surface-secondary"], header h1'`
- **claude**: `'[data-testid="chat-title"], header [class*="truncate"], nav a[class*="active"]'`
- **deepseek**: `'[class*="chat-title"], [class*="session-item-active"], header h2'`
- **perplexity**: `'header h1, [data-testid="thread-title"], [class*="thread-title"]'`
- **qwen**: `'.chat-item-drag-active .chat-item-drag-link-content-tip-text, .chat-item-active'`
- **kimi**: `'[class*="chat-item-active"] [class*="title"], header [class*="chat-title"]'`
- **arena**: `'button[aria-haspopup="menu"] > span[dir="auto"].truncate'`
- **z.ai**: `'[data-testid*="chat-title" i], header h1, nav a[aria-current="page"]'`

### 3.2. Clean Up `~/.config/nexus/providers.json`
Remove the bogus `"#radix-_r_gr_ > span"` entry from the user's `gemini` config in `~/.config/nexus/providers.json` so it adopts the authentic 1.0.3 selectors.

### 3.3. Clean Conversation Title Extractor
Implement `cleanConversationTitle(rawTitle, providerKey)`:
- Strips any provider prefixes (e.g. `"Kimi - Fix WASD Zoom"` -> `"Fix WASD Zoom"`, `"ChatGPT - Quantum Logic"` -> `"Quantum Logic"`).
- Preserves the exact, accurate session title extracted from the in-guest DOM or document title.
- Rejects true defaults (`"New Chat"`, `"Untitled"`, `"Loading"`, or bare provider name).

### 3.4. Resilient Fallbacks in `getMergedProviderFeatures`
If a user defines a custom selector, prepend it as a primary option while keeping the 1.0.3 selectors as fallbacks:
```typescript
chatTitleSelector: user.chatTitleSelector && defaults.chatTitleSelector
  ? `${user.chatTitleSelector}, ${defaults.chatTitleSelector}`
  : user.chatTitleSelector || defaults.chatTitleSelector
```

---

## 4. Verification Plan
- Unit tests verifying `cleanConversationTitle` and `getMergedProviderFeatures`.
- Live test on active webviews:
  - Gemini: Verify title updates to actual conversation name once prompt is answered.
  - ChatGPT / Claude / Kimi: Verify title updates cleanly without provider prefix.
  - Local history persistence captures accurate session titles.
