---
id: masest-042
title: Safe ShipStation label documents, returns, and purchase reconciliation
agent: codex
risk: high
grill: completed
verification:
  - node --test tests/shipstation-label-lifecycle.test.mjs tests/shipstation-orders.test.mjs tests/shipstation-admin.test.mjs tests/shipstation-admin-ui.test.mjs tests/provider-financial-ledger.test.mjs
  - npm run check
  - npm run build
  - npm run verify:site
  - git diff --check
---

# Context

`masest-040` added atomic outbound-label purchase/void safety and immutable postage evidence. A provider timeout, 429, or 5xx intentionally leaves `orders.shipstation_label_status = reconcile_required`, but staff cannot yet query ShipStation and adopt a label that was actually created. Staff also cannot retrieve/proxy label documents or create an order-linked return label.

Official ShipStation API/ShipEngine behavior used by this slice:

- `GET /v1/labels/:label_id` retrieves one label.
- `GET /v1/labels` supports `created_at_start`, `created_at_end`, `page`, `page_size`, `sort_by`, and `sort_dir`; page size is bounded at 100.
- `POST /v1/labels/:label_id/return` creates a return from an outbound label, reverses the addresses, and reuses carrier/service.
- `label_download` URLs are tokenized, shareable, and expire after 90 days.

# Acceptance Criteria

1. Add staff-authenticated order-scoped label metadata and document GET actions. Require `order.read`, validate an exact outbound or linked return-label ID, fetch current provider metadata, expose only safe fields, and emit `Cache-Control: no-store` on every document/metadata response including auth/error responses.
2. Proxy PDF/PNG/ZPL label documents through MASEST. Never return the provider download URL. Allow only HTTPS `api.shipengine.com/v1/downloads/` or `api.shipstation.com/v2/downloads/` sources, allow at most one validated same-allowlist redirect, accept only matching document media types, and cap payloads at 10 MiB.
3. Add `reconcile_label_purchase`. Require `order.write`, explicit `confirm: true`, and an audit reason of at least 8 characters. It may run only while the order is `reconcile_required`/`purchasing`; query at most two 100-label pages within a bounded attempt window and match the exact outbound `shipment_id`. Exactly one viable non-return/non-void label is adopted into the existing order fields, provider links, financial ledger, shipment history, and audit. Zero or multiple candidates remain locked; no label purchase call is made.
4. Add `return_label`. Require `order.write`, explicit confirmation, reason, exact current non-void outbound label, domestic order, and a configured API key. Call `POST /labels/:label_id/return` with URL PDF/4x6 and `carrier_default`. Link the returned provider object as `return_label` with safe metadata. Retrying returns the existing linked return label without a second provider call.
5. Record return-label financial evidence idempotently. Provider cost is `recognized` only for `charge_event=on_creation`; otherwise it is `pending`. Never invent a refund, carrier credit, or charge. Audit return creation and reconciliation outcomes.
6. Extend order admin Shipping/Financials UI with Download label, Reconcile purchase, and Create return label controls. Money-affecting controls require explicit checkbox and reason. Show linked return labels in the provider ledger and use MASEST document URLs only.
7. Preserve all existing rate, buy, void, tracking, provider-inbox/effects, order identity, authz, and finance behavior. No DB migration unless existing `order_provider_links` and `order_financial_entries` cannot satisfy the contract.

# Constraints

- No live label purchase or live return-label creation during automated or production QA.
- No Stripe/QBO mutation and no QBO posting.
- No Playwright. Browser QA uses Chrome DevTools or Computer Use.
- Never expose API keys, provider download URLs, raw provider bodies, customer addresses, or QBO account values.
- Stable error codes only; provider error bodies stay server-side.

# Grill Gate

- Product owner: MASEST owner/finance staff; `order.write` owns label mutation, `order.read` owns documents.
- Smallest acceptable version: one outbound label plus linked return labels in existing provider/financial ledgers; no shipment-split redesign.
- Riskiest assumption: provider success after a lost purchase response. Resolve by bounded label-list query and exact shipment matching; never retry purchase automatically.
- Out of scope: live purchase, customer self-service returns, carrier-credit settlement, manifests/pickups, QBO posting, and package/freight completion.
- Failure policy: uncertain/ambiguous/no-match stays locked and visible; never infer no charge.

# Review Notes

- Inspect every auth/no-store path, SSRF/redirect/media/size guard, provider-call count, idempotency path, and zero/multiple-candidate behavior.
- Verify no return/outbound document URL or secret enters JSON or admin HTML.
- Run no live money-moving provider request.
- Do not run `npm test` or any broad test glob: direct and indirect browser fixtures are mixed into `tests/`. Run only frontmatter's explicit Node test files; browser QA uses Chrome DevTools or Computer Use.

# Design Decision: Return Attempt Projection

`order_provider_links` remains canonical provider identity/history and `order_financial_entries` remains canonical immutable cost evidence. Neither ledger can coordinate a return before ShipStation creates a provider object: no return-label ID exists to link, and no charge amount exists to record. The additive `orders.shipstation_return_*` fields are therefore a single-current-attempt projection and atomic lock, not a second canonical ledger. They prevent concurrent duplicate return POSTs, preserve uncertain/lost-response state, and cache the active result for repair. Provider-link metadata is also accepted as retry evidence if projection columns are missing. One active return per outbound label is intentional for this idempotent slice; multi-package/split returns remain outside `masest-042`.
