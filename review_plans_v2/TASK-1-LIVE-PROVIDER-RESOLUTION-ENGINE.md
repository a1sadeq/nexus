# TASK 1: Live Provider Resolution Engine & Active State Synchronization

## 1. Problem Statement & Root Cause
In the user's running environment (as evidenced in the uploaded screenshot), Tab 7 was actively selected with title `Nexus Build Plans Reviewer` and running `https://chat.z.ai/` (GLM-5.3). However, **none** of the provider pills in the titlebar were highlighted or active.

### Root Cause Analysis:
1. **Disconnected Model Key Binding**:
   In [`src/renderer/src/App.tsx`](file:///home/elsadek/vicinae/nexus%20electron/src/renderer/src/App.tsx#L1386):
   ```tsx
   activeModelKey={tabs.find((t) => t.id === activeId)?.model || 'gemini'}
   ```
   `tabs.find(...).model` stores the key assigned at creation time. If the tab was created with `'z.ai'` or `'custom-z-ai'` or `'gemini'` and then navigated to `chat.z.ai`, `tab.model` remains stale because `onUrl` only updates `tab.url`, never `tab.model`.
2. **Key vs Alias Mismatch**:
   In the user's `models` array, the provider key is `'glm'`. In provider features and tab URLs, the provider is identified as `'z.ai'`, `'zai'`, or host `chat.z.ai`. Because `'z.ai' !== 'glm'`, `m.key === activeModelKey` evaluated to `false`, leaving every pill in an inactive state.
3. **No Dynamic URL-Aware Resolution**:
   The titlebar had no mechanism to detect that a tab loaded at `https://chat.z.ai/...` belongs to the `GLM` / `z.ai` provider.

---

## 2. Technical Architecture & Solution

### A. Live Provider Resolution (`src/renderer/src/lib/providerResolution.ts`)
Create a leaf resolution module with zero side effects:
```typescript
export interface ProviderDomainRule {
  key: string
  aliases: string[]
  hosts: string[]
}

export const KNOWN_PROVIDER_RULES: ProviderDomainRule[] = [
  { key: 'chatgpt', aliases: ['openai', 'chatgpt-4'], hosts: ['chatgpt.com', 'oaistatic.com', 'openai.com'] },
  { key: 'claude', aliases: ['anthropic'], hosts: ['claude.ai'] },
  { key: 'gemini', aliases: ['google-gemini'], hosts: ['gemini.google.com'] },
  { key: 'aistudio', aliases: ['geminiv2aistudio', 'gemini-v2-studio', 'google-ai-studio'], hosts: ['aistudio.google.com'] },
  { key: 'deepseek', aliases: ['deepseek-chat'], hosts: ['chat.deepseek.com', 'deepseek.com'] },
  { key: 'perplexity', aliases: ['pplx'], hosts: ['perplexity.ai', 'www.perplexity.ai'] },
  { key: 'qwen', aliases: ['tongyi', 'qwen-studio'], hosts: ['chat.qwen.ai', 'qwen.ai', 'tongyi.aliyun.com'] },
  { key: 'kimi', aliases: ['moonshot'], hosts: ['kimi.ai', 'kimi.moonshot.cn'] },
  { key: 'arena-ai', aliases: ['arena', 'lmsys'], hosts: ['arena.ai', 'lmarena.ai'] },
  { key: 'glm', aliases: ['z.ai', 'zai', 'z-ai', 'zhipu'], hosts: ['chat.z.ai', 'z.ai', 'open.bigmodel.cn'] }
]
```

### B. Resolution Algorithm (`resolveActiveProviderKey`):
1. **Host-Based Resolution (Primary)**:
   Extract hostname from `activeTab.url` (e.g. `https://chat.z.ai/c/123` -> `chat.z.ai`).
   - Match against `KNOWN_PROVIDER_RULES.hosts`. If matched, return the canonical key or find a configured model whose `key` or `url` matches.
   - For custom user-added models: match `new URL(model.url).hostname === activeHost`.
2. **Model Key & Alias Resolution (Secondary)**:
   If URL matching fails (e.g. blank page or loading screen), inspect `activeTab.model`. Check if it matches any model `key` directly or via `KNOWN_PROVIDER_RULES.aliases`.
3. **Deterministic Fallback (Tertiary)**:
   If still unresolved, fallback to `models[0]?.key || 'gemini'`.

### C. Live URL Hook in `App.tsx`:
In `onUrl` event listener:
```typescript
const resolvedKey = resolveActiveProviderKey({ ...existing, url }, models)
const nextTabs = prev.map((t) => (t.id === tabId && url ? { ...t, url, model: resolvedKey } : t))
```
This guarantees that whenever any tab navigates to any provider domain, its `model` state is synchronized immediately across the entire app.

---

## 3. Deployment & Tab Switching (`handleDeployModel`)
When a user clicks any provider pill in the titlebar:
1. If an existing tab for that provider is already open, switch to it (`switchToTab(existing.id)`).
2. If no tab exists, create and deploy a new chat tab for that provider (`handleNewChat(providerKey)`).
3. Immediate visual focus and roving tabindex update.

---

## 4. Acceptance Criteria
- [ ] Tab with URL `https://chat.z.ai/` automatically activates the `GLM` / `z.ai` provider pill in the titlebar.
- [ ] Tab with URL `https://aistudio.google.com/` activates the `AI Studio` pill.
- [ ] Tab with URL `https://arena.ai/` activates the `Arena` pill.
- [ ] Clicking a pill deploys or switches to the corresponding provider.
- [ ] 100% unit test coverage for domain matching, alias resolution, and edge-case URLs.
