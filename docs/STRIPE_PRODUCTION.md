# Stripe production readiness

Production checkout is fail-closed. When `APP_URL` is `https://masest.co` or `https://www.masest.co` (or `STRIPE_LIVE_MODE_REQUIRED=true`), checkout requires:

- `STRIPE_SECRET_KEY` beginning `sk_live_` or `rk_live_`;
- `STRIPE_WEBHOOK_SECRET` beginning `whsec_`;
- at least one published CMS `shipping_rate` entry whose `stripe_rate_id` exists, is active, and is live-mode.

Admin → Integrations → Stripe reports key mode, signing-secret presence, webhook URL/event coverage, and CMS shipping-rate mode. Secret values never reach browser.

Required webhook URL:

```text
https://masest.co/api/stripe-webhook
```

Required events:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
customer.subscription.updated
customer.subscription.deleted
invoice.payment_failed
invoice.paid
charge.dispute.created
charge.refunded
```

Create live Shipping Rate objects in Stripe, then publish their `shr_...` IDs through CMS type `shipping_rate`. Test-mode objects cannot be used with a live key.

Store `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` only in `.dev.vars` locally and encrypted Cloudflare Pages production secrets. Never place them in client JavaScript, CMS, Git, or chat.
