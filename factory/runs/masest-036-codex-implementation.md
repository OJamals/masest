# masest-036 implementation

- Date: 2026-07-19
- Adapter: `codex`
- Spec hash: `6d579df48c7b1e4ccfd4cc66e57c351c734be60bebae7d3fa2e3a5da768e7421`

## Implementation

- Replaced the five-act story with four acts: field route, continuous buildup-cost pipe, operational Replacement Ledger, and asymmetric proof/action close.
- Kept the first dominant action on `products#swap`; retained the trial as the quieter secondary action.
- Preserved the approved HMIS qualifications, `$115,000` incident context, `$10,000 / yr saved` proof, and their existing source language.
- Used native scroll only. Desktop retains the enhanced story; mobile, reduced-motion, missing-GSAP, and no-JS modes use the complete in-flow story.
- Smallest reversible assumption: widths at or below `760px`, including compact tablets, use the same in-flow order as mobile. This avoids an incompatible alternate narrative.

## Measured evidence

- Desktop at `1440x900`: `5940px`, or `6.60` viewport heights.
- Mobile at `390x844`: `3536px`, or `4.19` viewport heights.
- Mobile document overflow: `0px`; ledger scroll region: `360px` client width and `780px` scroll width.
- Forward and reverse light-content boundary samples: story state released, rail hidden, and chat light-themed with the light strip entering at `780px`.
- Screenshots: `factory/runs/masest-036-evidence/`.

## Changed files

- `index.html`
- `css/story.css`
- `js/story.js`
- `tests/story-accessibility.test.mjs`
- `tests/story-contract.test.mjs`
- `tests/ui-structure.test.mjs`
- `tests/home-first-fold.test.mjs`
- `tools/story-hmis-visual.spec.mjs`
- `tools/site-audit-regressions.spec.mjs`
- `advisor-plans/README.md`

## Verification

- `node --test --test-timeout=120000 tests/story-accessibility.test.mjs tests/story-contract.test.mjs tests/ui-structure.test.mjs tests/website-language.test.mjs` — 52 passed.
- `playwright test tools/story-hmis-visual.spec.mjs tools/site-audit-regressions.spec.mjs --reporter=line` — 38 passed.
- `npm run check` — checked 221 JavaScript files.
- `npm run verify` — passed with exit code 0; full Node, build, site, commerce-smoke, and UI-critical gates completed.

## Open risks

- No known acceptance-criteria risk remains. Browser specs select the installed Chrome channel because the local Playwright Chromium bundle is unavailable.
