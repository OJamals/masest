You are implementing Loop Factory spec `masest-021`.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-021.md`
        Spec hash: `00ecea7bd6c76057014bbb77ed7e2492ce5560c06caacd0e15ee531c7b837db4`

        Operating rules:
        - Treat spec as source of truth.
        - Automate code generation and verification, not product decisions.
        - If spec is ambiguous, make smallest reversible assumption and record it in implementation notes.
        - Keep changes scoped to acceptance criteria.
        - Update living spec only for facts learned from implementation or tests.
        - Do not archive spec. Review step does that.
        - Use Codex subagents when work splits cleanly. Ask explicitly before spawning. Keep final answer terse with files changed and checks run.

        Required verification:
        - `node --test tests/admin-authz.test.mjs tests/newsletter-endpoints.test.mjs tests/staff-roles-write.test.mjs`
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
- Decision source: maintainer selected the existing `staffCanWrite(role)` boundary; no new role taxonomy is authorized.
- Problem: `read_only` staff can mutate consent and newsletter-recipient records.
- Out of scope: audience populations, raw DB error masking, send/composition permissions, new roles, and recipient UI redesign.
- Review failure: `read_only` can mutate, denied requests parse bodies, writer behavior or GET behavior changes, or gates fail.
- Riskiest assumption: `requireStaff` still returns a normalized `role`.
- Smallest acceptable: one shared pre-parse capability gate for every recipient mutation.

# Context

Recipient import, add, update, unsubscribe, and delete are writes. Existing role policy already exposes `staffCanWrite(role)`, while GET population/count behavior must remain readable to `read_only`.

# Acceptance Criteria

- `read_only` retains recipient GET/count/population access.
- `read_only` receives a deterministic authorization denial for import, add, update, unsubscribe, and delete.
- All write actions share one `staffCanWrite(role)` check before body parsing.
- Tests prove denied writes never call the body parser.
- Existing writer-role mutation success behavior remains unchanged.
- All frontmatter verification commands pass.
- Only `functions/api/admin/recipients.js`, focused authorization tests, and row-021 status receive task changes.
- Mark row 021 `DONE` only after every criterion passes.

# Constraints

- Dependency: `masest-019` must be accepted first.
- Do not change audience membership, newsletter send/composition authorization, raw DB error policy, role names, or recipient UI.
- Do not clean or overwrite unrelated worktree changes.
- STOP if `requireStaff` no longer returns normalized `role`, product policy requires another role split, or tests demand unrelated raw-error changes.

# Review Notes

- Inspect every action branch and prove authorization happens before parsing or mutation.
- Confirm GET behavior and all existing writer roles remain stable.
