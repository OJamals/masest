# MASEST Cloudflare Pages

Production Pages URL: `https://masest-commerce.pages.dev/`
Custom domain: `https://masest.co/`

Cloudflare Pages project:

- Project name: `masest-commerce`
- Production branch: `main`
- Static publish root: repository root as deployed by the Pages project
- Pages Functions: `functions/` routes `/api/*`

## DNS

`masest.co` uses Cloudflare nameservers. The Pages project must have
`masest.co` added under Workers & Pages -> `masest-commerce` -> Custom domains.

The Cloudflare DNS zone must also contain:

| Type | Name | Target |
| --- | --- | --- |
| `CNAME` | `@` | `masest-commerce.pages.dev` |
| `CNAME` | `www` | `masest-commerce.pages.dev` |

Cloudflare supports CNAME flattening at the zone apex, so `@` can be a CNAME.
Do not use GitHub Pages `A` records and do not commit a `CNAME` file for this
site.

## Required Env Vars

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SHIPPING_RATE_IDS` — fallback comma-separated Stripe Shipping Rate IDs (`shr_...`);
  published CMS **Shipping rates** override it, and paid checkout fails closed when effective
  configuration is missing, disabled, or invalid
- `APP_URL=https://masest.co`
- `RESEND_API_KEY`
- `RESEND_FROM=MASEST Orders <orders@send.masest.co>`
- `ORDER_NOTIFY_EMAIL`
- `KLAVIYO_PRIVATE_KEY`
- `KLAVIYO_LIST_ID`

After env var changes, retry a production deployment so the new values bind.

## Customer-message email replies

The dashboard is the primary message inbox. To let customers reply directly to
a MASEST message email, configure Resend Receiving and set:

- `RESEND_INBOUND_DOMAIN` — use the Resend-managed `*.resend.app` receiving
  address. This requires no DNS change and must not replace the `masest.co` MX
  records used by Outlook/GoDaddy.
- `MESSAGE_REPLY_SECRET` — a new random secret used to sign per-company reply addresses.
- `RESEND_WEBHOOK_SECRET` — configure the same signed webhook at
  `https://masest.co/api/resend-webhook` with `email.received` in addition to
  the existing delivery events.

The webhook accepts only signed MASEST reply addresses and email addresses that
belong to that company. Valid replies enter Admin → Messages and notify staff.

## Supabase Auth Email

Supabase Auth confirmation, resend, invite, and password-reset emails are sent
by Supabase Auth, not by the Pages Functions `sendEmail` helper. Configure this
in Supabase Dashboard -> Authentication -> Emails -> SMTP Settings.

Use an SMTP/API key that is allowed to send from the configured sender domain.
For Resend, the key must either have full access or be scoped to the verified
`masest.co` domain that matches the Supabase Auth sender email. If signup logs
show:

```text
gomail: could not send email 1: 550 "The associated domain with your API key is not verified..."
```

the site code has already reached Supabase Auth successfully; replace the Auth
SMTP credential with one tied to the verified sending domain, then retry signup.
Do not fix this by disabling email confirmation.

## Verify

```bash
dig +short masest.co CNAME
dig +short www.masest.co CNAME
curl -I https://masest.co/
curl -s https://masest.co/api/health | python3 -m json.tool
curl -s "https://masest.co/api/products?cb=$(date +%s)"
```

## QuickBooks Online

Apply `supabase/schema-qbo.sql`, `supabase/schema-qbo-refunds.sql` (the refund-to-credit-memo queue), `supabase/schema-qbo-subscriptions.sql` (paid Stripe program invoices), `supabase/schema-qbo-reaper.sql` (visibility-timeout claims that reclaim stuck `processing` rows), and then `supabase/schema-rpc-hardening.sql`. Apply `supabase/qbo-cron.example.sql` after replacing `<QBO_SYNC_SECRET>`. The cron template requires Supabase `pg_cron`, `pg_net`, and `pgcrypto`, and it stores a SHA-256 hash of the sync secret in Supabase as a fallback when Cloudflare Pages secret edits are unavailable.

Set QuickBooks config in Cloudflare Pages before enabling the worker. Preferred:

- `QBO_CONNECT_KEY` — JSON, base64 JSON, or `KEY=value` lines containing:
  `client_id`, `client_secret`, `redirect_uri`, `oauth_state_secret`,
  `sync_secret`, `environment`, and optionally `realm_id` and
  `income_account_id`. If `income_account_id` is omitted, sync auto-detects an
  Income account from the connected QuickBooks company.

Or set the individual secrets:

- `QBO_CLIENT_ID`
- `QBO_CLIENT_SECRET`
- `QBO_REDIRECT_URI=https://masest.co/api/admin/qbo/callback`
- `QBO_OAUTH_STATE_SECRET`
- `QBO_SYNC_SECRET`
- `QBO_INCOME_ACCOUNT_ID` (optional; otherwise auto-detected after connection)
- `QBO_ENVIRONMENT=sandbox` or `production`

Connect QuickBooks from `admin.html`. The schedule triggers `POST /api/qbo-sync`; manual runs can use the same endpoint with header `x-qbo-sync-secret: $QBO_SYNC_SECRET`.
Generated NET invoices are created with online card and ACH payment options enabled; the connected QuickBooks Online company must have QuickBooks Payments enabled for those options to appear to buyers.
Stripe-paid checkout orders sync to QuickBooks as an invoice plus a linked QBO payment. The QBO payment reference is the Stripe PaymentIntent id, so Stripe remains the processor while QuickBooks remains the invoice/accounting source of truth.
Approved MASEST businesses sync to QuickBooks customers with their Stripe customer id in the customer notes. Paid Stripe program subscription invoices also sync as a QBO invoice plus linked payment, keyed by Stripe invoice id for retry-safe reconciliation. The Stripe webhook must subscribe to `invoice.paid` in addition to the documented checkout, subscription lifecycle, payment-failure, dispute, and refund events.
