# Task 33: Tab Discard 15-Minute Immunity & Smart MRU Capacity Plan

## 1. Problem Statement
- Tabs activated 1 to 2 minutes ago were getting auto-discarded when the application had only been used for ~12 minutes.
- **Root Cause 1**: `~/.config/nexus/tab-discard-policy.json` had `maxActiveTabs: 3`. When a 4th tab was opened/switched to, `reconcileCapacity()` immediately evicted the oldest background tab.
- **Root Cause 2**: `TabDiscardManager.reconcileCapacity()` lacked a minimum residency grace period. Even a tab switched to 60 seconds ago had zero immunity against capacity eviction.
- **Root Cause 3**: In `ensureAiView()`, `registerView()` called `reconcileCapacity()` *before* `activateTab()` was invoked. The newly selected tab was not yet protected as active, creating eviction races.

## 2. Solution & Architectural Changes
1. **15-Minute Immunity Grace Period (`MIN_RETENTION_GRACE_MS = 15 * 60 * 1000`)**:
   - In `TabDiscardManager`: A tab is protected from capacity eviction if:
     `now - lastActivatedAt < MIN_RETENTION_GRACE_MS` (15 minutes).
   - This guarantees that no tab interacted with in the last 15 minutes can ever be evicted for capacity.
2. **Updated Default Capacity**:
   - Update default `maxActiveTabs` from 3 to **7** in `DEFAULT_TAB_DISCARD_POLICY`.
   - Update user's `~/.config/nexus/tab-discard-policy.json` to 7 active tabs.
3. **Fix Registration Order in `ensureAiView()`**:
   - In `ensureAiView()`, set active view ID before or during registration so the incoming active tab is never subjected to eviction checks before being activated.
4. **Verification & Tests**:
   - Add unit tests verifying that tabs activated within 15 minutes are immune to `reconcileCapacity()`.
