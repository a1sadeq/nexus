# ⚡ Nexus Titlebar Pillar Overhaul — Engineering Specs & Action Plans (v2)

This directory contains the complete, dedicated architectural blueprints and task specifications to overhaul the **Titlebar AI Models Pillar**, resolve the active model detection breakdown, restore authentic brand vector marks, and elevate the UI to a genuine **Iron Man Arc-Reactor Cockpit**.

---

## 📂 Plan Files in this Directory

| Task File | Focus & Scope |
| :--- | :--- |
| [**`TASK-1-LIVE-PROVIDER-RESOLUTION-ENGINE.md`**](file:///home/elsadek/vicinae/nexus%20electron/review_plans_v2/TASK-1-LIVE-PROVIDER-RESOLUTION-ENGINE.md) | Resolves the root cause of inactive pills (GLM/Tab 7). URL domain matching, alias normalization, and live tab state synchronization. |
| [**`TASK-2-IRON-MAN-ARC-REACTOR-COCKPIT-STYLING.md`**](file:///home/elsadek/vicinae/nexus%20electron/review_plans_v2/TASK-2-IRON-MAN-ARC-REACTOR-COCKPIT-STYLING.md) | Frosted obsidian glass capsule, laser-cut glowing cyan border, Title Case typography, micro-reactor core indicator dot, and GPU compositor-only breathing glow. |
| [**`TASK-3-DYNAMIC-RESPONSIVE-DOCK-AND-TOOLTIPS.md`**](file:///home/elsadek/vicinae/nexus%20electron/review_plans_v2/TASK-3-DYNAMIC-RESPONSIVE-DOCK-AND-TOOLTIPS.md) | Dynamic responsive tiers: keeps active provider expanded with label, collapses inactive providers to sleek icon badges under space constraints, with instant HUD tooltips. |
| [**`TASK-4-AUTHENTIC-BRAND-ICONS-AND-STORAGE-SANITIZER.md`**](file:///home/elsadek/vicinae/nexus%20electron/review_plans_v2/TASK-4-AUTHENTIC-BRAND-ICONS-AND-STORAGE-SANITIZER.md) | Eliminates plus `+` icons on Qwen/ChatGPT by purging dirty legacy SVGs; introduces authentic vector paths for GLM (Z.ai), Google AI Studio, and Albert; cleans dirty labels (`GEMINIV2AISTUDIO` -> `AI Studio`). |
| [**`TASK-5-VERIFICATION-TESTS-AND-REGRESSION-SUITE.md`**](file:///home/elsadek/vicinae/nexus%20electron/review_plans_v2/TASK-5-VERIFICATION-TESTS-AND-REGRESSION-SUITE.md) | Comprehensive test matrix covering domain matching, alias resolution, storage migration, visual rendering, and zero-paint keyframes. |

---

## 🎯 Root Cause Summary & Solved Discrepancies

1. **Why GLM / Tab 7 had no active effect in the user's screenshot**:
   - Tab was created with key `'z.ai'` or navigated to `chat.z.ai`.
   - The provider key in the titlebar was `'glm'`.
   - `onUrl` never synchronized `tab.model` with the active domain, and the titlebar lacked domain-to-provider resolution.
   - **Fix**: Live domain-aware resolution engine ([`TASK 1`](file:///home/elsadek/vicinae/nexus%20electron/review_plans_v2/TASK-1-LIVE-PROVIDER-RESOLUTION-ENGINE.md)).

2. **Why the visual look was flat & unstyled**:
   - Plain grey uppercase buttons (`#94a3b8`) on minimal opacity background without HUD depth or borders.
   - **Fix**: Iron Man Arc-Reactor Cockpit styling with dark frosted glass capsule, laser-cut cyan border, micro-reactor dot, and multi-tier breathing glow ([`TASK 2`](file:///home/elsadek/vicinae/nexus%20electron/review_plans_v2/TASK-2-IRON-MAN-ARC-REACTOR-COCKPIT-STYLING.md)).

3. **Why 10 providers crowded the titlebar**:
   - Inactive providers took full label width even when space was tight.
   - **Fix**: Dynamic responsive dock keeping the active provider expanded while collapsing inactive providers to sleek icon badges ([`TASK 3`](file:///home/elsadek/vicinae/nexus%20electron/review_plans_v2/TASK-3-DYNAMIC-RESPONSIVE-DOCK-AND-TOOLTIPS.md)).

4. **Why icons had plus `+` symbols or missing graphics**:
   - Legacy localStorage contained outdated SVG strings with plus symbols (`M12 8v8`), and custom models lacked authentic SVGs in `BrandIcons.tsx`.
   - **Fix**: Storage legacy SVG sanitizer and authentic vector paths for GLM, AI Studio, and Albert ([`TASK 4`](file:///home/elsadek/vicinae/nexus%20electron/review_plans_v2/TASK-4-AUTHENTIC-BRAND-ICONS-AND-STORAGE-SANITIZER.md)).
