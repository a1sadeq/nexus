# Task 22: Smart Question/Choice Detection & State Triggers

## 1. Context & Objective
Per user directive A2: "Only mark 'waiting-input' (amber pulse) if the finished response ends in a question, choice, or confirmation prompt; otherwise mark 'done' (emerald dot)."

## 2. Decision Logic (`src/renderer/src/lib/tabStatus.ts`)
When a generation stream finishes (`isGenerating` transitions from `true` to `false`):
1. **Active Tab vs Background Tab**:
   - If user is currently focused on the active tab (`activeId === tabId`), the response was observed live. Transition directly to `'done'` (emerald dot) for 6 seconds, then fade to `'idle'`.
   - If tab is in the **background** (`activeId !== tabId`):
     - Extract latest text snippet or ending punctuation of the AI's response.
     - Evaluate `hasQuestionOrChoice(text: string): boolean`:
       - Pattern 1 (Direct questions): Ends with `?` or `？` (with optional whitespace, markdown asterisks, or quotes).
       - Pattern 2 (Choice lists): Contains numbered options (`1. ... 2. ...` or `A) ... B) ...` or `[Option 1]`).
       - Pattern 3 (Prompt words): Contains phrases like `"which one"`, `"would you like"`, `"please confirm"`, `"do you want me to"`, `"please choose"`, `"let me know"`.
     - If `hasQuestionOrChoice` is `true`:
       - Status = `'waiting-input'` (Amber beacon alert).
     - Else:
       - Status = `'done'` (Emerald dot ready).
2. **Clearing on Tab Activation**:
   - When user clicks into the tab (`switchToTab(tabId)`), any `'waiting-input'` or `'done'` state resets to `'idle'`.

## 3. Verification Plan
- Unit tests for `hasQuestionOrChoice()` covering various markdown formats, multi-language question marks (`?`, `？`), lists, and confirmations.
