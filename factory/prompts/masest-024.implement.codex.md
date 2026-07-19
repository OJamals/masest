You are implementing Loop Factory spec `masest-024`.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-024.md`
        Spec hash: `2019c066ae88b4dedc9d9cddf0e66f01a10d488ef9a1869ca153a11e2e7b6de5`

        Operating rules:
        - Treat spec as source of truth.
        - Automate code generation and verification, not product decisions.
        - If spec is ambiguous, make smallest reversible assumption and record it in implementation notes.
        - Keep changes scoped to acceptance criteria.
        - Update living spec only for facts learned from implementation or tests.
        - Do not archive spec. Review step does that.
        - Use Codex subagents when work splits cleanly. Ask explicitly before spawning. Keep final answer terse with files changed and checks run.

        Required verification:
        - `node --test tests/customer-chat.test.mjs`
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
- Decision source: maintainer selected deterministic guest focus entry; no modal redesign is authorized.
- Problem: guest chat opens while focus remains on the launcher, allowing the next Tab to leave the inserted dialog.
- Out of scope: focus trapping, `inert`, chat visuals/API/auth/polling, overlay docking, and unproven CSS changes.
- Review failure: guest/auth focus targets or restoration fail, timing races appear, scope expands, or gates fail.
- Riskiest assumption: guest panel retains one visible primary action.
- Smallest acceptable: focus that action after guest open and preserve launcher restoration on close/Escape.

# Context

Authenticated chat already focuses its textarea. Guest chat needs equivalent deterministic focus entry plus existing launcher-focus restoration.

# Acceptance Criteria

- Opening guest chat focuses its visible primary action.
- Opening authenticated chat still focuses the textarea.
- Close button and Escape restore focus to the launcher.
- Reopening after close repeats correct focus behavior.
- Auth lookup failure falling back to guest also focuses the guest primary action.
- Implementation adds no arbitrary timeout or focus race.
- All frontmatter verification commands pass.
- Only `js/customer-chat.js`, `tests/customer-chat.test.mjs`, and row-024 status receive task changes.
- Mark row 024 `DONE` only after every criterion passes.

# Constraints

- Dependency: `masest-019` must be accepted first.
- Do not add a full focus trap, `inert`, visual redesign, API/auth/polling changes, or docking work.
- CSS may change only if visible focus is proven absent.
- STOP if guest panel gains competing primary actions, another dialog manager owns restoration, or the harness cannot model async focus; in the last case add one focused Playwright test instead of weakening assertions.

# Review Notes

- Exercise guest, authenticated, auth-failure, close, Escape, and reopen paths.
- Confirm focus is visible and placed only after the target becomes operable.
