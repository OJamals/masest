# masest-026 implementation

- Native adapter: `codex`
- Spec hash: `6db173816de908d5e0ddcbcf2c59bc0edecd745af3d1d4fc56eed8a20525d591`
- Spec remains active at `factory/specs/active/masest-026.md`.

## Changed files

- `js/customer-chat.js`: replaced document-wide interactive scans, captured scroll handling, and broad mutation observation with registered-obstruction measurement on mount, obstruction events, open-state changes, stylesheet readiness, and resize; retained one-frame batching.
- `js/main/chrome.js`: registered the lead action bar, published deduplicated visible/suppressed state, and bumped the coupled customer-chat release.
- `js/main.js`, public HTML entrypoints, and their generator sources: completed the `chrome.js` → `main.js` cache-release chain after review.
- `css/navigation.css`: composed registered obstruction lift with the existing mobile lead-bar safe-area offset.
- `tests/customer-chat.test.mjs`: added structural coverage forbidding broad scans/listeners while preserving prior focus coverage.
- `tools/site-audit-regressions.spec.mjs`: added 390×844 no-obstruction, visible, suppressed, repeat-state, resize, open, and closed browser coverage.
- `tests/conversion-entry.test.mjs`: pinned the safe-area lead-bar rule plus obstruction lift.
- `tests/auth-cache-release.test.mjs`: pinned the matching `20260719a` public main/chrome/customer-chat module and style release chain.
- `advisor-plans/README.md`: marked row 026 `DONE` after every required verification command passed.

## Verification

- `node --test tests/customer-chat.test.mjs tests/conversion-entry.test.mjs` — pass, 14/14.
- `PATH="$PWD/node_modules/.bin:$PATH" playwright test tools/site-audit-regressions.spec.mjs --reporter=line` — pass, 22/22. The bare `playwright` executable was not globally available; the repository-local binary ran the specified command.
- `npm run check` — pass, 214 JavaScript files checked.
- `npm run verify` — pass: 1528/1528 Node tests; build copied 405 static files; site verification checked 91 HTML/7 CSS/167 JavaScript files; commerce smoke passed 12/12.

## Implementation notes and open risks

- Small reversible assumption: marker-only obstructions without `data-customer-chat-obstruction-active="false"` are treated as active when their computed style and geometry are visible.
- `ResizeObserver` remains intentionally absent: the current production obstruction is fixed-size, publishes every effective visibility/suppression transition, and is remeasured on viewport resize.
- Required browser verification exposed two stale pre-existing assertions. `#aBadgeMsg` was replaced with the existing equivalent `#aBadgeQuotes`; the intentionally asymmetric homepage proof grid now verifies stable 16:10 media slots while the proof-page equal-height assertion remains.
- Independent review found the initial cache bump stopped at `chrome.js`; remediation propagated `20260719a` through the public `main.js` entrypoint, hand-authored/generated HTML, generator templates, and release-contract tests. Admin retained its independent `20260711t` module graph because the lead-bar obstruction is public-only.
- Existing unrelated worktree changes and prior customer-chat focus/style readiness changes were preserved.
- Open production assumption remains the spec's stated risk: the lead action bar is the only current obstruction requiring registration.
