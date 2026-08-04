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

## Payout reconciliation preview

Admin **Finance → Stripe payout reconciliation** calls the staff-only
`GET /api/admin/stripe?view=payouts&limit=3` endpoint. Access requires the
`company.credit` capability (owner or finance staff). The endpoint:

- requires a live `sk_live_` or `rk_live_` server key;
- lists at most five payouts per request (three by default);
- follows at most five 100-row balance-transaction pages per automatic standard payout;
- aggregates amounts, fees, and net using integer minor units;
- returns a Stripe-aware currency exponent so zero-decimal currencies such as JPY render without dividing by 100;
- returns only payout identifiers, status/timing, summary totals, and reporting categories;
- marks manual, instant, multi-currency, and provider-truncated compositions incomplete;
- sends `Cache-Control: no-store` and never returns customers, metadata, raw provider objects, or secrets.

The screen is evidence only: no Stripe mutation and no QuickBooks posting route exists.
Before posting is designed, configure all `QBO_*_ACCOUNT_ID` mappings documented in
`.env.example`, have an accountant approve the clearing/refund/dispute journal model, and
add balanced-entry and idempotency proof. The browser receives only `present`/`missing`
mapping state.
