You are implementing Loop Factory spec `masest-029`.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-029.md`
        Spec hash: `b1622e373957602997c0d186829559286a867c26f18758302d27b72b7c87f70f`

        Operating rules:
        - Treat spec as source of truth.
        - Automate code generation and verification, not product decisions.
        - If spec is ambiguous, make smallest reversible assumption and record it in implementation notes.
        - Keep changes scoped to acceptance criteria.
        - Update living spec only for facts learned from implementation or tests.
        - Do not archive spec. Review step does that.
        - Use Codex subagents when work splits cleanly. Ask explicitly before spawning. Keep final answer terse with files changed and checks run.

        Required verification:
        - `node --test --test-timeout=120000 tests/money-flow-handlers.test.mjs tests/stripe-webhook.test.mjs tests/stripe-webhook-shape.test.mjs tests/rpc-privileges.test.mjs`
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
- Decision source: maintainer selected a durable per-effect ledger and bounded lease worker; production migration/scheduler still need operator approval.
- Problem: process termination after authoritative Stripe persistence can permanently skip stock, email, Company, oversell, billing, or dispute effects.
- Out of scope: event/signature selection, checkout/QBO, generic queue adoption, production cron/migration, and best-effort accounting.
- Review failure: webhook acknowledges before required enqueue, replay duplicates effects, crash skips/duplicates work, sensitive payloads persist, or staging/gates fail.
- Riskiest assumption: each external effect has a stable idempotency identifier.
- Smallest acceptable: unique effect rows committed before 2xx plus a bounded lease/retry/dead-letter worker.

# Context

Authoritative order persistence and ACH winner claims are already protected. Remaining post-persistence effects need durable completion state independent of Worker lifetime.

# Acceptance Criteria

- Add one unique ledger row per `(stripe_event_id, effect_key)`.
- Inventory and cover stock decrement, buyer confirmation, Company notification, oversell alert, billing alert, dispute alert, and every other non-idempotent webhook effect.
- Required effect rows commit before webhook 2xx; enqueue failure prevents acknowledgement.
- Worker claims bounded batches with leases, retry/backoff, and terminal dead-letter state.
- Duplicate Stripe delivery creates no duplicate effect.
- Expired leases are reclaimable.
- Crash before effect, after provider success, and before completion write is safe through per-effect/provider idempotency.
- ACH, card, billing-failed, dispute, refund, and subscription branches have focused coverage.
- No secret or full provider payload is persisted.
- Staging replays the same event and interrupts the worker between claim/completion.
- Frontmatter verification commands pass; mark row 029 `DONE` only after approved staging proof.

# Constraints

- Dependencies: `masest-019` accepted; preserve completed authoritative webhook durability and ACH winner-claim behavior.
- Completed prerequisites: advisor plans 013 and 014’s authoritative persistence and atomic ACH winner claim remain intact.
- Scope: additive `supabase/schema-stripe-effects.sql`, Stripe webhook, new effect library/admin worker endpoint, focused tests, secret-name-only `.env.example`, and row-029 status.
- Do not change Stripe event selection/signature verification, checkout, QBO, or adopt a generic queue.
- Do not execute production migration/cron without approval; accounting state cannot become best-effort.
- STOP if an effect lacks an idempotency identifier, atomic order/effect persistence exceeds approved schema scope, scheduler/secret ownership is undefined, or implementation needs sensitive full provider payloads.

# Review Notes

- Review ack ordering, unique constraints, claim leases, backoff/dead-letter transitions, and least privileges.
- Require staged crash/replay evidence, not only mocked happy paths.
