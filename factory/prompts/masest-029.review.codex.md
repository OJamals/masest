Review Loop Factory spec `masest-029` against current working tree.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-029.md`

        Review stance:
        - Findings first. Focus correctness, regressions, tests, security, maintainability.
        - Compare implementation against acceptance criteria.
        - Run or inspect verification evidence:
        - `node --test --test-timeout=120000 tests/money-flow-handlers.test.mjs tests/stripe-webhook.test.mjs tests/stripe-webhook-shape.test.mjs tests/rpc-privileges.test.mjs`
- `npm run check`
- `npm run verify`
        - If accepted, say `ACCEPTED`.
        - If not accepted, say `CHANGES_REQUESTED` and list blocking items.
        - Do not move files. Operator or CLI archive step moves accepted specs.

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

# Implementation Notes

- Local status: implemented and locally verified; row 029 remains `BLOCKED` until staging replay/crash evidence exists. Do not mark `DONE`.
- Staging execution was approved on 2026-07-19, but redacted preflight found no dedicated staging target. The only accessible Supabase project is the same project referenced by live `https://masest.co/js/config.js`; the only Cloudflare Pages project serves `masest.co`.
- No schema, secret, scheduler, webhook, worker, DB row, or provider state changed. Applying `supabase/schema-stripe-effects.sql` would have changed the production backend, outside the staging-only approval.
- Unblock with a dedicated staging Supabase project plus a staging Pages/runtime environment. Evidence: `factory/runs/masest-029-030-staging-discovery.md`.
- Effect payloads are allowlisted semantic fields; no Stripe event body, API secret, or full Resend request is persisted.
- Resend provider idempotency uses one stable `stripe/<event-id>/<effect-key>` key. Resend retains keys for 24 hours, so recovery after provider success but before the local success marker depends on reclaim within that provider window: https://resend.com/docs/dashboard/emails/idempotency-keys
- Local PostgreSQL 17 proof applied the additive schema in an isolated temporary DB and verified duplicate rows, bounded claims, expired-lease reclaim, stock and notification response-loss replay, backoff, dependency release, and dead-letter transition. No staging or production state changed.
