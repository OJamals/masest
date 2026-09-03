# Phase 5 — User + Admin dashboards

Built on the existing Cloudflare Pages + Supabase commerce backend. **Marketing pages untouched.** New endpoints
degrade gracefully (return empty/401) until the migration + env vars below are applied, so deploying this
does not break the live site.

## What shipped

### User dashboard — `dashboard.html` + `js/dashboard.js`
Tabs: Overview · Orders (history + status + reorder) · Messages (the signed-in user's support thread, refresh/chat controls, email setting) · Notifications ·
Addresses (save/remove ship & bill) · Payment (Stripe Customer Portal — saved cards/ACH) ·
Profile (edit name/phone) · Business (company setup, approval status, team, programs, bulk requests).
Linked from `account.html` ("Open dashboard") once signed in.

### Admin console — `admin.html` + `js/admin.js`  (staff only)
Tabs: Overview (revenue, orders, pending accounts, unread msgs, low stock, 7-day traffic) ·
Orders (change status; message the exact order owner through their shared support thread) · Accounts (approve / set NET terms + credit / suspend) ·
Products & stock (edit price/mode/stock/active, add SKU, soft-delete) · Messages (reply to buyer threads) ·
Offers (broadcast in-app notification to an audience; marketing email fails closed until a dedicated provider is configured) · Traffic & SEO (first-party
pageview analytics + live SEO audit of the marketing pages + sitemap/robots links).

### API — implemented for BOTH runtimes (repo keeps both ports in sync)
- **Cloudflare Pages (LIVE — `functions/api/...`)**: `account/order`, `account/addresses`, `account/messages`,
  `account/notifications`, `account/profile`, `account/billing-portal`; `admin/stats`, `admin/orders`,
  `admin/companies`, `admin/products`, `admin/messages`, `admin/offers`, `admin/traffic`; `track`.
  (`account/orders` already existed.) Shared gate `requireStaff()` added to `functions/_lib/supabase.js`.

Beacon `js/track.js` wired into all 8 public pages.

### Data — `supabase/schema-phase5.sql` (additive)
New tables `messages`, `notifications`, `offers`, `page_views`; new columns
`products.stock/track_stock`, `product_variants.stock/track_stock`, `companies.stripe_customer_id`,
`profiles.is_staff`. RLS + grants included.

## Owner steps to make it fully live

1. **Run the migrations.** Apply `supabase/schema-phase5.sql`, then the support/email
   migrations listed in `docs/email-architecture.md`. The final
   `migrate-support-participant-threads-2026-09-03.sql` migration backfills exact
   participant and company-wide thread identities transactionally and is safe to re-run.
2. **Set `ADMIN_EMAILS`** in the **Cloudflare Pages** dashboard (project `masest-commerce` → Settings →
   Environment variables, set for **Production and Preview**), comma-separated. This is the *authoritative*
   staff gate — any signed-in Supabase user whose email is listed can use `admin.html` and `/api/admin/*`.
   Default seed: `aoaljamal@gmail.com`. CF env vars only apply to deploys made *after* saving → redeploy.
   Then register/sign in with that email at `account.html` and open `/admin.html`.
3. **Stripe Customer Portal**: activate it once in the Stripe Dashboard (Settings → Billing → Customer portal),
   else `account/billing-portal` errors. `STRIPE_SECRET_KEY` must be set (already used by checkout).
4. **Transactional email:** bind Pages `EMAIL_SERVICE` to `masest-email-service`; set
   `EMAIL_REPLY_TO`, `MESSAGE_REPLY_DOMAIN`, `MESSAGE_REPLY_SECRET`, and
   `EMAIL_INGRESS_SECRET` as documented in `CLOUDFLARE_PAGES.md`.
5. **Direct email replies:** route `reply@reply.masest.co` (with subaddressing enabled)
   to `masest-email-service`. Do not change the Proofpoint MX records for
   `masest.co`. Signed replies are verified against the exact chat message,
   customer, canonical thread, and order before entering Messages.
6. Redeploy: push to `medicux/masest` `main`; the Verify workflow runs the full gate and uploads `dist/` to Cloudflare Pages.
   Verify env presence at `/api/health`.

## Security notes
- Admin authority is enforced **server-side** (`requireStaff` → `ADMIN_EMAILS`), never trusting the client.
  `admin.html` only reflects the 401/403/200 from the server.
- Buyer reads are limited to the signed-in user's participant thread plus their
  current company's explicit business thread; cross-user and cross-company access is blocked.
- All dynamic text is HTML-escaped client-side (XSS) and inputs are validated/clamped server-side.
- Payment stays PCI SAQ-A: card management is the hosted Stripe portal; no card data on our pages.
- `account/dashboard/admin/cart` are `noindex`; `admin.html` is `noindex,nofollow`; `robots.txt` disallows them.

## Staff without a redeploy
`requireStaff` grants staff if the email is in `ADMIN_EMAILS` **or** the user's `profiles.is_staff=true`.
So after a person registers you can grant them via SQL (no CF env change / redeploy):
`update public.profiles set is_staff = true where id = (select id from auth.users where email = 'them@x.com');`
`is_staff` is only settable server-side (RLS denies client writes), so users cannot self-promote.

## Deferred (next)
- Multi-user company invites; per-user (vs per-company) notifications targeting.
- Dedicated marketing-provider delivery for offers (today: in-app notification only; email fails closed).
- QBO invoice sync for NET orders (Phase 3) surfaced in the admin Orders tab.
