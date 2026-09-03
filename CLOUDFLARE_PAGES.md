# MASEST Cloudflare Pages

Production Pages URL: `https://masest-commerce.pages.dev/`
Custom domain: `https://masest.co/`

Cloudflare Pages project:

- Project name: `masest-commerce`
- Production branch: `main`
- Static publish root: `dist/`, built and uploaded by GitHub Actions
- Pages Functions: `functions/` routes `/api/*`

## Deployment pipeline

`medicux/masest` is the canonical deployment repository. A push to `main` runs
`.github/workflows/verify.yml`, refreshes published CMS snapshots from Supabase,
runs the complete verification gate, and then uploads `dist/` directly to the
existing `masest-commerce` project with Wrangler.

The Pages workflow does not deploy the separately versioned email Worker. When
`workers/email-service/`, `shared/email-bridge.js`, or the Worker's package
dependencies change, deploy the Worker first from a clean, verified checkout:

```bash
npx wrangler deploy --config workers/email-service/wrangler.jsonc --keep-vars
```

Then push the same commit to `main` and let `verify.yml` publish Pages. Keeping
the releases in that order prevents new Pages code from calling an older Worker
contract. `--keep-vars` preserves dashboard-managed Worker variables while the
checked-in bindings remain authoritative.

The old Cloudflare-native `OJamals/masest` Git source is retained only as
historical project metadata; its production and preview auto-deployments are
disabled. Do not re-enable that source or recreate the Pages project: the
existing project owns the production domains, bindings, and encrypted secrets.

Required `medicux/masest` Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` — snapshot read only; restricted by `content_entries` RLS + column grants
- `BLOG_NEWSLETTER_SECRET`
- `NEWSLETTER_CRON_SECRET`

CMS publication uses `GITHUB_DISPATCH_TOKEN` and
`GITHUB_DISPATCH_REPO=medicux/masest` in the Pages production environment.
General content emits `site-content-published`; blog content emits
`content-published`, which first commits generated blog files and then dispatches
the same verified production workflow.

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
- `ORDER_NOTIFY_EMAIL`
- `EMAIL_REPLY_TO=team@masest.co`
- `MESSAGE_REPLY_DOMAIN=reply.masest.co`
- `MESSAGE_REPLY_SECRET`
- `EMAIL_INGRESS_SECRET`
- `EMAIL_UNSUB_SECRET` — signs one-click unsubscribe and online-view URLs
- `AWS_SES_ACCESS_KEY_ID` — dedicated least-privilege IAM access key
- `AWS_SES_SECRET_ACCESS_KEY` — matching IAM secret
- `AWS_SES_REGION=us-east-1`
- `AWS_SES_FROM_EMAIL=dev@masest.co`
- `AWS_SES_FROM_NAME=MASEST · VertKleen`
- `AWS_SES_REPLY_TO=dev@masest.co`
- `AWS_SES_CONFIGURATION_SET=masest-marketing`

Required Pages binding:

- `EMAIL_SERVICE` — service binding to `masest-email-service`.
- `CONTENT_IMAGES` — R2 bucket binding to `masest-site-images` in production and preview.

Email Worker owns restricted `EMAIL` binding, idempotency Durable Object,
lifecycle queue, and inbound Email Routing handler for service/transactional mail,
including requested quote follow-ups. Pages signs one-recipient Amazon SES calls for
consented promotional offers, newsletters, nurture, and review solicitations. Supabase
owns canonical consent, suppression, and durable delivery rows.

After env var changes, run the `Verify` workflow on `main` so the new values bind.

## Public content images

Public CMS and site-library images live in the R2 bucket `masest-site-images`.
The bucket custom domain is `https://media.masest.co`; do not use its development
`r2.dev` URL in production content. Preserve object keys such as `site/img/...`
and `cms/...` so legacy Supabase URLs can map without redirects or duplicate
metadata.

Configure the `CONTENT_IMAGES` R2 binding on both production and preview before
deploying code that writes content assets. A binding change requires a new Pages
deployment. Keep the Supabase `content-assets` objects during cutover. Rollback is
a code revert plus a verified Pages redeploy; the original bytes remain available.

Migration and full-byte verification:

```bash
npm run migrate:content-images
npm run migrate:content-images -- --execute
CMS_MEDIA_BASE=https://media.masest.co/site npm run verify:cms-images
```

## Customer-message email replies

The dashboard is the primary message inbox. Cloudflare Email Routing receives
`reply+<message-id>.<signature>@reply.masest.co` and invokes
`masest-email-service`. The Worker parses the message, signs a bounded JSON
projection, and posts it to `/api/email/inbound`. Pages verifies the signature,
the addressed chat message, the exact customer/staff participant, and the linked
order before atomically appending through the same support-chat RPC.

Use the dedicated `reply.masest.co` routing subdomain. Never replace the apex
`masest.co` MX records used by the existing hosted mailbox. Set the identical
`EMAIL_INGRESS_SECRET` on Worker and Pages, and set `MESSAGE_REPLY_SECRET` only
on Pages. Delivery events arrive through `masest-email-events` at
`/api/email/events` using the same signed bridge.

## Supabase Auth Email

Supabase Auth confirmation, resend, invite, and password-reset emails are sent
by Supabase Auth, not by the Pages Functions `sendEmail` helper. Configure this
in Supabase Dashboard -> Authentication -> Emails -> SMTP Settings.

Configure Cloudflare Email Service SMTP with:

- Host: `smtp.mx.cloudflare.net`
- Port: `465`
- Username: `api_token`
- Password: an account-owned Cloudflare API token with `Email Sending: Edit`
- Sender: `MASEST <noreply@send.masest.co>`

The API token must belong to the Cloudflare account where `send.masest.co` is
verified for Email Sending. Cloudflare does not expose a sender-domain resource
scope for this token, so keep it account-owned with only `Email Sending: Edit`.
If signup logs show an SMTP sender or domain authorization error, the site code
has already reached Supabase Auth; replace the Auth SMTP credential with one
tied to the correct Cloudflare account, then retry signup.

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

Apply `supabase/schema-qbo.sql`, `supabase/schema-qbo-refunds.sql` (the refund-to-credit-memo queue), `supabase/schema-qbo-subscriptions.sql` (paid Stripe program invoices), `supabase/schema-qbo-reaper.sql` (visibility-timeout claims that reclaim stuck `processing` rows), `supabase/schema-provider-inbox.sql`, and then `supabase/schema-rpc-hardening.sql`. Apply `supabase/qbo-cron.example.sql` after replacing `<QBO_SYNC_SECRET>`. The cron template requires Supabase `pg_cron`, `pg_net`, and `pgcrypto`, and it stores a SHA-256 hash of the sync secret in Supabase as a fallback when Cloudflare Pages secret edits are unavailable.

Set QuickBooks config in Cloudflare Pages before enabling the worker. Preferred:

- `QBO_CONNECT_KEY` — JSON, base64 JSON, or `KEY=value` lines containing:
  `client_id`, `client_secret`, `redirect_uri`, `oauth_state_secret`,
  `sync_secret`, `environment`, and optionally `realm_id` and
  any `*_account_id` mapping listed below. If `income_account_id` is omitted,
  sync auto-detects an Income account from the connected QuickBooks company.

Or set the individual secrets:

- `QBO_CLIENT_ID`
- `QBO_CLIENT_SECRET`
- `QBO_REDIRECT_URI=https://masest.co/api/admin/qbo/callback`
- `QBO_OAUTH_STATE_SECRET`
- `QBO_SYNC_SECRET`
- `QBO_WEBHOOK_VERIFIER_TOKEN` (Intuit production webhook verifier token)
- `QBO_INCOME_ACCOUNT_ID` (optional; otherwise auto-detected after connection)
- `QBO_ENVIRONMENT=sandbox` or `production`

Admin **Finance → Stripe bank deposits** reads recent live standard payouts and their
balance transactions, using integer minor-unit totals. It does not create QuickBooks
transactions. Future payout posting stays disabled until every account below is supplied
either inside `QBO_CONNECT_KEY` or as its own Cloudflare production binding:

- `QBO_INCOME_ACCOUNT_ID`
- `QBO_SHIPPING_INCOME_ACCOUNT_ID`
- `QBO_MERCHANT_FEES_ACCOUNT_ID`
- `QBO_POSTAGE_EXPENSE_ACCOUNT_ID`
- `QBO_STRIPE_CLEARING_ACCOUNT_ID`
- `QBO_BANK_ACCOUNT_ID`
- `QBO_TAX_LIABILITY_ACCOUNT_ID`
- `QBO_DISCOUNTS_ACCOUNT_ID`
- `QBO_REFUNDS_ACCOUNT_ID`
- `QBO_DISPUTES_ACCOUNT_ID`

Only presence/missing state is returned to the browser. Account IDs and provider objects
remain server-side. An accountant-reviewed journal design is required before adding any
posting route.

Connect QuickBooks from `admin.html`. The schedule triggers `POST /api/qbo-sync`; manual runs can use the same endpoint with header `x-qbo-sync-secret: $QBO_SYNC_SECRET`.
Configure Intuit production webhooks at `https://masest.co/api/qbo-webhook`. The route verifies the raw body with `QBO_WEBHOOK_VERIFIER_TOKEN`, records `intuit-t-id` as transport audit only, accepts request bodies through 2 MiB, and ACKs only after one atomic generic provider receipt/effect batch commits. Current CloudEvent types are parsed from authoritative `qbo.<entity>.<operation>.vN` segments; variable `data` fields never define routing identity.
Generated NET invoices are created with online card and ACH payment options enabled; the connected QuickBooks Online company must have QuickBooks Payments enabled for those options to appear to buyers.
Stripe-paid checkout orders sync to QuickBooks as an invoice plus a linked QBO payment. The QBO payment reference is the Stripe PaymentIntent id, so Stripe remains the processor while QuickBooks remains the invoice/accounting source of truth.
Approved MASEST businesses sync to QuickBooks customers with their Stripe customer id in the customer notes. Paid Stripe program subscription invoices also sync as a QBO invoice plus linked payment, keyed by Stripe invoice id for retry-safe reconciliation. The Stripe webhook must subscribe to `invoice.paid` in addition to the documented checkout, subscription lifecycle, payment-failure, dispute, and refund events.
