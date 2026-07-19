You are implementing Loop Factory spec `masest-033`.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-033.md`
        Spec hash: `462e998b17e897025e538aaab10ac416ccb33704a22c36b607f55afde002eb2b`

        Operating rules:
        - Treat spec as source of truth.
        - Automate code generation and verification, not product decisions.
        - If spec is ambiguous, make smallest reversible assumption and record it in implementation notes.
        - Keep changes scoped to acceptance criteria.
        - Update living spec only for facts learned from implementation or tests.
        - Do not archive spec. Review step does that.
        - Use Codex subagents when work splits cleanly. Ask explicitly before spawning. Keep final answer terse with files changed and checks run.

        Required verification:
        - `node --test tests/catalog-seed.test.mjs tests/product-layout.test.mjs tests/website-language.test.mjs`
- `playwright test tools/product-buy.spec.mjs tools/contact-prefill.spec.mjs --reporter=line`
- `npm run check`
- `npm run verify`

        Deliverables:
        1. Implement acceptance criteria.
        2. Run verification commands or explain why unavailable.
        3. Add notes under `factory/runs/` or in final response: changed files, checks, open risks.
        4. Leave spec in `factory/specs/active/` for review.

        Spec:
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
