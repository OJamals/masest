Review Loop Factory spec `masest-041` against current working tree.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-041.md`

        Review stance:
        - Findings first. Focus correctness, regressions, tests, security, maintainability.
        - Compare implementation against acceptance criteria.
        - Run or inspect verification evidence:
        - `node --test tests/stripe-payouts.test.mjs tests/stripe-admin.test.mjs tests/qbo-financial-coverage.test.mjs`
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

- Owner: MASEST maintainer; accountant owns final QBO chart-of-accounts selection.
- Problem: staff cannot reconcile Stripe gross/fees/net/payout composition in MASEST admin, and automatic QBO settlement posting has no explicit mapping-readiness gate.
- Out of scope: QBO write/posting; changing chart of accounts; manual/instant payout composition claims; importing customer PII; live payment/refund/payout mutation.
- Review failure: non-finance staff can read payouts; test key is accepted on production; provider raw objects/customer data leak; pagination is unbounded; fee/net math uses floats/cross-currency sums; manual payout is presented as fully composed; missing QBO mapping still permits posting.
- Riskiest assumption: automatic Stripe payouts expose complete balance-transaction composition through the payout filter; manual/instant payouts do not have Stripe-determined composition.
- Smallest acceptable: finance-gated, redacted, bounded read-only payout summaries; integer-minor-unit gross/fees/net/category totals; explicit incomplete/unsupported flags; admin display; redacted QBO mapping presence/missing list; no posting route.

# Context

Task 13.8 requires reconciling Stripe gross sales through bank payout and keeping merchant fees distinct before QBO settlement posting. Official Stripe payout reconciliation uses payout IDs plus filtered Balance Transactions. QBO account IDs are business-specific and remain owner/accountant data.

# Acceptance Criteria

- `GET /api/admin/stripe?view=payouts&limit=N` requires authenticated staff with `company.credit`; status-only GET remains staff-readable.
- Production payout view fails closed unless server credential mode is live. Response never contains API keys, customer/email/address/card data, raw descriptions, or raw Stripe objects.
- Payout list is bounded to 1–5. Automatic payouts fetch `GET /v1/balance_transactions?payout=...` with `limit=100`, bounded cursor pages, and aggregate integer minor units before formatting.
- Each payout returns ID/status/currency/amount/arrival/created/method/type/trace ID plus transaction count, gross inflow, gross outflow, fees, net, category summaries, completeness, and provider cursor truncation state.
- Multi-currency or manual/instant payout composition is marked unsupported/incomplete rather than silently summed.
- QBO mapping gate reports only present/missing for Products Income, Shipping Income, Merchant Fees, Postage Expense, Stripe Clearing, Bank, Tax, Discounts, Refunds, and Disputes. `posting_ready` is false until all are present; no write endpoint is added.
- Admin Finance → Stripe includes explicit read-only refresh, accessible loading/error/empty states, payout/category summaries, and mapping blockers.
- Tests cover authz, live/test mode, bounded pagination, integer math, negative/refund/fee entries, manual payout handling, multi-currency, provider failure redaction, UI wiring, and no mutation route.
- Production QA uses Chrome DevTools only; no Playwright and no live financial mutation.

# Constraints

- Use official Stripe endpoints and current API-key auth pattern.
- Keep payout API read-only and `Cache-Control: no-store`.
- Default three payouts; max five; max five 100-row balance-transaction pages per payout.
- Preserve existing `/api/admin/stripe` status response and Stripe production readiness behavior.
- Produce patch, verification record, rollback instructions, and updated handoff.
