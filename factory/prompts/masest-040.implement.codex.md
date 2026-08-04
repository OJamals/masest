You are implementing Loop Factory spec `masest-040`.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-040.md`
        Spec hash: `df332afbcfe660aa17aeaa6cf7a9664f3a22112995fe862f4b02dbb3bc190f71`

        Operating rules:
        - Treat spec as source of truth.
        - Automate code generation and verification, not product decisions.
        - If spec is ambiguous, make smallest reversible assumption and record it in implementation notes.
        - Keep changes scoped to acceptance criteria.
        - Update living spec only for facts learned from implementation or tests.
        - Do not archive spec. Review step does that.
        - Use Codex subagents when work splits cleanly. Ask explicitly before spawning. Keep final answer terse with files changed and checks run.

        Required verification:
        - `node --test tests/shipstation-orders.test.mjs tests/shipstation-admin.test.mjs tests/admin-event-delegation.test.mjs tests/provider-financial-ledger.test.mjs`
- `node tools/verify-provider-financial-ledger.mjs --verify`
- `npm run check`
- `npm run build`
- `npm run verify:site`
- `git diff --check`

        Deliverables:
        1. Implement acceptance criteria.
        2. Run verification commands or explain why unavailable.
        3. Add notes under `factory/runs/` or in final response: changed files, checks, open risks.
        4. Leave spec in `factory/specs/active/` for review.

        Spec:
        ---
        # Grill Gate

- Owner: MASEST maintainer; user approved deeper ShipStation, order, Stripe, QuickBooks, CMS/CRM, and admin-finance integration.
- Problem: staff can buy labels but cannot safely void a mistaken label; postage purchase/void evidence is not an immutable finance record.
- Out of scope: live label purchase/void in automated QA; return-label creation; carrier refund settlement polling; QBO production posting; Stripe payout posting; batches/manifests/pickups.
- Review failure: wrong order/label can be voided; concurrent requests call provider twice; in-transit/delivered labels can be voided; rejected/ambiguous provider response creates a refund entry; void permits no explicit confirmation/reason; purchase/void finance evidence duplicates or disappears; secrets/provider raw payload reach browser or DB.
- Riskiest assumption: ShipStation `approved: true` confirms label void and refund request, not carrier refund settlement.
- Smallest acceptable: order-scoped idempotent claim, server confirmation/reason checks, provider `PUT /v2/labels/{label_id}/void`, fail-closed ambiguous state, immutable purchase plus pending-void ledger entries, audited admin control, tests, schema verifier, rollback.

# Context

Task 13.2 is live. This is Task 13.3 slice A plus finance evidence needed by Task 13.8. ShipStation has no sandbox. Official void semantics require preserving the difference between an approved void/refund request and a settled carrier credit.

# Acceptance Criteria

- Only authenticated staff with `order.write` can invoke `void_label`; request requires exact current order/label, `confirm: true`, and a bounded nontrivial reason.
- Atomic database claim ensures one provider void call. Already-voided same-label retry returns the prior result without provider access.
- Shipped, in-transit, out-for-delivery, and delivered states are blocked before claim/provider access.
- Provider call is `PUT /v2/labels/{label_id}/void`. `approved: true` records `label_voided`; rejected response records a safe failure without refund evidence; timeout/5xx after claim records `void_reconcile_required` without refund evidence.
- Successful void preserves provider/order identity history, clears active print/tracking data, appends shipment and staff audit events, and permits a later new label purchase.
- Immutable `order_financial_entries` records confirmed label purchases as recognized positive postage cost and approved void/refund requests as pending negative cost. Unique source/type/provider-object keys make retries idempotent. Pending void is excluded from realized cost until a future refund-settlement slice appends confirmed credit.
- Existing labels with known cost are backfilled once. Purchase retries repair missing purchase-ledger evidence before returning existing label.
- Admin order shipping controls expose an inline reason plus explicit checkbox; void button is unavailable after carrier movement and never exposes provider secrets/raw payload.
- Production smoke uses Chrome DevTools only and performs read/auth-guard checks; no live label mutation.

# Constraints

- Preserve current API and database behavior outside this slice.
- Keep provider ID validation and error redaction.
- Keep label identity/provider links immutable even when current order fields advance to a replacement label.
- Schema must be re-runnable; rollback must remove only this slice and restore the prior label-purchase claim behavior.
- Produce modified artifact, patch, exact verification record, and runnable rollback.

# Review Notes

- Check provider ambiguity boundary, ledger sign/state semantics, concurrency, replacement-label path, XSS-safe UI interpolation, permissions, and rollback parity.
