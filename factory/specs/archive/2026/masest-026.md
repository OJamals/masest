---
id: masest-026
title: Replace global chat collision scans with explicit obstructions
agent: codex
risk: medium
grill: completed
verification:
  - node --test tests/customer-chat.test.mjs tests/conversion-entry.test.mjs
  - playwright test tools/site-audit-regressions.spec.mjs --reporter=line
  - npm run check
  - npm run verify
---

# Grill Gate

- Owner: maintainer.
- Decision source: maintainer selected explicit obstruction registration; no generic overlay manager is authorized.
- Problem: chat docking repeatedly measures all interactive elements on broad scroll and DOM mutation, forcing avoidable layout work.
- Out of scope: chat visuals/focus/auth/API, removing the lead bar, arbitrary third-party scanning, and generic overlay infrastructure.
- Review failure: broad scans/listeners remain, registered visibility is stale, chat overlaps lead bar at 390px, or gates fail.
- Riskiest assumption: lead bar is the only current production obstruction needing collision handling.
- Smallest acceptable: mark lead bar, emit obstruction state changes, and measure only registered obstructions on mount/change/resize.

# Context

Current docking performs document-wide interactive-element scans, repeated collision reads, captured scroll handling, and broad mutation observation. Stable fixed/sticky obstructions must own an explicit contract instead.

# Acceptance Criteria

- Only elements marked `data-customer-chat-obstruction` are measured.
- Lead bar owns the marker and announces visibility/suppression changes.
- Chat recomputes on initial mount, obstruction-change events, and resize.
- Optional `ResizeObserver` observes only registered obstructions.
- No captured document scroll listener or document-wide `MutationObserver` remains.
- One `requestAnimationFrame` batches each state change; repeated identical state does not reschedule work.
- Hidden/suppressed obstruction contributes zero lift.
- At 390×844, visible lead bar and chat launcher never overlap when chat is open or closed.
- Node, browser, syntax, and full gates in frontmatter pass; mark row 026 `DONE` afterward.

# Constraints

- Dependency: `masest-019` must be accepted first.
- Scope changes to `js/customer-chat.js`, `js/main/chrome.js`, focused tests, optional small `css/navigation.css` contract adjustment, and row-026 status.
- Do not redesign chat, move/remove lead action bar, scan third-party widgets, or create a generic overlay manager.
- STOP if another production control requires handling without being explicitly marked, a third-party widget lacks stable visibility state, or removing scroll handling reproduces overlap for a moving sticky obstruction.

# Review Notes

- Inspect structural absence of broad listeners/observers, not only runtime output.
- Exercise no obstruction, visible/hidden lead bar, repeat events, resize, safe-area geometry, and chat open/closed.
