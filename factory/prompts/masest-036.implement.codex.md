You are implementing Loop Factory spec `masest-036`.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-036.md`
        Spec hash: `6d579df48c7b1e4ccfd4cc66e57c351c734be60bebae7d3fa2e3a5da768e7421`

        Operating rules:
        - Treat spec as source of truth.
        - Automate code generation and verification, not product decisions.
        - If spec is ambiguous, make smallest reversible assumption and record it in implementation notes.
        - Keep changes scoped to acceptance criteria.
        - Update living spec only for facts learned from implementation or tests.
        - Do not archive spec. Review step does that.
        - Use Codex subagents when work splits cleanly. Ask explicitly before spawning. Keep final answer terse with files changed and checks run.

        Required verification:
        - `node --test --test-timeout=120000 tests/story-accessibility.test.mjs tests/story-contract.test.mjs tests/ui-structure.test.mjs tests/website-language.test.mjs`
- `playwright test tools/story-hmis-visual.spec.mjs tools/site-audit-regressions.spec.mjs --reporter=line`
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
- Decision source: maintainer selected the four-act Replacement Ledger direction and measured height budgets; no new claim/asset/route is authorized.
- Problem: current homepage story consumes about 12 desktop and 11 mobile viewports with repeated compositions, duplicate CTAs, and a weak dark-to-light handoff.
- Out of scope: route tree, product truth, below-story ordering, global chrome/APIs, new assets/metrics, scroll interception/damping, global animation framework, and invented claims.
- Review failure: act/height budgets fail, proof qualifications change, CTA misses router, static/reduced/no-JS fallback is incomplete, boundary/chat overlaps, or gates fail.
- Riskiest assumption: essential approved proof fits within the selected height budgets without concealment.
- Smallest acceptable: four complete acts, one dominant replacement CTA, 6–7 desktop and at most 6.5 mobile viewports, complete static fallback.

# Context

Recompose existing evidence into: field problem and route; continuous buildup-cost pipe; operational Replacement Ledger; asymmetric proof/action close. Story must hand off cleanly from dark rail/nav/chat treatment into existing light content.

# Acceptance Criteria

- Story contains at most four acts.
- Desktop story measures 6–7 viewport heights at 1440×900.
- Mobile story measures at most 6.5 viewport heights at 390×844; shorter in-flow narrative is allowed.
- Act 1 presents field problem plus one dominant “Find your replacement” CTA in first viewport; trial is quieter secondary action.
- Act 2 uses one continuous buildup-cost pipe.
- Act 3 presents one operational Replacement Ledger comparing conventional burden with qualified VertKleen state.
- Act 4 closes with asymmetric proof/action composition, not generic equal feature cards.
- First action routes to the accepted guided replacement flow from `masest-033`.
- Existing HMIS qualifications, proof, and savings sources remain traceable and unchanged in meaning.
- Rail/nav/chat handoff is clean before light content during forward/reverse scroll.
- Reduced-motion, missing-GSAP, and no-JS modes provide complete accessible content matching the visual story.
- Keyboard, focus, contrast, mobile ledger overflow, and chat/CTA overlap pass focused coverage.
- All frontmatter verification commands pass; mark row 036 `DONE` afterward.

# Constraints

- Required process: read and use `/Users/omar/.codex/plugins/cache/agent-skills/agent-skills/1.0.0/skills/frontend-ui-engineering/SKILL.md`; use the repository codebase-memory graph before grep/glob/file discovery.
- Dependencies: `masest-019`, `masest-026`, `masest-027`, and `masest-033` must be accepted first.
- Scope: `index.html`, `css/story.css`, `js/story.js`, story contract/accessibility/browser tests, existing asset metadata only if needed, and row-036 status.
- Do not alter route tree, catalog/product truth, below-story section order, global header/footer, commerce APIs, or create assets/metrics.
- Do not add Lenis, wheel interception, scroll multipliers, custom damping, or global animation framework changes.
- Do not invent testimonials, customers, certifications, hazard scores, or savings claims.
- STOP if proof lacks source, height budget requires hiding essential content, mobile needs an incompatible narrative order, dirty story edits conflict with direction, or implementation needs new assets/claims/routes.

# Review Notes

- Require measured viewport-height evidence at both target sizes and forward/reverse boundary video/screenshots.
- Compare all proof/HMIS wording to source. Exercise reduced motion, no GSAP, no JS, keyboard, focus, contrast, mobile overflow, and chat collision.
