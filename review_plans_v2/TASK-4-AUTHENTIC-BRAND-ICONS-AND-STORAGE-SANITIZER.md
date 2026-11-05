# TASK 4: Authentic Brand Icons & Storage Legacy Sanitizer

## 1. Problem Statement
In the user's screenshot:
1. `QWEN` and `CHATGPT` render with a plus sign `+` inside a circle because their legacy `models` in `localStorage` contain outdated inline SVG strings (`<svg...><path d="M12 8v8"/><path d="M8 12h8"/></svg>`).
2. `ALBERT` has NO icon at all because `BrandIcon` returns `null` for unknown keys and no fallback SVG was provided.
3. `GEMINIV2AISTUDIO` renders as unformatted camelcase text with a duplicate gemini sparkle icon.
4. `GLM` renders with a generic blue block with the letter `Z`.

---

## 2. Authentic Vector Paths & Brand Mapping (`src/renderer/src/components/BrandIcons.tsx`)

Add strictly authentic, official SVG vector paths (Simple Icons / Brand guidelines) for all missing or misaligned providers:
1. **GLM / Z.ai (`glm`, `zai`, `z.ai`)**:
   - Authentic Zhipu / Z.ai geometric mark.
2. **Google AI Studio (`aistudio`, `geminiv2aistudio`, `gemini-v2-studio`)**:
   - Official Google AI Studio diamond/sparkle dual-tone vector.
3. **Albert (`albert`)**:
   - Authentic neural/hexagon vector mark.
4. **Qwen (`qwen`)**:
   - Ensure the authentic Alibaba Qwen hexagonal lattice node mark renders unconditionally.
5. **ChatGPT (`chatgpt`)**:
   - Ensure the official OpenAI Archimedean spiral vector renders unconditionally.

---

## 3. Storage Sanitizer & Label Formatter (`src/renderer/src/lib/models.ts`)

In `loadAndMigrateModels`, implement a sanitization pass:
```typescript
export function sanitizeModelDef(m: ModelDef): ModelDef {
  const key = m.key.toLowerCase().trim()
  
  // 1. Clean up messy legacy labels
  let label = m.label
  if (key === 'geminiv2aistudio' || key === 'aistudio' || label.toUpperCase() === 'GEMINIV2AISTUDIO') {
    label = 'AI Studio'
  } else if (key === 'glm' || key === 'zai' || label.toUpperCase() === 'GLM') {
    label = 'GLM'
  } else if (key === 'arena-ai' || key === 'arena') {
    label = 'Arena'
  }

  // 2. Purge dirty legacy inline SVG plus icons
  let icon = m.icon
  if (icon && (icon.includes('M12 8v8') || icon.includes('circle cx="12" cy="12" r="10"'))) {
    icon = undefined // Allows BrandIcon to render authentic vector
  }

  // 3. Brand accent color defaults
  const color = m.color || DOT_COLOR[key] || '#00e5ff'

  return { ...m, label, icon, color }
}
```

---

## 4. Brand Palette Synchronization (`src/renderer/src/lib/modelVisuals.ts`)
Update `DOT_COLOR` and `BRAND_IDS`:
```typescript
export const DOT_COLOR: Record<string, string> = {
  chatgpt: '#10a37f',
  claude: '#d97757',
  gemini: '#22d3ee',
  aistudio: '#1a73e8',
  'geminiv2aistudio': '#1a73e8',
  perplexity: '#22b8cd',
  deepseek: '#4d6bfe',
  kimi: '#00d1b2',
  qwen: '#615ced',
  'arena-ai': '#f59e0b',
  arena: '#f59e0b',
  glm: '#1055ff',
  'z.ai': '#1055ff',
  zai: '#1055ff',
  albert: '#a855f7'
}
```

---

## 5. Acceptance Criteria
- [ ] No more plus `+` icons for Qwen or ChatGPT; authentic brand vector paths render crisply.
- [ ] `GLM` renders authentic Z.ai vector path.
- [ ] `GEMINIV2AISTUDIO` displays as clean `AI Studio` with dedicated vector icon.
- [ ] `Albert` displays dedicated vector icon and purple accent color.
- [ ] Sanitizer runs transparently on app load without wiping user custom models or bookmarks.
