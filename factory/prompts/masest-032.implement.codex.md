You are implementing Loop Factory spec `masest-032`.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-032.md`
        Spec hash: `77dfad8ac5ff87105ea63208b5edf25cc1721ca64dd85b3416712b71affe86a8`

        Operating rules:
        - Treat spec as source of truth.
        - Automate code generation and verification, not product decisions.
        - If spec is ambiguous, make smallest reversible assumption and record it in implementation notes.
        - Keep changes scoped to acceptance criteria.
        - Update living spec only for facts learned from implementation or tests.
        - Do not archive spec. Review step does that.
        - Use Codex subagents when work splits cleanly. Ask explicitly before spawning. Keep final answer terse with files changed and checks run.

        Required verification:
        - `node -e "console.log(require('./package.json').scripts)"`
- `npm test`
- `npm run verify:site`
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
- Decision source: maintainer selected factual reconciliation only; no strategy reprioritization or production claim is authorized.
- Problem: contributor docs claim no test suite and describe stale CMS/CRM/verification state, causing agents to repeat shipped work or skip gates.
- Out of scope: marking unimplemented work shipped, strategy changes, historical plan rewrites, source/package-script changes, and unverified deployment claims.
- Review failure: commands differ from `package.json`, stale phrases remain, links break, plan statuses change incorrectly, or selected work is described as shipped.
- Riskiest assumption: dirty source changes do not make current feature status ambiguous.
- Smallest acceptable: correct roadmap, architecture, command summary if needed, and advisor backlog/status reconciliation against current repository truth.

# Context

Documentation must separate current capability, real backlog, and queued work. Current repository has a test suite, CMS/CRM capability, and a specific local verification chain that docs must name exactly.

# Acceptance Criteria

- `docs/ROADMAP.md` reflects live test, CMS, and CRM state without marking `masest-019` through `masest-036` shipped.
- `docs/ARCHITECTURE.md` lists exact current verification commands and architecture.
- Root `README.md` changes only if its command summary conflicts with `package.json`.
- Advisor backlog contains no already-resolved or newly selected duplicate.
- Existing unrelated advisor statuses remain unchanged; row 032 becomes `DONE` only after verification.
- Every documented command is mechanically compared with `package.json`.
- Stale phrases are absent and all Markdown paths/links resolve.
- All frontmatter verification commands pass.

# Constraints

- Dependency: `masest-019` must be accepted first.
- Scope changes to `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, conditional root `README.md`, advisor index reconciliation/status, and nothing else.
- Do not change package scripts, source, product strategy, historical completed-plan files, or make unverified hosted/deployment claims.
- Do not mark other factory specs implemented before accepted evidence exists.
- STOP if repository and production differ where wording requires a live claim, dirty changes make status ambiguous, or a correction requires owner prioritization.

# Review Notes

- Compare exact script names/order and feature state to live files.
- Review status-table diff carefully; preserve non-selected statuses and distinguish queued from shipped.
