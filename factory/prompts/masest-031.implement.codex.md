You are implementing Loop Factory spec `masest-031`.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-031.md`
        Spec hash: `4228e80d58d465986f8a6b8ad83678648ee8bfa2fd4850ff67dc8242b8a1403e`

        Operating rules:
        - Treat spec as source of truth.
        - Automate code generation and verification, not product decisions.
        - If spec is ambiguous, make smallest reversible assumption and record it in implementation notes.
        - Keep changes scoped to acceptance criteria.
        - Update living spec only for facts learned from implementation or tests.
        - Do not archive spec. Review step does that.
        - Use Codex subagents when work splits cleanly. Ask explicitly before spawning. Keep final answer terse with files changed and checks run.

        Required verification:
        - `node --test --test-timeout=120000 tests/auth-cache-release.test.mjs tests/admin-information-architecture.test.mjs tests/admin-role-aware-ui.test.mjs tests/admin-split.test.mjs`
- `playwright test tools/admin-auth-gate.spec.mjs tools/admin-content-cms.spec.mjs tools/admin-quote-message-flows.spec.mjs --reporter=line`
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
- Decision source: maintainer selected workspace-level lazy groups and existing factory interfaces; no admin redesign/bundler is authorized.
- Problem: admin gate eagerly parses roughly 697 KB raw, including about 421 KB of feature workspaces not needed for overview.
- Out of scope: backend/IA/visual changes, module rewrites, bundlers/dependencies, hash changes, shared auth/util splitting, and unrelated factory combination.
- Review failure: overview imports a lazy group, groups initialize repeatedly, stale async render wins, permissions/aliases/dirty guard regress, or gates fail.
- Riskiest assumption: feature modules have no global import-time side effects outside current factory interfaces.
- Smallest acceptable: cached group loader, normalized render/wire API, race-safe async tab dispatch, and zero lazy feature imports on overview.

# Context

Admin feature factories already accept shared dependencies. Keep auth, shared utilities, permissions, dirty-edit guard, chrome, overview stats, and loader/routing primitives eager; defer feature workspaces until their first route.

# Acceptance Criteria

- Eager shell contains only auth, shared utility, permissions, dirty-edit guard, chrome, overview stats, and routing/loading primitives.
- Lazy groups are: analytics (traffic/SEO), integrations (QBO), orders, companies, products (products/pricing/inventory/coupons), content (content/blog), support, quotes, reviews, newsletter, and CRM (workspace/offers).
- Each group dynamically imports, constructs, and wires once, returning a normalized render/wire API.
- Initial overview requests no lazy feature module.
- Rapid tab changes cannot let stale load/render overwrite the current tab.
- Failed dynamic import has deterministic recoverable UI behavior.
- Historical hashes, aliases, deep links, back/forward, capability hiding, and dirty-edit guard remain correct.
- Cache-release graph remains valid.
- All frontmatter verification commands pass; mark row 031 `DONE` afterward.

# Constraints

- Dependencies: `masest-019` and `masest-027` must be accepted first.
- Scope: `js/admin.js`, optional new `js/admin/feature-loader.js`, export normalization only where required, focused tests/new lazy-module browser spec, and row-031 status.
- Do not change APIs, admin IA/visual design, hashes, shared auth/util boundaries, or add a bundler/dependency.
- STOP if import-time effects are globally required, cross-workspace dependency needs broad redesign, `/api/admin/stats` cannot provide a required global safety badge, or dynamic import cache-busting conflicts with release coupling.

# Review Notes

- Inspect network/module requests on overview and first/repeat workspace visits.
- Stress rapid navigation, failed import, permissions, aliases, history, and dirty-edit protection.
