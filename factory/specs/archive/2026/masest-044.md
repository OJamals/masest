---
id: masest-044
title: Deepen the Checkout fulfillment contract
agent: codex
risk: high
grill: completed
verification:
  - node --test tests/checkout-commerce-context.test.mjs tests/checkout-shipping-contract.test.mjs tests/checkout-session.test.mjs tests/checkout.test.mjs tests/stripe-customer.test.mjs tests/account-reorder-receipt.test.mjs
  - npm run qa:commerce-smoke
  - npm run check
  - npm run build
  - npm run verify:site
  - git diff --check
---

# Grill Gate

- Owner: MASEST product owner owns Buyer checkout behavior; authenticated Buyer/Company identity comes from Supabase; Stripe, Google, and ShipStation remain external authorities only for their specialty.
- Problem: database/provider failures can silently downgrade authenticated commerce context, misroute transactional email, detach paid postage from carton geometry, accept stale browser responses, hang indefinitely, or misreport catalog outages as discontinued products.
- Out of scope: new payment methods, self-serve NET checkout, freight/LTL pricing, live Stripe/ShipStation mutations, deployment, and redesigning the cart/checkout pages.
- Review failure: any authenticated read error falls back to retail/guest behavior; the active Buyer email loses to shared Stripe Customer data; a signed purchasable rate exists without a durable carton plan; stale response enables payment; provider request has no deadline; catalog error returns an unavailable-item result.
- Riskiest assumption: profileless authenticated users are legitimate retail Buyers while profile/company query failures are not. Preserve that distinction explicitly.
- Smallest acceptable: one fail-closed commerce-context interface, one immutable Checkout recipient, durable package-plan binding, stale-request suppression, bounded provider calls, and correct reorder failure propagation.

# Context

The current happy path passes focused tests and live read-only rate probes. Failure semantics are shallow across `supabase.js`, Checkout, shipping, Stripe Customer reuse, browser request lifecycle, and reorder. Deepen one Checkout fulfillment-contract module; keep provider and persistence details behind adapters.

# Acceptance Criteria

1. Add one server-side authenticated commerce-context resolver returning explicit `user`, `profile`, `company`, pricing tier, tax/account context, and typed read outcome. A successful missing profile/company remains a supported retail state. Any query error fails closed with a stable retryable error before pricing or Stripe access.
2. Use the same resolved snapshot for server pricing, tax, Company metadata, Stripe Customer selection, Order ownership, account tracking, and reorder authorization. Remove independent best-effort fallbacks at these seams.
3. Bind one validated active Checkout Buyer email into immutable server-created Session metadata. Order persistence and all transactional effects prefer that bound recipient over shared Stripe Customer/customer-details email. Test two Buyers sharing one Company Stripe Customer.
4. Persist every exact rated carton plan before returning a signed purchasable rate. The signed selection binds rate ID, plan identity/digest, address/cart digest, amount, currency, and expiry. Persistence error returns a retryable failure; not-found and storage error are distinct.
5. Current-version Checkout and webhook paths cannot acknowledge a paid Order without the bound package plan. Legacy Sessions require an explicit compatibility marker and visible review state; no silent catalog recomputation.
6. Checkout address/rate and cart ZIP-estimate requests use generation identity plus cancellation. Apply a response only while its submitted cart/address/ZIP/billing snapshot is current. Edits keep payment disabled. Cover delayed old responses.
7. Google, ShipStation, and browser composite shipping calls have bounded abort deadlines and stable retryable timeout responses. No raw provider body reaches clients.
8. Reorder propagates catalog read failure as a retryable server/UI error; it never converts an error into “None of these items are available to reorder.”
9. Preserve guest Checkout, quote-only bulk routing, exact server-side catalog pricing, signed shipping selection, Stripe webhook idempotency, and the existing cart → checkout split.

# Constraints

- Reuse canonical `shipping-packages.js`, Checkout, Order, and integration-effect implementations. No parallel cart, pricing, tax, or order model.
- Preserve unrelated dirty UI remediation in `js/checkout.js`, `cart.html`, `checkout.html`, and tests; re-read before every edit.
- No live charge, refund, label purchase, email send, production write, commit, push, or deploy.
- Stable public error codes; provider/database detail remains server-side.

# Review Notes

- Inspect guest/profileless/query-error distinctions, shared-Customer recipient precedence, plan write/read failure, webhook replay, stale UI races, abort cleanup, and legacy Session handling.
- Behavior tests must prove failures; source-regex tests alone do not satisfy this spec.

# Acceptance Evidence

- Focused Checkout/account/shipping suite passed; merged repository suite passed 2,234/2,234.
- Commerce browser QA passed 31/31; build and site verification passed.
- `schema-checkout-shipping-quotes.sql` applied to configured PostgreSQL and passed a second idempotency run.
- Live object/constraint checks passed; Order/Quote/provider row counts stayed unchanged.
