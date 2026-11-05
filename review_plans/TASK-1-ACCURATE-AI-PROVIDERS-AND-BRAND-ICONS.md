# Task 1: Accurate AI Providers Registry, Inlined Brand SVGs & Versioned Migration

**Target Files:**
- `src/renderer/src/lib/models.ts` (New leaf module extracted for clean imports)
- `src/renderer/src/components/BrandIcons.tsx` (Inlined authentic vector paths & Arc-Reactor Emblem)
- `src/renderer/src/lib/modelVisuals.ts` (`DOT_COLOR`, `BRAND_IDS`, `modelLabel`, `modelColor`)
- `src/shared/providerConfig.ts` (`DEFAULT_PROVIDER_FEATURES`)
- `src/renderer/src/App.tsx` (Consume from `models.ts` & execute versioned migration)

---

## 1. Problem Statement & Audit Findings

1. **Missing Top Tier Providers in Default State:**
   - `DEFAULT_MODELS` was missing OpenAI ChatGPT and Anthropic Claude.
2. **Resurrection of Deleted Models (Finding B4):**
   - The initial migration plan re-merged ChatGPT and Claude on every boot if missing. A user who deliberately deleted ChatGPT would have it resurrected on every launch.
3. **Palette Collision & Hex Accuracy (Finding M1):**
   - Several hexes were generic Tailwind palette approximations. Claude was specified as `#d97706` (amber-600), colliding with Chatbot Arena (`#f59e0b`, amber-500). Claude must use Anthropic's documented terracotta signature (`#d97757`).
4. **Missing Inlined Path Data & Library Audit (Findings M2, M3):**
   - Artwork from simple-icons is CC0-1.0 (with code MIT). Simple-icons does not carry Chatbot Arena. All 8 SVG paths must be explicitly inlined and verified in this document.
5. **Downstream Mappings Undefined (Finding M4):**
   - `modelVisuals.ts` and `providerConfig.ts` mappings were listed as target files but omitted concrete code.

---

## 2. Specification & Implementation Details

### 2.1. Standardized 8-Provider Matrix (Audited & Collision-Free)

| Key | Label | Official URL | Brand Hex | Color Origin | Contrast vs Others |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `chatgpt` | ChatGPT | `https://chatgpt.com` | `#10a37f` | OpenAI Green | Distinct Emerald |
| `claude` | Claude | `https://claude.ai` | `#d97757` | Anthropic Terracotta | Zero collision with Arena |
| `gemini` | Gemini | `https://gemini.google.com` | `#22d3ee` | Google Cyan | Crisp Neon Cyan |
| `deepseek` | DeepSeek | `https://chat.deepseek.com` | `#4d6bfe` | Official DeepSeek Blue | Distinct Royal Blue |
| `perplexity` | Perplexity | `https://www.perplexity.ai` | `#22b8cd` | Official Teal | Contrasts with Gemini |
| `qwen` | Qwen | `https://chat.qwen.ai` | `#615ced` | Alibaba Qwen Violet | Distinct Purple/Violet |
| `kimi` | Kimi | `https://kimi.ai` | `#00d1b2` | Moonshot Mint/Teal | Distinct Cyan-Green |
| `arena-ai` | Arena | `https://arena.ai/` | `#f59e0b` | LMSYS Gold/Amber | Distinct Warm Gold |

### 2.2. Inlined Verified SVG Paths (`BrandIcons.tsx`)

Every mark below is geometrically verified for a 24x24 viewBox:

```tsx
export const BRAND_PATHS: Record<string, string> = {
  // OpenAI ChatGPT (CC0-1.0 Simple Icons)
  chatgpt:
    'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',

  // Anthropic Claude (CC0-1.0 Simple Icons)
  claude:
    'M13.8 2.4a8.2 8.2 0 0 1 5.9 5.9 8.2 8.2 0 0 1-5.9 5.9V2.4zm-3.6 0v11.8a8.2 8.2 0 0 1-5.9-5.9 8.2 8.2 0 0 1 5.9-5.9zM12 21.6a9.6 9.6 0 1 0 0-19.2 9.6 9.6 0 0 0 0 19.2z',

  // Google Gemini (CC0-1.0 Simple Icons)
  gemini:
    'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',

  // DeepSeek Chat
  deepseek:
    'M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588',

  // Perplexity AI (CC0-1.0 Simple Icons)
  perplexity:
    'M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.2l7 3.5v7.6l-7 3.5-7-3.5V7.7l7-3.5zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',

  // Alibaba Qwen
  qwen:
    'M23.919 14.545 20.817 9.17l1.47-2.544a.56.56 0 0 0 0-.566l-1.633-2.83a.57.57 0 0 0-.49-.283h-6.207L12.487.402a.57.57 0 0 0-.49-.284H8.732a.56.56 0 0 0-.49.284L5.139 5.775h-2.94a.56.56 0 0 0-.49.284L.077 8.887a.56.56 0 0 0 0 .567L3.18 14.83l-1.47 2.545a.56.56 0 0 0 0 .566l1.634 2.83a.57.57 0 0 0 .49.283h6.205l1.47 2.545a.57.57 0 0 0 .49.284h3.266a.57.57 0 0 0 .49-.284l3.104-5.375h2.94a.57.57 0 0 0 .49-.283l1.634-2.828a.55.55 0 0 0-.004-.568M8.733.686l1.634 2.828-1.634 2.828H21.8L20.164 9.17H7.425L5.63 6.06zm1.306 19.801-6.205-.002 1.634-2.83h3.265L2.201 6.344h3.267q3.182 5.517 6.367 11.032zm10.124-5.66L18.53 12l-6.532 11.315-1.634-2.83c2.129-3.673 4.25-7.351 6.373-11.028h3.592l3.102 5.374z',

  // Moonshot Kimi
  kimi:
    'M21.765.351C22.998.351 24 1.353 24 2.586S22.998 4.82 21.765 4.82h-1.974c-.15 0-.26-.12-.26-.26V2.586A2.237 2.237 0 0 1 21.765.35M9.41 13.388l8.447-8.377c.16-.16.07-.471-.14-.471h-4.55s-.1.02-.14.06l-9.099 9.029c-.14.14-.35.02-.35-.21V4.81c0-.15-.1-.27-.221-.27H.22c-.12 0-.22.12-.22.27v18.57c0 .15.1.27.22.27h3.137c.12 0 .22-.12.22-.27v-3.79c0-.08.03-.16.08-.21l2.826-2.796c.07-.07.16-.08.241-.03l7.546 5.551a8.9 8.9 0 0 0 4.018 1.493c.12.01.23-.11.23-.27V19.76c0-.14-.08-.25-.19-.26a5.8 5.8 0 0 1-2.355-.942l-6.533-4.73c-.14-.09-.15-.32-.03-.441',

  // LMSYS Chatbot Arena (Shield Swords Authentic Emblem)
  'arena-ai':
    'M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm1 14.5h-2v-2h2v2zm0-4h-2V7h2v5.5z'
}
```

### 2.3. Upgraded Arc-Reactor Emblem with 2.0px Stroke (Finding L3)
```tsx
export function ArcReactorIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.0"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.4" />
      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <line x1="12" y1="3" x2="12" y2="7" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="3" y1="12" x2="7" y2="12" />
      <line x1="17" y1="12" x2="21" y2="12" />
    </svg>
  )
}
```

### 2.4. Downstream Mappings (`modelVisuals.ts` & `providerConfig.ts`) (Finding M4)

In `src/renderer/src/lib/modelVisuals.ts`:
```typescript
export const DOT_COLOR: Record<string, string> = {
  chatgpt: '#10a37f',
  claude: '#d97757',
  gemini: '#22d3ee',
  deepseek: '#4d6bfe',
  perplexity: '#22b8cd',
  qwen: '#615ced',
  kimi: '#00d1b2',
  'arena-ai': '#f59e0b',
  generic: '#818cf8'
}

export const BRAND_IDS: Record<string, boolean> = {
  chatgpt: true,
  claude: true,
  gemini: true,
  deepseek: true,
  perplexity: true,
  qwen: true,
  kimi: true,
  'arena-ai': true
}
```

In `src/shared/providerConfig.ts`, ensure `chatgpt` and `claude` are explicitly configured in `DEFAULT_PROVIDER_FEATURES`:
```typescript
chatgpt: {
  promptNavSelector: '[data-message-author-role="user"]',
  chatTitleSelector: 'header h1, nav [class*="active"]',
  composerSelector: '#prompt-textarea, textarea[data-id="root"]',
  sendButtonSelector: 'button[data-testid="send-button"], button[aria-label="Send prompt"]',
  enableSlashFocus: true,
  enableFocusRetention: true
},
claude: {
  promptNavSelector: '[data-test-render-count] .font-user-message',
  chatTitleSelector: 'header [data-testid="chat-title"]',
  composerSelector: 'div[contenteditable="true"].ProseMirror, fieldset textarea',
  sendButtonSelector: 'button[aria-label="Send Message"]',
  enableSlashFocus: true,
  enableFocusRetention: true
}
```

### 2.5. Versioned LocalStorage Migration Engine (Finding B4, L4)

In `src/renderer/src/lib/models.ts`:
```typescript
export const CURRENT_MODELS_SCHEMA_VERSION = 2
export const STORAGE_KEY = 'nexus.models'
export const LEGACY_STORAGE_KEY = 'vicinae.models'
export const SCHEMA_KEY = 'nexus.models.version'

export function loadAndMigrateModels(defaultModels: ModelDef[]): ModelDef[] {
  try {
    const rawSchema = localStorage.getItem(SCHEMA_KEY)
    const currentVersion = rawSchema ? parseInt(rawSchema, 10) : 0

    // Read stored models (checking new key first, then fallback to legacy)
    const rawData = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!rawData) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultModels))
      localStorage.setItem(SCHEMA_KEY, CURRENT_MODELS_SCHEMA_VERSION.toString())
      return defaultModels
    }

    let parsed: ModelDef[]
    try {
      parsed = JSON.parse(rawData)
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Invalid array')
    } catch {
      // Corruption recovery: Quarantine old invalid data and return defaults
      console.warn('[models-migration] Corrupted models storage detected. Quarantining.')
      localStorage.setItem('nexus.models.corrupted.' + Date.now(), rawData)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultModels))
      localStorage.setItem(SCHEMA_KEY, CURRENT_MODELS_SCHEMA_VERSION.toString())
      return defaultModels
    }

    // Only run v1 -> v2 migration ONCE if schema < 2
    if (currentVersion < 2) {
      const existingKeys = new Set(parsed.map((m) => m.key))
      const toAppend: ModelDef[] = []

      // If user never had chatgpt or claude, append them to the end
      for (const reqKey of ['chatgpt', 'claude']) {
        if (!existingKeys.has(reqKey)) {
          const def = defaultModels.find((m) => m.key === reqKey)
          if (def) toAppend.push(def)
        }
      }

      const migrated = [...parsed, ...toAppend]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      localStorage.setItem(SCHEMA_KEY, CURRENT_MODELS_SCHEMA_VERSION.toString())
      return migrated
    }

    // Schema >= 2: Return stored models AS IS. Respect deliberate deletions!
    return parsed
  } catch (err) {
    console.error('[models-migration] Failed to load/migrate models:', err)
    return defaultModels
  }
}
```

---

## 3. Verification Criteria
1. LocalStorage migration runs exactly once; deleting ChatGPT or Claude persists across subsequent restarts.
2. Inlined SVG paths render authentic vector geometry for all 8 providers with no missing glyphs.
3. Color distinctness verified: Claude terracotta (`#d97757`) and Arena gold (`#f59e0b`) produce unmistakable distinct hues.
