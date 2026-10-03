# Bottom Dock ChatTabs Parity Plan

## Objective
Make the bottom-docked pinned chats bar use the exact same logic, sizing, visual styling, animations, thumbnail previews, model badges, and close/unpin interactions as the top `ChatTabs` bar.

## Problem Analysis
- The initial bottom dock implementation in `App.tsx` rendered simplified custom tiles that differed in size, font, hover thumbnails, and close behavior compared to top tabs.
- The user requested that when docked at the bottom, pinned chats have the identical logic, sizing, and styling as the top tabs.
- The user confirmed that clicking the 'x' close button should close the chat tab completely (same as closing top tabs), while right-clicking continues to unpin.

## Tasks
1. **Reuse ChatTabs Component in Bottom Dock**:
   - In `src/renderer/src/App.tsx`:
     - Render `ChatTabs` inside the bottom dock container when `interfaceSettings.pinnedPosition === 'bottom'`:
       ```tsx
       <ChatTabs
         tabs={tabs.filter((t) => pinnedIds.includes(t.id))}
         activeId={activeId}
         pinnedIds={pinnedIds}
         onSelect={(id) => {
           const tab = tabs.find((t) => t.id === id)
           if (tab && tab.url) switchToTab(id, tab.url)
         }}
         onClose={closeTab}
         onTogglePin={togglePin}
         modelColors={modelColors}
       />
       ```
2. **Bottom Dock Container Styling**:
   - Style the bottom dock bar with the exact matching height (`h-[52px]` / `h-14`), background (`bg-(--surface)` / `bg-(--bg)`), and padding as the top navbar, with a sleek HUD top border.
   - Include a compact "Pinned" section badge on the far left.
3. **Verification**:
   - Switch tabs in the bottom bar, verify hover thumbnails appear, verify active neon glow and sizing matches top tabs 100%, and verify closing and unpinning behave identically.
