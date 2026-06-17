# Phase 5 — User + Admin dashboards

Built on the existing Netlify + Supabase commerce backend. **Marketing pages untouched.** New endpoints
degrade gracefully (return empty/401) until the migration + env vars below are applied, so deploying this
does not break the live site.

## What shipped

### User dashboard — `dashboard.html` + `js/dashboard.js`
Tabs: Overview · Orders (history + status + reorder) · Messages (support thread) · Notifications ·
Addresses (save/remove ship & bill) · Payment (Stripe Customer Portal — saved cards/ACH) · Profile (edit name/phone).
Linked from `account.html` ("Open dashboard") once signed in.

### Admin console — `admin.html` + `js/admin.js`  (staff only)
Tabs: Overview (revenue, orders, pending accounts, unread msgs, low stock, 7-day traffic) ·
Orders (change status, notifies buyer) · Accounts (approve / set NET terms + credit / suspend) ·
Products & stock (edit price/mode/stock/active, add SKU, soft-delete) · Messages (reply to buyer threads) ·
Offers (broadcast in-app notification to an audience, optional Resend email) · Traffic & SEO (first-party
pageview analytics + live SEO audit of the marketing pages + sitemap/robots links).

### API (Netlify functions, all v2 ESM)
User (Bearer token): `account-orders`, `account-order`, `account-addresses`, `account-messages`,
`account-notifications`, `account-profile`, `account-billing-portal`.
Admin (staff gate): `admin-stats`, `admin-orders`, `admin-companies`, `admin-products`, `admin-messages`,
`admin-offers`, `admin-traffic`. Public: `track` (pageview beacon).
Shared gate `requireStaff()` added to `netlify/lib/supabase.js`. Beacon `js/track.js` wired into all 8 public pages.

### Data — `supabase/schema-phase5.sql` (additive)
New tables `messages`, `notifications`, `offers`, `page_views`; new columns
`products.stock/track_stock`, `product_variants.stock/track_stock`, `companies.stripe_customer_id`,
`profiles.is_staff`. RLS + grants included.

## Owner steps to make it fully live

1. **Run the migration.** Supabase SQL editor → paste `supabase/schema-phase5.sql` → run. Safe to re-run.
2. **Set `ADMIN_EMAILS`** in Netlify env (comma-separated). This is the *authoritative* staff gate — any
   signed-in Supabase user whose email is listed can use `admin.html` and `/api/admin/*`. Default seed:
   `aoaljamal@gmail.com`. Then register/sign in with that email at `account.html`, open `/admin.html`.
3. **Stripe Customer Portal**: activate it once in the Stripe Dashboard (Settings → Billing → Customer portal),
   else `account-billing-portal` errors. `STRIPE_SECRET_KEY` must be set (already used by checkout).
4. **(optional) `RESEND_API_KEY` + `RESEND_FROM`** to let admin offers also email recipients.
5. Redeploy (push to `netlify-commerce`).

## Security notes
- Admin authority is enforced **server-side** (`requireStaff` → `ADMIN_EMAILS`), never trusting the client.
  `admin.html` only reflects the 401/403/200 from the server.
- All buyer reads are company-scoped via the service-role functions; cross-company access is blocked.
- All dynamic text is HTML-escaped client-side (XSS) and inputs are validated/clamped server-side.
- Payment stays PCI SAQ-A: card management is the hosted Stripe portal; no card data on our pages.
- `account/dashboard/admin/cart` are `noindex`; `admin.html` is `noindex,nofollow`; `robots.txt` disallows them.

## Deferred (next)
- Decrement `products.stock` on paid orders inside `stripe-webhook.js` (columns + admin UI exist; wire the hook).
- Multi-user company invites; per-user (vs per-company) notifications targeting.
- Klaviyo *campaign* creation for offers (today: in-app notification + optional Resend blast).
- QBO invoice sync for NET orders (Phase 3) surfaced in the admin Orders tab.
