Review Loop Factory spec `masest-024` against current working tree.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-024.md`

        Review stance:
        - Findings first. Focus correctness, regressions, tests, security, maintainability.
        - Compare implementation against acceptance criteria.
        - Run or inspect verification evidence:
        - `node --test tests/customer-chat.test.mjs`
- `npm run check`
- `npm run verify`
        - If accepted, say `ACCEPTED`.
        - If not accepted, say `CHANGES_REQUESTED` and list blocking items.
        - Do not move files. Operator or CLI archive step moves accepted specs.

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
