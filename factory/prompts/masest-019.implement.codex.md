You are implementing Loop Factory spec `masest-019`.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-019.md`
        Spec hash: `bbc07335d565f5729c9652341c747d2c1a20746f43c1a601b737281c1bae13a4`

        Operating rules:
        - Treat spec as source of truth.
        - Automate code generation and verification, not product decisions.
        - If spec is ambiguous, make smallest reversible assumption and record it in implementation notes.
        - Keep changes scoped to acceptance criteria.
        - Update living spec only for facts learned from implementation or tests.
        - Do not archive spec. Review step does that.
        - Use Codex subagents when work splits cleanly. Ask explicitly before spawning. Keep final answer terse with files changed and checks run.

        Required verification:
        - `node --test --test-concurrency=1 --test-timeout=120000 tests/account-password-reset.test.mjs tests/auth-cache-release.test.mjs tests/conversion-entry.test.mjs tests/layout-regressions.test.mjs`
- `npm run check`
- `npm run verify`
- `git diff --check`

        Deliverables:
        1. Implement acceptance criteria.
        2. Run verification commands or explain why unavailable.
        3. Add notes under `factory/runs/` or in final response: changed files, checks, open risks.
        4. Leave spec in `factory/specs/active/` for review.

        Spec:
        ---
        # Grill Gate

- Owner: maintainer.
- Decision source: maintainer selected this implementation contract; no new product decisions are authorized.
- Problem: three stale source contracts and one real admin-spacing regression keep `npm run verify` red, obscuring failures from all later work.
- Out of scope: shared CSS changes, reverting intentional heading/cache/chat changes, unrelated failures, and cleanup of user-owned worktree changes.
- Review failure: any stale assertion is preserved, a real browser regression is hidden, full verification stays red, or unrelated files change.
- Riskiest assumption: current failures still match the known stale contracts and admin hero specificity regression.
- Smallest acceptable: update three assertions plus the local `admin.html` hero override so the focused and full gates pass.

# Context

`npm run verify` stops in the Node suite. The reset template intentionally uses one `<h1>`, customer-chat module/style releases moved together, and mobile lead-bar positioning now includes `var(--customer-chat-avoid, 0px)`. Those tests need current contracts. Separately, `body .page-hero` beats `.adm-hero`, producing a 112px admin overview gap where Chromium must measure at most 64px.

# Acceptance Criteria

- `tests/account-password-reset.test.mjs` preserves the semantic heading contract for the reset template’s single `<h1>`.
- `tests/auth-cache-release.test.mjs` pins the live matching customer-chat module/style release.
- `tests/conversion-entry.test.mjs` requires both the mobile lead-bar selector and chat-avoidance variable.
- `admin.html` restores an admin overview shell gap of at most 64px without editing shared CSS.
- Existing real-browser geometry coverage remains authoritative; it is not replaced with source regex.
- All frontmatter verification commands pass.
- Only `tests/account-password-reset.test.mjs`, `tests/auth-cache-release.test.mjs`, `tests/conversion-entry.test.mjs`, `admin.html`, and the row-019 status entry receive task changes.
- Mark row 019 `DONE` only after every criterion passes.

# Constraints

- Dependency: none; this is the baseline required by `masest-020` through `masest-036`.
- Do not revert the `<h1>`, cache releases, chat avoidance variable, or shared interior-hero rhythm.
- Do not edit `css/components.css` or `css/navigation.css`.
- Do not fix a new downstream failure outside this scope.
- Do not clean, stage, reformat, or overwrite existing user-owned changes.
- STOP if expected source excerpts drifted, an assertion change would hide real browser behavior, full verification exposes an unrelated failure, or the fix requires shared CSS/generated-site cache churn.

# Review Notes

- Inspect semantic intent, not string substitution alone.
- Confirm Chromium geometry, exact module/style cache coupling, clean diff hygiene, and untouched unrelated worktree state.
