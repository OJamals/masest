Review Loop Factory spec `masest-038` against current working tree.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-038.md`

        Review stance:
        - Findings first. Focus correctness, regressions, tests, security, maintainability.
        - Compare implementation against acceptance criteria.
        - Run or inspect verification evidence:
        - `node --test tests/integration-effects.test.mjs tests/stripe-effects.test.mjs tests/money-flow-handlers.test.mjs`
- `npm run check`
- `npm run build`
- `npm run verify:site`
- `git diff --check`
        - If accepted, say `ACCEPTED`.
        - If not accepted, say `CHANGES_REQUESTED` and list blocking items.
        - Do not move files. Operator or CLI archive step moves accepted specs.

        Spec:
        ---
        # Grill Gate

- Owner: MASEST maintainer; user approved deeper Stripe, shipping, Intuit, website, CMS/CRM integration.
- Problem: generic ledger from `masest-037` has no operational value until production Stripe effects use one generic worker while retaining exact order confirmation, stock, oversell, dispute, ACH, billing, company notification, and QBO behavior.
- Out of scope: ShipStation/QuickBooks/Resend inbound cutover; new provider features; live label purchase; QuickBooks production posting; admin workflow redesign; compatibility wrappers.
- Review failure: any provider boundary request, idempotency key, dependency order, webhook response, or retry behavior changes; duplicate delivery becomes possible; migrated rows execute again; old Stripe-only table/RPC remains after verified cutover; rollback cannot restore old worker.
- Riskiest assumption: module/table cutover can keep provider-visible behavior byte-for-byte stable while changing persistence identities and retry control.
- Smallest acceptable: generic worker and Stripe enqueue/claim path, exact boundary regression tests, scheduled/admin trigger update, proven migration, old table/RPC removal after parity, and runnable rollback restoring old schema/worker.

# Context

`functions/_lib/stripe-effects.js` currently owns effect delivery and uses Stripe-specific RPCs. `functions/api/stripe-webhook.js` enqueues work. `functions/api/admin/stripe-effects.js` invokes worker. `masest-037` adds generic storage but intentionally leaves these callers untouched. This slice cuts one provider end to end, then removes the obsolete persistence path rather than retaining a compatibility layer.

# Acceptance Criteria

- Stripe webhook ingestion writes one immutable `integration_events` receipt per Stripe event and enqueues required `integration_effects` atomically/idempotently.
- Existing synchronous order/refund/subscription transaction behavior and HTTP webhook acknowledgement remain unchanged.
- Generic worker claims and delivers every current Stripe effect type with same dependency order, payload, provider request, idempotency key, notification content, QBO request, stock mutation, and terminal-order handling.
- If provider succeeded but DB acknowledgement failed, replay records completion without repeating provider call.
- Duplicate and out-of-order Stripe events process once; concurrent workers cannot claim same effect.
- Admin/scheduled worker surface reports claimed/completed/retried/dead/skipped/provider-acknowledged counts and never exposes secret or raw provider payload.
- Existing 11 migrated completed effects remain completed and never redeliver after cutover.
- After code and data parity verification, old `stripe_webhook_effects` table, Stripe-specific RPCs, and obsolete implementation module/route names are removed. No forwarding wrapper remains.
- Rollback artifact recreates old table/RPCs from preserved generic rows and restores old worker imports/routes/config, with parity verification.

# Constraints

- Depends on accepted `masest-037`.
- Preserve exact provider boundaries using hostile unit tests and captured dependency-injected calls; never post live QBO objects or purchase labels during verification.
- Keep effect delivery functions consolidated; rename/move rather than duplicate.
- No Playwright. Use Node tests/build/site verifier plus Chrome DevTools production smoke after deploy.
- Apply production cutover only with clean full suite, schema forward/rollback proof, live-row checksum parity, and rollback ready.

# Review Notes

- Diff provider calls before/after for all effect types and failure seams.
- Simulate duplicate receipt, reverse ordering, two claimers, expired lease, provider success then RPC failure, full-jitter retries, max-attempt dead state, replay, and terminal order.
- Confirm no source/schema/config/tests reference `stripe_webhook_effects` or Stripe-specific RPC names after cutover except historical migration/rollback artifacts.
