---
id: masest-043
title: Persist ShipStation shipments, packages, splits, and rate selections
agent: codex
risk: high
grill: completed
verification:
  - node --test tests/shipstation-shipment-lifecycle.test.mjs tests/shipstation-label-lifecycle.test.mjs tests/shipstation-orders.test.mjs tests/shipstation-admin.test.mjs tests/shipstation-admin-ui.test.mjs tests/provider-financial-ledger.test.mjs tests/shipstation-schema.test.mjs tests/auth-blob.test.mjs tests/admin-authz.test.mjs tests/staff-roles.test.mjs tests/auth-cache-release.test.mjs
  - npm run check
  - npm run build
  - npm run verify:site
  - npm audit --omit=dev
  - git diff --check
---

# Context

`masest-040` and `masest-042` made outbound label purchase/void, uncertain purchase reconciliation, label documents, returns, and financial evidence safe. Rating still stores one provider shipment ID directly on `orders`; packages and selected rate details are not normalized, stale browser edits have no shipment revision, and an order cannot represent warehouse splits separately from carrier multi-package shipments.

Official ShipStation API/ShipEngine behavior used by this slice:

- `POST /v1/shipments` creates shipment objects; `external_shipment_id` is unique.
- `PUT /v1/shipments/:shipment_id` updates a shipment before shipping and requires `ship_to` plus `ship_from` or `warehouse_id`.
- `PUT /v1/shipments/:shipment_id/cancel` marks a shipment cancelled only after associated labels are voided.
- `POST /v1/rates` accepts a shipment object or `shipment_id`, never both.
- Multi-package shipping is one provider shipment with multiple package entries and requires a carrier/service whose capabilities support it.

# Acceptance Criteria

1. Add normalized `order_shipments`, `order_shipment_packages`, and `order_shipment_rates` schema. Preserve provider IDs, deterministic external ID, split key, revision, operation state/error, package dimensions/weight, package hash, and normalized rate amount/currency/carrier/service/estimate. Money values are integer minor units. Service role owns all writes; staff reads flow through existing authenticated admin APIs.
2. Add atomic service-only claim/finalize RPCs for shipment create/update/cancel. Expected revision mismatch returns a stable conflict; only one concurrent provider mutation wins. Timeout/429/5xx or lost response stays `reconcile_required`, never retries blindly.
3. Add create/update/cancel/list handlers. Create uses warehouse `se-2287981`, deterministic unique external identity, canonical order address, and persisted package rows. Update/cancel are blocked after any active label; cancel also proves every linked label is voided. Replacement/split creates a new immutable provider link rather than overwriting history.
4. Model order splits as multiple `order_shipments`. Model carrier-supported multi-package as multiple package rows under one shipment. Enforce item-quantity conservation, unique split keys, maximum 20 packages, positive bounded dimensions/weight, and exact package hash.
5. Rate one shipment revision and persist returned provider shipment ID plus every safe rate snapshot. Selected rate is one row per shipment revision; re-rate invalidates prior selection. Label purchase must prove selected rate ID, provider shipment ID, current revision/package hash, and exact normalized currency before claim.
6. Extend order Shipping UI with persisted shipment/package/split/rate state, create/update/cancel actions, selected-rate control, stale revision errors, and audit timeline. All writes require `order.write`; cancellation requires explicit checkbox and reason of at least 8 characters. No provider URL, secret, raw provider object, or customer PII beyond existing order scope.
7. Preserve `masest-042` exact label authorization, no-store proxy limits, ambiguous purchase lock, return idempotency, provider/financial ledger history, and replacement-safe return projection.

# Constraints

- No live label purchase, live return creation, or production shipment mutation during automated/production QA.
- No Stripe/QBO mutation and no QBO posting.
- No Playwright. Browser/login QA uses Chrome DevTools or Computer Use.
- Stable error codes only. Provider error bodies stay server-side.
- Do not introduce parallel canonical order identity; `orders.id` and public `MST-*` remain canonical.

# Grill Gate

- Owner: warehouse/order staff with `order.write`; finance observes persisted rate versus recognized postage.
- Smallest acceptable version: normalized single/split shipment revisions, packages, rates, create/update/cancel API, and admin controls; manifests/pickups remain 13.4.
- Riskiest assumption: provider accepted create/update/cancel after response loss. Resolve with deterministic external ID, provider GET/list reconciliation, and `reconcile_required`; never blind retry.
- Split definition: order split creates multiple provider shipment records. Carrier multi-package keeps one provider shipment and multiple package records.
- Out of scope: checkout/customer rate selection, manifest/pickup, freight quoting, label purchase automation, QBO posting.
- Failure policy: stale revision is 409; ambiguous provider mutation stays locked; active label blocks shipment edits; unprofiled/freight items fail closed.

# Review Notes

- Inspect atomic claims, operation ambiguity, external-ID collision handling, revision/package hash validation, split conservation, selected-rate invalidation, active-label locks, and provider-link history.
- Verify no provider rate is treated as charged postage and no provider URL/secret enters browser output.
- Run only frontmatter's explicit Node test files. Never run `npm test` or any broad glob.
- Production browser QA is read-only through Chrome/Computer Use. No provider mutation.
