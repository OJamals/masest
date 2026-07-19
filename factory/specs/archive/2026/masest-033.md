---
id: masest-033
title: Guide buyers from current job to a VertKleen action
agent: codex
risk: medium
grill: completed
verification:
  - node --test tests/catalog-seed.test.mjs tests/product-layout.test.mjs tests/website-language.test.mjs
  - playwright test tools/product-buy.spec.mjs tools/contact-prefill.spec.mjs --reporter=line
  - npm run check
  - npm run verify
---

# Grill Gate

- Owner: maintainer.
- Decision source: maintainer selected the four-step evidence-backed router; no new product mapping or claim is authorized.
- Problem: uncertain buyers know job/current chemical/surface/volume but current catalog offers only expert search, chips, and a flat matrix.
- Out of scope: backend/AI recommendations, profiling/account state, new mappings/claims, removal of existing catalog paths, buy/quote policy, formulas, and pricing.
- Review failure: results are unsupported/nondeterministic, ambiguity dead-ends, URL/history breaks, expert paths or commerce policy change, accessibility fails, or gates fail.
- Riskiest assumption: current catalog evidence covers every required mapping.
- Smallest acceptable: at most four skippable steps producing one-to-three supported candidates or a prefilled quote/trial fallback.

# Context

Router starts from buyer language, preserves shareable state, and guides to existing actions. It must coexist with search, category chips, sorting, replacement matrix, and commerce actions.

# Acceptance Criteria

- Inputs start with current chemical or job; optional surface/system and volume follow.
- Flow has at most four short steps and allows unknown fields to be skipped.
- Deterministic output returns one to three candidates with “why matched,” an existing proof cue, and existing buy/quote action.
- No-match or low-confidence state routes to a prefilled quote or trial; never empty results.
- URL query preserves selection for sharing, refresh, back, and forward.
- Existing search, chips, sorting, matrix, and commerce actions remain operational.
- Routing data is traceable to current catalog evidence; no unsupported hazard, compatibility, dilution, savings, or certification claims appear.
- Tests cover every current-chemical row, partial/conflicting/unknown input, history/share, keyboard/focus/live region, 390px/desktop, and unchanged buy/quote policy.
- All frontmatter verification commands pass; mark row 033 `DONE` afterward.

# Constraints

- Dependencies: `masest-019` and `masest-027` must be accepted first.
- Scope: `products.html`, new `js/main/replacement-router.js`, mount integration in `commerce-ui.js`, evidence-backed routing metadata only, new router CSS/tests, and row-033 status.
- Do not add backend/AI/profile state, invent mappings/claims, remove expert catalog paths, or change pricing/calculator/commerce policy.
- STOP if a mapping lacks evidence, compatibility needs technical/legal review, volume thresholds require undefined freight policy, or coexistence would duplicate catalog state ownership.

# Review Notes

- Trace each decision-table row to existing product truth.
- Review keyboard order, focus movement, announcements, URL encoding, history behavior, ambiguity, and mobile layout.
