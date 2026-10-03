# URL Bar Restore Plan

## Objective
Restore the `Ctrl+L` URL bar functionality from the backup version of `App.tsx` to the current `App.tsx` without modifying any other features.

## Implementation Details
1. **Imports:**
   - Add `import UrlBarModal from './components/UrlBarModal'` to the top of `App.tsx`.
2. **State:**
   - Add `const [showUrlBar, setShowUrlBar] = useState(false)`.
3. **Functions:**
   - Inject `handleUrlBarNavigate`, `handleUrlBarCommand`, and `toggleUrlBar` into `App.tsx`, preserving their exact logic from the backup but adapting slightly for any minor dependency changes (like removing `getShortcutKeys` since the current app uses hardcoded keys in `handleGlobalShortcuts`).
4. **Shortcuts:**
   - Add `if (isCtrl && e.code === 'KeyL') { e.preventDefault(); toggleUrlBar(); return }` inside `handleGlobalShortcuts`.
   - Update `overlaysOpen` to include `showUrlBar`.
   - Ensure `showUrlBar` is closed when other popups (History, Settings, NewTab, etc.) are opened.
5. **Component:**
   - Add `<UrlBarModal />` to the bottom of the component tree, exactly as it was in the backup.
