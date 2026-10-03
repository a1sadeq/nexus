# Iron Man HUD Component Styling Plan (Every Component)

## Objective
Apply the Iron Man J.A.R.V.I.S. HUD design and animations across every single UI element in Nexus, creating an uncompromising, unified Stark tactical interface.

## Target Components
1. **Chat Tabs (`ChatTabs.tsx`, `ChatTabs.css`)**:
   - Tactical shard styling with chamfered angled corners and border glow.
   - Corner brackets (`⌜ ⌝ ⌞ ⌟`) on each tab card.
   - Active tab: Pulsing electric cyan arc glow (`0 0 16px rgba(0, 229, 255, 0.45)`), live reactor core indicator, and crisp cyan border.
   - Audio feedback on tab selection via `hudAudio.click()`.
2. **Pinned Sidebar (`PinnedSidebar.tsx`, `SidebarHeader.tsx`)**:
   - Vertical tactical rail with glowing telemetry lines and hex-grid backing.
   - Pinned icons framed in mini HUD brackets with glow hover effects.
3. **Model Notch (`ModelNotch.tsx`, `ModelNotch.css`)**:
   - Transform into a miniature Arc Reactor telemetry gauge showing the active AI model name with holographic cyan border and rotating ring segment.
4. **History Overlay (`HistoryOverlay.tsx`, `HistoryOverlay.css`)**:
   - Holographic archive databank with CRT scanlines and tactical shard list items.
   - Quick filter buttons styled as Stark power-level selectors.
   - Target acquisition audio cue on open via `hudAudio.modalOpen()`.
5. **New Tab & Model Selector (`NewTabOverlay.tsx`)**:
   - Stark Industries Model Deployment Bay: AI cards presented as tactical suit modules (Gemini, Claude, ChatGPT, Qwen) with chamfered corners and targeting reticles.
6. **Settings & Style Studio (`SettingsOverlay.tsx`, `StyleStudioCanvas.tsx`)**:
   - Mark Suit Diagnostics Lab with tech-border category accordions, laser-line sliders, and cyan telemetry switches.
7. **UrlBar & Tab Switcher (`UrlBarModal.tsx`, `TabOverviewOverlay.tsx`)**:
   - Tactical target search input with glowing cyan corner brackets and HUD prompt indicator.
8. **Toasts & Notifications (`DownloadNotificationToast.tsx`, `__nexusTabToast`)**:
   - J.A.R.V.I.S. alert feeds framed in `#00E5FF` chamfered HUD boxes with audio blips.
