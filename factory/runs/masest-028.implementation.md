# masest-028 implementation

## Changed

- `js/cart.js`
  - Retains one request key for a logical NET cart attempt.
  - Reuses the key after response loss; cart mutation or success clears it.
- `functions/api/checkout.js`
  - Probes `place_net_order_v2` before catalog/stock validation so a retry can return
    the original order even when the first attempt consumed the last stock.
  - Uses v2 for the complete NET ledger mutation and never calls v1 or app-side
    order/item/stock writes.
  - Fails closed with 503 when v2 is unavailable.
  - Sends confirmation email only for the first successful placement.
- `supabase/schema-order-integrity.sql`
  - Keeps `place_net_order` v1 and adds `place_net_order_v2`.
  - Adds per-Company request-key uniqueness and canonical sorted SKU/quantity cart
    identity.
  - Locks Company credit and variants in sorted SKU order.
  - Atomically inserts the order/items and applies tracked-stock decrements.
  - Preserves backorder and untracked/null-stock policy.
  - Revokes PUBLIC/anon/authenticated execution; grants service-role only.
- `tools/net-order-v2-staging.mjs`
  - Creates and destroys a local disposable PostgreSQL cluster.
  - Forces a stock-update exception after the order and items are inserted, then
    proves the transaction rolls those writes back with stock unchanged.
  - Proves privileges, response-loss retry, cart conflict, stock policy, concurrent
    duplicates, and reversed-order cross-Company locking.
- Focused/source-contract tests were updated for v2 ownership and retry behavior.

## Verification

- `node --test tests/credit-enforcement.test.mjs tests/critical-money-flow.test.mjs tests/money-flow-handlers.test.mjs tests/cart.test.mjs tests/rpc-privileges.test.mjs`
  - PASS: 53/53.
- `npm run check`
  - PASS: 215 JavaScript files.
- `npm run verify`
  - PASS: 1535/1535 tests, build, site verification, commerce smoke, critical UI.
- `node tools/net-order-v2-staging.mjs`
  - PASS: privilege, forced post-insert rollback, retry/conflict, stock policy,
    concurrency.
- `git diff --check`
  - PASS.

## Implementation notes / open risk

- Small reversible assumption: logical cart identity is sorted `{sku, qty}` only.
  Catalog names/prices may change after response loss without changing retry identity.
- Disposable local PostgreSQL is implementation proof, not maintainer approval to
  migrate production.
- No production SQL was executed.
- Independent review accepted the disposable PostgreSQL proof; advisor tracker row
  028 is `DONE`.
- Spec remains active at `factory/specs/active/masest-028.md` for review.
