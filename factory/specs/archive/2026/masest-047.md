---
id: masest-047
title: Deepen Quote lifecycle delivery and Checkout attempts
agent: codex
risk: high
grill: completed
verification:
  - node --test tests/quote-workflow-stateful.test.mjs tests/quote-lifecycle.test.mjs tests/quote-order.test.mjs tests/quote-checkout.test.mjs tests/account-quotes.test.mjs tests/admin-quotes.test.mjs tests/quote-handler.test.mjs tests/money-flow-handlers.test.mjs
  - npm run smoke:admin
  - npm run qa:commerce-smoke
  - npm run check
  - npm run build
  - npm run verify:site
  - git diff --check
---

# Grill Gate

- Owner: MASEST product owner owns Quote policy; Platform staff explicitly choose each offer’s future expiry; Buyer/Company ownership comes from canonical account context.
- Problem: Quote intake/delivery can report false success; decline authorization is email-only; expiry/open/actionability rules conflict; Checkout retry reuses permanent Stripe identity; filters and Buyer decline UI are incomplete.
- Out of scope: hidden default validity duration, new line-item model, self-serve NET checkout, new CRM workspace, live Stripe/Resend/QBO mutation, and deployment.
- Review failure: unsaved intake returns success; sent offer has no durable delivery work; cross-Company decline succeeds; expired/closed offer appears actionable or can check out; declined/expired request blocks fresh pricing forever; changed retry reuses one Stripe key; server filters omit later-page matches; Buyer cannot decline.
- Riskiest assumption: rotating Checkout attempt identity without allowing two payable Sessions. Persist one active attempt and rotate only after verified terminal/expired state under CAS.
- Smallest acceptable: one canonical lifecycle/actionability/open predicate, strict ownership, explicit expiry, durable intake/delivery, persisted Checkout attempts, complete server filtering, Buyer decline UI, and stateful end-to-end handler tests.

# Context

Existing Quote-to-Order CAS is valuable and remains canonical. Deepen `quote-lifecycle.js`/`quote-order.js` and the generic integration-effect seam; consolidate duplicated state policy from handlers and UI.

# Acceptance Criteria

1. Before any requisition-offer mutation, require exact authenticated requester ID and current Company ownership. GET `can_accept`/`can_decline`, POST accept/decline, and Checkout use the same authorization rule. Email alone never authorizes a requisition mutation.
2. Public Quote intake returns success only after a durable lead/acceptance record exists. Indeterminate failure is retryable and idempotent; browser requires the durable acknowledgement before displaying success.
3. Sending/revising an offer requires a Platform-staff-selected future ISO expiry. Persist it atomically with the offer revision. Enforce exact expiry boundary in Buyer list, accept/decline, Checkout, payment recovery, and scheduled/on-read transition logic.
4. One lifecycle module owns offer state, intake/pipeline terminal state, actionability, open-requisition semantics, and permitted CAS transitions. Buyer GET and POST cannot disagree. Platform staff terminal moves atomically transition or reject a live offer.
5. Declined/expired requisitions no longer count as open. Align lookup, deletion guard, uniqueness/index behavior, fresh-request race handling, and reactivation/closure policy without duplicate live requests.
6. Offer availability and delivery are separate states. Commit offer plus durable notification/message/email effects atomically. Platform staff sees queued/delivered/degraded/dead state; HTTP 200 never claims successful delivery when all channels lack durable work.
7. Add persisted Quote Checkout attempts. One active attempt has stable transport idempotency and one Stripe Session. Identical transport retry reuses it; changed inputs or retry after verified terminal/expired failure rotates under CAS and expires/invalidates the prior attempt before a new payable Session.
8. Validate/apply status, priority, owner, due, and search filters in the server query before count/range. List, Board, saved views, counts, and bulk selection consume the same paginated result semantics.
9. Expose accessible Buyer decline with confirmation, optional reason, pending/error/conflict state, and refresh after ownership is enforced.
10. Update `CONTEXT.md` to document all canonical Quote states, explicit expiry, delivery state, Checkout attempts, and staff-only NET conversion.
11. Add one stateful adapter-driven workflow test: Saved requisition → Platform staff offer/send → Buyer accept/decline → Checkout → webhook finalization → Order visibility, including concurrent, expired, delivery-failure, payment-failure/retry, malformed-state, and page-two filter cases.

# Constraints

- Reuse canonical Quote, requisition, Order, normalization, CAS, and integration-effect paths. No parallel line-item or delivery model.
- No implicit expiry duration; Platform staff owns the date for each offer.
- Preserve unrelated dirty Platform staff/Buyer UI work; re-read shared files before editing.
- No live Stripe Session, email, QBO, production write, commit, push, or deploy.

# Review Notes

- Inspect tenant ownership, time-boundary semantics, state/actionability locality, unique-index migration, delivery enqueue atomicity, Session concurrency, filter paging, accessibility, and recovery replay.

# Acceptance Evidence

- Final Quote Checkout/lifecycle focused suite passed 102/102; merged suite passed 2,234/2,234.
- Cross-review fixed decline/revision Session fencing, webhook preflight ordering, revision identity,
  and legacy Session adoption/cutover.
- Quote migrations applied to configured PostgreSQL and passed a second idempotency run.
- Live attempt store is empty and cutover remains deliberately fail-closed at `ready=false` until matching app deploy and old-Worker drain.
