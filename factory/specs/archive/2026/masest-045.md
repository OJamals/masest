---
id: masest-045
title: Make shipment labels authoritative and recoverable
agent: codex
risk: high
grill: completed
verification:
  - node --test tests/shipment-label-ownership.test.mjs tests/shipstation-shipment-lifecycle.test.mjs tests/shipstation-label-lifecycle.test.mjs tests/shipstation-orders.test.mjs tests/order-cancellation.test.mjs tests/order-tracking.test.mjs tests/shipstation-webhook.test.mjs tests/shipstation-schema.test.mjs
  - npm run check
  - npm run build
  - npm run verify:site
  - git diff --check
---

# Grill Gate

- Owner: warehouse/order staff with `order.write`; MASEST/Supabase owns shipment and label identity; ShipStation owns carrier artifacts and events.
- Problem: split labels are collapsed into latest-label Order projections, and provider mutation locks have no complete lease/reconciliation lifecycle.
- Out of scope: manifests, pickups, carrier billing settlement, inventory purchasing, live provider mutation, and a new fulfillment UI.
- Review failure: cancellation misses any active label; one split scan fulfills the whole Order; older split cannot receive a return; a crash leaves create/update/cancel/purchase/void/return permanently locked; recovery can blindly repeat a provider mutation.
- Riskiest assumption: provider accepted a request after response loss. Recovery must query deterministic provider identity/evidence; absence must never be inferred from a timeout.
- Smallest acceptable: authoritative label-to-shipment ownership, all-label cancellation/tracking/return semantics, expiring operation leases, and bounded audited reconciliation for every mutation.

# Context

`masest-040`–`043` established immutable provider links, financial evidence, normalized shipments/packages/rates, atomic claims, documents, returns, and reconciliation. Extend those canonical seams. Order-level ShipStation columns remain projections only.

# Acceptance Criteria

1. Add a deep shipment-label ownership module over canonical `order_shipments` plus immutable ShipStation provider links. Every outbound/return label resolves exact `order_id`, `order_shipment_id`, parent label, active/void state, tracking identity, and safe financial evidence. Backfill legacy projected labels idempotently.
2. Treat Order label/return/tracking columns as latest-action projections only. No cancellation, tracking, return, authorization, or fulfillment decision may depend on them as sole authority.
3. Cancellation enumerates every active outbound label across non-cancelled splits. Generate deterministic void effects for all labels; refund/restock/accounting/cancel/email cannot run until every required void succeeds or is proven already voided. Duplicate command/replay does not call ShipStation twice.
4. Tracking resolves through authoritative label ownership, retains events from older splits, and derives Order fulfillment only when every required shipment reaches its terminal fulfillment condition. One split event never fulfills unrelated splits.
5. Return creation requires an explicit owned outbound label and creates/repairs a return for that exact shipment/parent. Older and replacement split labels remain addressable without changing the latest projection.
6. Add durable provider-operation attempts for shipment create/update/cancel and label purchase/void/return. Attempts have deterministic keys, status, bounded lease owner/expiry, provider-success evidence, safe result summary, timestamps, and immutable relation to the shipment/label.
7. Expired leases become reconcilable, never blindly retryable. Add bounded read-only provider reconciliation for every mutation. Zero/ambiguous evidence stays locked and visible; audited release is allowed only after non-acceptance is positively proven.
8. Preserve exact authz, no-store document proxy, provider error redaction, package/rate revision checks, finance ledger evidence, and append-only audit history from `masest-040`–`043`.
9. Add stateful adversarial tests for two active split labels, old/new tracking, partial fulfillment, crash after provider success at each boundary, expired lease takeover, zero/multiple reconciliation candidates, and duplicate requests.

# Constraints

- Deepen existing shipment/provider-link implementation; do not introduce a parallel Order or provider identity.
- No live label, void, return, shipment write, Stripe/QBO mutation, production write, commit, push, or deploy.
- Stable error codes only. No provider URL, secret, raw body, or excess PII in browser/database summaries.
- Preserve unrelated dirty Platform staff UI work; re-read before editing shared files.

# Review Notes

- Inspect ownership source, migration/backfill idempotency, multi-label dependency ordering, fulfillment aggregation, operation lease fencing, provider-call counts, reconciliation ambiguity, and projection repair.

# Acceptance Evidence

- Shipment/label focused suite passed 111/111; merged repository suite passed 2,234/2,234.
- Cross-review fixed cancellation rejection, mutation incarnation, returned-shipment identity,
  postage validation, reconciliation UI, and bounded document consumption.
- Ownership/provider migrations applied to configured PostgreSQL and passed a second idempotency run.
- Live checks found RLS enabled, internal RPCs service-only, 0 invalid indexes/constraints, and no data-count drift.
