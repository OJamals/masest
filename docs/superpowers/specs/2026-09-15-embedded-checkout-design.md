# Embedded Stripe checkout — spec

**Status:** draft, 2026-09-15. Not started.
**Owner decisions already made:** the embedded payment step replaces the hosted Stripe page
outright (no switch); the Stripe SDK and API-version upgrade is step 1; the webhook
compatibility patch shipped first (`4efcff0c`).

## Goal

A buyer enters their address once, on `checkout.html`, and pays on the same page. Stripe's
hosted page, which asks again for name, country and ZIP, is no longer in the flow.

Why the hosted page asks again: Stripe Checkout prefills name and billing address only from a
card already saved on the Customer, so a first-time buyer always retypes them, even though we
push the validated address onto the Customer before creating the session.

## Verified facts this spec relies on

| fact | source |
|---|---|
| Checkout Sessions support an embedded mode, `ui_mode=elements`, returning a `client_secret` and using `return_url` instead of `success_url`/`cancel_url` | Stripe quickstart `payments/quickstart.md`; API `checkout/sessions/create` |
| It requires API version `2025-09-30.clover` or later | Elements-with-Checkout-Sessions changelog, "Clover upgrade" |
| `2026-03-25.dahlia` renamed the enum: `custom`→`elements`, `hosted`→`hosted_page`, `embedded`→`embedded_page`; old values fail | changelog `updates-available-checkout-session-ui-modes` |
| Stripe.js initialisation is `stripe.initCheckoutElementsSdk({ clientSecret, elementsOptions })` (renamed from `initCheckout` in dahlia) | Stripe.js reference `custom_checkout/init`; dahlia changelog |
| `actions.confirm()` accepts `email`, `phoneNumber`, `billingAddress`, `shippingAddress`, `returnUrl`, `redirect: "if_required"` | Stripe.js reference `custom_checkout/confirm` |
| The Payment Element can skip collecting billing fields (`fields.billingDetails.*: "never"`); then they must be supplied on confirm | `payment-element/control-billing-details-collection` |
| Promotion codes: `allow_promotion_codes=true` on the session plus our own field calling `applyPromotionCode` / `removePromotionCode`; there is no built-in promo field | `payments/advanced/discounts` |
| Stripe Tax works with `automatic_tax` and `billing_address_collection=auto`; `required` means we must collect a full billing address ourselves | `payments/advanced/tax?api-integration=checkout` |
| Link, Apple Pay and Google Pay in Elements need the domain registered as a payment method domain | `payments/payment-methods/pmd-registration` |
| Our SDK: `stripe` 17.7.0, pinned `2025-02-24.acacia`, no `apiVersion` override. Latest `stripe` 22.6.2 pins `2026-08-26.dahlia`. Account default `2026-05-27.dahlia`; the webhook endpoint has no pinned version | `node_modules/stripe`, npm, Stripe API (read-only) |

## What depends on the hosted page today

| area | dependency | file |
|---|---|---|
| Session creation | `success_url` `order-confirmed.html?session_id=…`, `cancel_url`, `billing_address_collection`, `allow_promotion_codes`, `payment_method_types: card, us_bank_account`, `shipping_options` from the signed quote, `customer`/`customer_email`, metadata incl. `ship_*`/`bill_*` and chunked cart | `functions/_lib/checkout-session.js:78-187` |
| API response | `handleCheckout` returns `{ url }` (quote path adds `quote_checkout_attempt_id`) | `functions/api/checkout.js:591,628` |
| Browser | pay button POSTs `/api/checkout`, then `window.location.href = url` | `js/checkout.js:909-956`, `js/cart.js:200-214` |
| Confirmation | `order-confirmed.html` reads `session_id`, `GET /api/order` retrieves the session and requires `status === "complete"` | `order-confirmed.html:80-136`, `functions/api/order.js:34-65` |
| Quote checkout | stores and reuses `stripe_session_url`, expires superseded sessions | `functions/_lib/quote-checkout-attempt.js:281,346,408-411`, `supabase/schema-quote-lifecycle.sql` |
| Promotions | copy "Enter it on the secure payment screen"; retail-tier, price-floor-safe gate | `checkout.html:142`, `functions/api/checkout.js:534-536`, `functions/_lib/coupons.js` |
| Webhook | promotion read needs `expand: discounts.promotion_code`; order row reads totals and falls back to `ship_*` metadata for the address | `functions/api/stripe-webhook.js:69`, `functions/_lib/order-shape.js` |
| Browser key | live publishable key already served, unused | `js/config.js:7` |
| CSP | none exists (no `_headers`, no meta CSP) | — |
| Tests pinning hosted behaviour | redirect to `order-confirmed.html` after Pay; `success_url`/`cancel_url`; `billing_address_collection`; `allow_promotion_codes`; session URL reuse | `tools/cart-checkout-redirect.spec.mjs:98,136,141`, `tools/checkout-connector.spec.mjs:19-21`, `tests/checkout-tax.test.mjs:97,119,121`, `tests/checkout-session.test.mjs:74`, `tests/quote-checkout*.test.mjs` |

## Plan — each step ships on its own

1. **One API version everywhere.** Upgrade `stripe` to the current major with an explicit
   `apiVersion` equal to the account default, walk every Stripe call site against the basil,
   clover and dahlia breaking-change lists, and delete the `4efcff0c` compatibility readers
   once events and SDK agree. No buyer-visible change.
2. **Server session in embedded mode.** `ui_mode: "elements"`, `return_url:
   /order-confirmed.html?session_id={CHECKOUT_SESSION_ID}`; drop `success_url`/`cancel_url`;
   keep line items, shipping option, metadata, customer and tax settings;
   `billing_address_collection: "auto"`. `handleCheckout` returns `{ client_secret }`.
3. **Payment step on `checkout.html`.** Load versioned Stripe.js, `initCheckoutElementsSdk`,
   mount the Payment Element with name, address and phone set to `never`, and confirm with
   the addresses, email and phone the page already validated. Card declines show inline; ACH
   shows Stripe's mandate text inside the element. Success lands on `order-confirmed.html`.
4. **Promo code field** on `checkout.html` wired to `applyPromotionCode`, shown only when the
   server allows promotions for the cart; replace the `checkout.html:142` copy.
5. **Quote checkout** switches from reusing a session URL to reopening the same open session
   by its client secret. Confirm in Stripe's docs that an open `elements` session can be
   retrieved with its `client_secret` before building.
6. **Tests and specs** rewritten for the embedded flow (list above), plus a Playwright spec
   against Stripe's test mode that confirms a card and an ACH payment end to end.
7. **Later, owner:** registering `masest.co` as a payment method domain would turn on Link,
   Apple Pay and Google Pay. Not in this project (see decisions).

## Owner decisions (2026-09-15)

- **Cards and ACH only at launch.** No Link, Apple Pay or Google Pay, so no payment method
  domain registration; the Payment Element is configured to show `card` and
  `us_bank_account` only.
- **Promo code behind a "Have a code?" disclosure** on `checkout.html`, rendered only when the
  server allows promotions for the cart.
- Replace the hosted page outright (no switch); SDK and API-version upgrade first.
- **Flexible billing mode** for new program subscriptions, which is the default from
  `2025-09-30.clover`. No subscriptions exist, so nothing migrates and no
  `billing_mode.type: classic` override is set.

## Risks, ranked

1. Quote checkout reuses stored session URLs; the embedded flow has no URL, so step 5 is a
   data-model change, not a rename.
2. The SDK major upgrade touches refunds, payouts, customers and coupons, not only checkout;
   step 1 must be verified per call site, not by the suite alone.
3. Promotions lose their UI until step 4 lands; steps 2–4 must ship together or promotions are
   unusable in between.
4. ACH mandate and delayed settlement must still reach `checkout.session.async_payment_*`.
5. Stripe.js versioning: pin the release-named script so a future Stripe.js release cannot
   change behaviour under us.
