# Tab Label Width Plan

## Objective
Increase the maximum width of the tab's title label so the user can actually read the chat title before it gets truncated.

## Current Situation
In `ChatTabs.tsx`, the expanded state of a tab restricts the title wrapper to `max-w-[120px]`. This is extremely narrow and truncates almost any title longer than 2 words.

## Proposed Implementation
- Increase the Tailwind class from `max-w-[120px]` to `max-w-[240px]` or `max-w-[300px]`.
- This ensures the flex layout still functions correctly, but gives the text ample breathing room.
