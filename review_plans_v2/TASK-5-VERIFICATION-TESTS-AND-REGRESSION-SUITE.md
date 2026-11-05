# TASK 5: Verification Tests & Regression Suite

## 1. Test Objectives
Ensure that the active provider resolution, Iron Man Arc-Reactor cockpit rendering, dynamic responsive collapse, and storage sanitization are covered with exhaustive, automated Vitest unit and integration tests.

---

## 2. Test Plan & Matrix

### A. Provider Resolution Tests (`src/renderer/src/lib/providerResolution.test.ts`)
1. **URL Domain Matching Matrix**:
   - `https://chat.z.ai/c/12345` -> resolves to `glm`
   - `https://z.ai` -> resolves to `glm`
   - `https://aistudio.google.com/prompts/new` -> resolves to `aistudio` / `geminiv2aistudio`
   - `https://arena.ai/` -> resolves to `arena-ai`
   - `https://chat.deepseek.com/` -> resolves to `deepseek`
   - `https://chatgpt.com/` -> resolves to `chatgpt`
   - `https://claude.ai/chat/abc` -> resolves to `claude`
   - `https://gemini.google.com/app` -> resolves to `gemini`
   - `https://chat.qwen.ai/` -> resolves to `qwen`
   - `https://kimi.ai/` -> resolves to `kimi`
2. **Alias Fallback Matrix**:
   - `tab.model = 'z.ai'` without URL -> resolves to `glm`
   - `tab.model = 'openai'` without URL -> resolves to `chatgpt`
   - `tab.model = 'arena'` without URL -> resolves to `arena-ai`
3. **Custom Model Host Matching**:
   - Custom model registered with URL `https://local-llm.internal:8080` matches tab with URL `https://local-llm.internal:8080/chat`.
4. **Resilience**:
   - Blank URLs, invalid URLs, undefined tabs return safe fallback model without throwing.

### B. Storage Sanitizer Tests (`src/renderer/src/lib/models.test.ts`)
1. **Legacy Dirty Icon Purge**:
   - Stored model containing legacy `<svg><path d="M12 8v8"/>...` has its dirty icon purged, allowing authentic BrandIcon rendering.
2. **Label Formatting**:
   - `GEMINIV2AISTUDIO` is converted to `AI Studio`.
   - `glm` label is formatted to `GLM`.
3. **Preservation**:
   - Custom user models with custom URLs and non-dirty icons are 100% preserved.

### C. Visual & Interaction Component Tests (`src/renderer/src/components/TitlebarModelPillar.test.tsx`)
1. **Active Provider Highlight**:
   - Active provider pill possesses `.active` class and sets `--provider-color` CSS property.
   - Contains `.active-core-dot` micro-reactor element.
2. **Dynamic Tier Collapsing**:
   - When collapsed, inactive pills hide text labels while active pill retains label.
3. **Keyboard Roving Tabindex**:
   - Arrow navigation, Home/End navigation dispatches model selection and updates focus.
4. **CSS Verification**:
   - Verifies `-webkit-app-region: no-drag !important;` is enforced.
   - Verifies keyframes animate only `opacity` and `transform`.

---

## 3. Execution Commands
```bash
# 1. Typecheck Node and Web targets
npm run typecheck

# 2. Run the complete test suite
npx vitest run

# 3. Production build
npm run build
```

---

## 4. Acceptance Criteria
- [ ] 0 TypeScript errors.
- [ ] 100% of tests pass across all test suites.
- [ ] Build outputs generated cleanly in `out/main`, `out/preload`, `out/renderer`.
