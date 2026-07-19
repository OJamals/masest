You are implementing Loop Factory spec `masest-034`.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-034.md`
        Spec hash: `f47ad1a6bbef2f9ebf5a31250a7e9a4b6503a135c16d9b37d70f4c21b87ba4ce`

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
- `playwright test tools/product-buy.spec.mjs tools/focus-visible-a11y.spec.mjs --reporter=line`
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
- Decision source: maintainer selected restrained existing proof/fit display; no new evidence or claim is authorized.
- Problem: catalog cards hide existing job, fit, and proof summaries until buyers open each detail page.
- Out of scope: new assets/certifications/testimonials/metrics, commerce logic, detail-page rewrites, CMS schema, and full copy display.
- Review failure: unsupported copy appears, action hierarchy changes, empty/dense chrome harms mobile, links promise missing proof, or gates fail.
- Riskiest assumption: current proof text is approved for compact catalog display and detail routes contain promised evidence.
- Smallest acceptable: at most three fit labels plus one short proof cue, absent cleanly when data is missing.

# Context

Purchase/quote action remains primary. Existing `PRODUCT_CATALOG_COPY.proof` and fit metadata can reduce decision friction if rendered concisely beside that action.

# Acceptance Criteria

- Supported product cards show at most three fit labels and one short proof cue.
- Proof uses existing `PRODUCT_CATALOG_COPY.proof` verbatim or a shorter evidence-preserving label.
- “Review proof” routes to the product detail page, not a nonexistent anchor.
- Price and buy/quote action remain visually and semantically primary and behaviorally unchanged.
- Missing proof or fit data produces no empty wrapper/chrome.
- Cards avoid nested-card treatment, decorative gradients, and badge overload.
- Long data stays readable at 390px with no horizontal overflow and visible actions.
- Accessible link names and focus indicators remain clear.
- Tests cover full/missing data plus buyable/quote-first states and prove claims originate in existing data.
- All frontmatter verification commands pass; mark row 034 `DONE` afterward.

# Constraints

- Dependencies: `masest-019` and `masest-027` must be accepted first.
- Scope: `js/main/commerce-ui.js`, evidence corrections only in `catalog-data.js`, `products.html`, new catalog-decision CSS/tests, and row-034 status.
- Do not create proof, claims, assets, metrics, testimonials, certifications, or modify price/stock/variant/buy/quote behavior.
- Do not rewrite detail pages or change CMS schema.
- STOP if proof text lacks approval, detail route lacks promised evidence, density pushes actions below accepted mobile threshold, or evidence needs legal/CMS workflow.

# Review Notes

- Compare rendered text to source data and audit empty states.
- Review DOM semantics/action priority, long-copy wrapping, keyboard focus, and 390px overflow.
