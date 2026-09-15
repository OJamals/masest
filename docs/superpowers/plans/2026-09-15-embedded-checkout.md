# Embedded Checkout Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. Spec:
> `docs/superpowers/specs/2026-09-15-embedded-checkout-design.md` (read its "Checked against the
> pinned type definitions" table first; every Stripe fact below comes from it).

**Goal:** the buyer pays on `checkout.html` with the Payment Element (cards + ACH only). Stripe's
hosted page leaves the flow. Promotions move to a "Have a code?" field on our page. Quote
checkout keeps its attempt ledger but stops storing a session URL.

**Ships as one change.** The session mode, the browser payment step, the promo field and the
quote reuse path must land together: a server returning `client_secret` breaks the redirect
browser, and hosted-page promo entry disappears the moment the session is embedded.

**Order of operations at release:** apply the quote-attempt migration to production first (it
only relaxes constraints, so the live hosted-page code keeps working), then push the code.

---

## Task 1: Session parameters in `elements` mode

**Files:** `functions/_lib/checkout-session.js` (`buildStripeCheckoutSessionParams` L78-187),
`functions/api/checkout.js` (L167-170 shipping-quote gate)

- [ ] `ui_mode: "elements"`; `return_url: ${appUrl}/order-confirmed.html?session_id={CHECKOUT_SESSION_ID}`; delete `success_url`, `cancel_url`.
- [ ] A shipping selection is mandatory: throw `shipping_quote_required` when `checkoutFulfillmentStripeTransport` yields no `selectedAddress`; delete the `shipping_address_collection` branch and the `customer_update` branch that only ran without a selected address.
- [ ] `billing_address_collection: "auto"` always (the page collected billing; `required` would make Stripe demand fields the Payment Element is told not to show).
- [ ] **Decide first:** the token gate is conditional on `SHIPPING_QUOTE_SECRET` (prod has it set). Making it unconditional breaks handler tests that call `/api/checkout` with no token — `tests/money-flow-handlers.test.mjs` (19 handler calls, 2 token refs), `tests/store-credit-checkout.test.mjs` (3, 0), `tests/quote-checkout.test.mjs` (2, 0), `tests/checkout.test.mjs` (6, 4). Either give those fixtures a signed shipping selection, or keep the unset-secret path building a session without a selection (never reached in prod). Pick one before editing.
- [ ] Keep `payment_method_types: ["card", "us_bank_account"]`, `shipping_options`, metadata, `customer`/`customer_email`, `automatic_tax`, `allow_promotion_codes`, store-credit `expires_at`.
- [ ] Tests: `tests/checkout-session.test.mjs`, `tests/checkout-tax.test.mjs` (L119-121), `tools/checkout-connector.spec.mjs` (L19-21) — assert `ui_mode`, `return_url`, absent `success_url`/`cancel_url`/`shipping_address_collection`, and the missing-selection throw.

## Task 2: `/api/checkout` responds with the client secret

**Files:** `functions/api/checkout.js` (L590 quote path, L604-627 direct + store credit)

- [ ] Direct and store-credit paths return `{ client_secret, session_id, promotions_allowed }` (+ `store_credit_amount_minor`). Reject a provider response without `client_secret` as 502 `stripe_error`.
- [ ] Quote path returns `{ client_secret, session_id, quote_checkout_attempt_id, promotions_allowed: false }`.
- [ ] Tests: `tests/checkout.test.mjs`, `tests/checkout-commerce-context.test.mjs`, `tests/checkout-pricing.test.mjs`, `tests/checkout-stock.test.mjs`, `tests/store-credit-checkout.test.mjs`, `tests/store-credit-contract.test.mjs` (all stub `create` returning `url`).
- [ ] Real-SDK contract test in `tests/stripe-sdk-contract.test.mjs`: `checkout.sessions.create` encodes `ui_mode=elements` and `return_url`, and the handler hands back the stubbed `client_secret`.

## Task 3: Quote attempts without a session URL

**Files:** new `supabase/migrate-quote-checkout-elements-2026-09-15.sql` +
`supabase/rollback-quote-checkout-elements-2026-09-15.sql`; `supabase/schema-quote-lifecycle.sql`
(L355-366 check, L710-765 attach RPC); `functions/_lib/quote-checkout-attempt.js`
(L99-108 attach, L188-193 `validSession`, L252, L277-284, L407-411 reuse)

- [ ] Migration: `quote_checkout_attempt_session_shape_chk` stops requiring `stripe_session_url`; `attach_quote_checkout_session` accepts a null URL (still rejects a non-null value that is not `https://`). Rollback restores both (safe only while no open attempt has a null URL — say so in the file). Mirror the final state in `schema-quote-lifecycle.sql`.
- [ ] `attach` passes `session.url ?? null`. `validSession` on create requires a `client_secret` for an `open` session instead of a URL.
- [ ] Reuse: retrieve the stored `stripe_session_id`. If `open` and it carries `client_secret`, return `{ clientSecret, sessionId, attemptId, reused: true }`. Otherwise (no secret, expired, complete) run the existing reconcile path and claim again. Never store the secret.
- [ ] Tests: `tests/quote-checkout-attempt.test.mjs`, `tests/quote-checkout.test.mjs`, `tests/quote-workflow-stateful.test.mjs` — both reuse branches (secret returned; secret absent → expire + new attempt), and any SQL-pinning test for the check/RPC text.

## Task 4: Payment step on `checkout.html`

**Files:** `js/cart.js` (`checkout()` L166-214), `js/checkout.js` (pay handler L909-956,
`invalidateRates` L409-429, `renderTotals` L471-490), `checkout.html` (summary L130-155),
`css/style.css` (checkout summary ~L4686-4728)

- [ ] `cart.checkout()` returns the server payload and never navigates.
- [ ] Load `https://js.stripe.com/dahlia/stripe.js` once, on the first pay click (static, pinned URL; guard test so it cannot drift to `/v3/`).
- [ ] `stripe.initCheckoutElementsSdk({ clientSecret })` (synchronous) → `await checkout.loadActions()`; mount `createPaymentElement({ fields: { billingDetails: { name: 'never', email: 'never', phone: 'never', address: 'never' } }, wallets: { applePay: 'never', googlePay: 'never' } })` into a new `#checkoutPayment` container; the pay button becomes "Pay {session.total.total.amount}".
- [ ] Render totals from the session on `checkout.on('change')` (Stripe requires the page to display `total.total`), including tax and discounts.
- [ ] Confirm with `email`, `phoneNumber`, `shippingAddress` and `billingAddress` built from `state.quote.address` / `state.quote.billing_address` (`{ name, address: { line1, line2, city, state, postal_code, country } }`), `redirect: 'if_required'`. On `type: 'success'` go to `order-confirmed.html?session_id=…`; on `type: 'error'` show `error.message` inline and re-enable.
- [ ] Any address, cart, rate or store-credit change after the payment step opened unmounts the element and discards the session (the next click creates a new one; the old session expires on its own).
- [ ] Copy: "Continue to payment" opens the step; hint and trust lines stay true.

## Task 5: "Have a code?" promo field

**Files:** `checkout.html` (replace `#checkoutPromoNote` L142), `js/checkout.js`, `css/style.css`

- [ ] `<details>` "Have a code?" rendered only when the response has `promotions_allowed: true` (never for quotes).
- [ ] Apply → `actions.applyPromotionCode(code)`; `invalidCode` → "That code isn't valid for this order."; success shows the code with a Remove button (`removePromotionCode`) and the discount line from `session.discountAmounts`.

## Task 6: Browser tests

- [ ] `tools/cart-checkout-redirect.spec.mjs` → rewrite for the embedded step: route `js.stripe.com/dahlia/stripe.js` to a local fake exposing `Stripe().initCheckoutElementsSdk` (records confirm args, returns success/decline), assert the confirm payload carries the validated addresses, the decline message renders inline, success lands on `order-confirmed.html`.
- [ ] `tools/checkout-validation.spec.mjs`, `tests/checkout-page.test.mjs`, `tests/checkout-ui.test.mjs` updated for the new markup.
- [ ] Promo field: shown for retail carts, hidden for quotes, invalid-code message.
- [ ] Run `qa:commerce-smoke`, `qa:ui-critical:interaction`, `qa:workspace-regressions`, then `npm test` alone.

## Task 7: Cache token

- [ ] Public token `20260915a` is spent: bump every pinned `?v=` for changed public assets to a new token and update the guard tests (see memory "UX sweep + cache-bust pin").

## Task 8: Release

- [ ] Owner OK, then apply the migration with psql (`docs/support-ticket-release.md` pattern), verify the new check definition, then push; watch Verify; confirm `/api/checkout` on prod returns `client_secret` for a stub cart only via tests, not a live purchase.
- [ ] Owner decision after deploy: a real low-value card purchase + refund, and an ACH test, since `.dev.vars` has live keys only (the spec's unverified ACH and redirect-landing behaviour).
