You are implementing Loop Factory spec `masest-028`.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-028.md`
        Spec hash: `d39f3fff2ffaa42948dc632d288aa8dbad133fa548ba14e1306c399785b1318f`

        Operating rules:
        - Treat spec as source of truth.
        - Automate code generation and verification, not product decisions.
        - If spec is ambiguous, make smallest reversible assumption and record it in implementation notes.
        - Keep changes scoped to acceptance criteria.
        - Update living spec only for facts learned from implementation or tests.
        - Do not archive spec. Review step does that.
        - Use Codex subagents when work splits cleanly. Ask explicitly before spawning. Keep final answer terse with files changed and checks run.

        Required verification:
        - `node --test tests/credit-enforcement.test.mjs tests/critical-money-flow.test.mjs tests/money-flow-handlers.test.mjs tests/cart.test.mjs tests/rpc-privileges.test.mjs`
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
- Decision source: maintainer selected additive `place_net_order_v2`, stable request keys, and fail-closed rollout; production migration still needs explicit operator approval.
- Problem: NET order, items, and stock persist in separate operations; crashes create partial state and retries can duplicate orders.
- Out of scope: production migration execution, Stripe pay idempotency, QBO/email durability, pricing/eligibility, v1 removal, and stock-policy changes.
- Review failure: any ledger mutation is non-atomic, logical retry duplicates work, missing v2 falls back, privileges broaden, staging proof is absent, or gates fail.
- Riskiest assumption: current variant data is sufficient to enforce stock/backorder semantics inside SQL.
- Smallest acceptable: additive v2 transaction, per-Company request-key uniqueness, cart-retained key, fail-closed Worker switch, and disposable concurrency proof.

# Context

`place_net_order` currently locks credit and inserts an order, while API code later inserts items and mutates stock. `place_net_order_v2` must own the complete transaction and make response-loss retries safe.

# Acceptance Criteria

- Add `place_net_order_v2` without removing v1.
- One SQL transaction owns credit check, order insert, item insert, and stock decrement.
- Stable client request key is retained per logical cart attempt and unique per Company.
- Same key/same cart returns the original order with `duplicate: true`; it creates no new items, stock mutation, or email.
- Same key/different cart is rejected.
- Variant rows lock in sorted SKU order regardless of input order.
- Insufficient stock/credit or currency mismatch creates no partial state.
- Backorder and untracked-stock behavior matches current policy.
- Missing v2 RPC returns 503; no app-side non-atomic fallback remains.
- SQL execution privileges remain service-role only.
- Disposable staging tests prove rollback, duplicate response-loss retry, and concurrency.
- Frontmatter verification commands pass; mark row 028 `DONE` only after approved staging proof.

# Constraints

- Dependencies: `masest-019` and `masest-022` must be accepted first.
- Scope changes to `js/cart.js`, `functions/api/checkout.js`, additive `supabase/schema-order-integrity.sql`, focused tests, optional disposable SQL/integration tooling, and row-028 status.
- Do not execute production SQL without explicit approval.
- Do not alter pay-mode idempotency, QBO, email durability, pricing, NET entitlement, stock/backorder policy, or remove v1.
- STOP if additive schema is blocked, variant fields cannot express current semantics, cart cannot retain a stable key, one logical request can span currencies, or staging cannot prove rollback/concurrency.

# Review Notes

- Require migration/RPC review, privilege inspection, deterministic lock order, and real concurrent duplicate attempts.
- Confirm email is called once only for first successful order and Worker never calls v1.
