# Reviews & Ratings System — Design

**Date:** 2026-07-08
**Status:** Approved (owner, 2026-07-08)
**Scope:** Customer product/service reviews + star ratings, verified-purchaser gated, admin-moderated, with automated post-delivery review-reminder emails and SEO AggregateRating.

## Decisions (locked)

- **Who can review:** Verified purchasers only. Writing requires proof of a fulfilled/delivered order containing the reviewed SKU (via session or signed email token). Staff can also post seed/legacy reviews from the admin panel (marked verified).
- **Moderation:** Admin-approves-first. New reviews land `pending`; only `approved` rows are public and count toward aggregates.
- **Reminder cadence:** One reminder, 10 days after delivery (fallback: 10 days after `fulfilled` when no delivery tracking). Opt-out/suppression respected. No second reminder.
- **Scope:** Products **and** services, with JSON-LD `AggregateRating`.

## Architecture

Follows existing MASEST conventions: Cloudflare Pages Functions (`functions/api/*`), Supabase (service-role via `_lib/supabase.js`), Resend via `sendEmail(env, {category,...})` with stream/suppression handling, pg_cron→endpoint sweep pattern (mirrors quote-sweep), static storefront pages hydrated by JS modules, admin panel modular (`admin.js` + `delegate()`).

### 1. Data model — `supabase/schema-reviews.sql`

```sql
create table if not exists public.product_reviews (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null default 'product',      -- 'product' | 'service'
  sku               text not null,
  order_id          uuid references public.orders(id) on delete set null,
  user_id           uuid,                                 -- auth user when logged in
  author_name       text not null,
  author_email      text not null,                        -- private: dedupe + verified match, NEVER returned publicly
  rating            smallint not null check (rating between 1 and 5),
  title             text,
  body              text,
  verified_purchase boolean not null default false,
  source            text not null default 'customer',     -- 'customer' | 'staff_seed'
  status            text not null default 'pending',       -- 'pending' | 'approved' | 'rejected'
  staff_note        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- One customer review per SKU per order. Staff-seed rows have order_id NULL so are exempt.
create unique index if not exists product_reviews_order_sku_uq
  on public.product_reviews (order_id, sku) where order_id is not null;
create index if not exists product_reviews_public_idx
  on public.product_reviews (kind, sku, status);
create index if not exists product_reviews_moderation_idx
  on public.product_reviews (status, created_at desc);

alter table public.orders add column if not exists review_reminded_at timestamptz;

grant all privileges on public.product_reviews to service_role;
```

Aggregate (avg, count, star distribution 1..5) is computed on read from `status='approved'` rows — no denormalized counter (volume is low for B2B; avoids drift).

### 2. Public API — `functions/api/reviews.js`

**`GET /api/reviews?sku=<sku>&kind=<product|service>&page=<n>`**
Returns approved reviews for the SKU:
```json
{ "ok": true,
  "stats": { "avg": 4.6, "count": 12, "dist": {"1":0,"2":0,"3":1,"4":3,"5":8} },
  "reviews": [ { "author_name","rating","title","body","verified_purchase","created_at" } ],
  "page": 1, "hasMore": false }
```
`author_email`, `user_id`, `order_id` are NEVER included in the response.

**`POST /api/reviews`** — body `{ sku, kind, rating, title, body, order_id?, token?, author_name? }`
Two verified paths; both insert `status='pending'`, `verified_purchase=true`, `source='customer'`:
- **Logged-in path:** `userFromRequest(env, request)` resolves the auth user + email. Confirm an order for that user (`fulfilled` or `tracking_status='delivered'`) has an `order_items` row with this `sku`. Use that order's id.
- **Email one-click path:** `token` = HMAC-SHA256(`${order_id}:${sku}:${emailLower}`, REVIEW_TOKEN_SECRET), verified constant-time (reuse the crypto shape of `unsubscribeToken`/`verifyUnsubscribeToken` in `_lib/email.js`). Confirms the exact order+SKU+email without login. `author_email` comes from the token subject, not client input.
- No verified purchase established → `403 not_verified_purchaser`.
- Validation: rating 1–5 integer; `title`/`body` length caps + HTML-escape on render; `author_name` required (defaults to order contact name).
- IP rate-limited (`rateLimit(env, 'review', ip, {limit:5, windowSec:600})`).
- Duplicate (same order+sku) → `409 already_reviewed` (unique index).
- Best-effort `klaviyoTrack(env, {email, metric:'Review Submitted', properties:{sku,kind,rating}})`.
- Response `{ ok:true, pending:true }`.

Secret name: `REVIEW_TOKEN_SECRET` (may alias `EMAIL_UNSUB_SECRET` if owner prefers one secret — configurable).

### 3. Reminder sweep — `functions/api/admin/review-reminders.js`

Guarded by shared secret header `x-review-crm-secret` == `env.REVIEW_CRM_SECRET` (timing-safe), mirroring the quote-sweep contract (no settings table).

`POST { action:'sweep_due', batch:10 }`:
1. Select orders where `review_reminded_at IS NULL` AND `customer_email` present AND (`tracking_status='delivered'` AND `shipped_at`/delivery ≥10d ago) OR (`status='fulfilled'` AND `updated_at` ≥10d ago when no delivery tracking). Limit `batch`.
2. For each order: gather its purchased SKUs (join `order_items`), build one-click review links `${appUrl}/review.html?order=<id>&sku=<sku>&kind=<k>&email=<enc>&token=<hmac>`.
3. Send ONE email, `category:'review_request'`, listing the products/services to review (links). Subject e.g. "How did <product> work out?".
4. Set `review_reminded_at = now()` (dedupe; also prevents re-send on the next sweep even if send is skipped due to suppression).
5. Return `{ ok:true, processed:n, sent:m }`.

`review_request` is added to `MARKETING_CATEGORIES` in `_lib/email.js` so unsubscribe/marketing-suppression is honored (a marketing opt-out silently skips, still stamps `review_reminded_at`).

Cron template: `supabase/review-reminder-cron.example.sql` — daily (`0 15 * * *`) pg_net POST with the secret, batch 25.

### 4. Storefront UI — `js/reviews.js` (+ CSS in existing stylesheet, cache-busted)

- Renders: star summary (avg + count), 5-bar distribution, review cards (name, verified badge, stars, title, body, date), "Write a review" affordance.
- Mounts on `product.html`, `services.html`, and static product/service detail pages via a `[data-reviews sku=… kind=…]` mount point.
- Write form: shown enabled only when the visitor is a verified buyer (logged-in with a qualifying order) OR arrived via a valid review token (on `review.html`). Otherwise shows "Only verified buyers can review this product." with a sign-in link.
- Injects `AggregateRating` JSON-LD from the live `stats` (script[type=application/ld+json]).
- **SEO snapshot:** `tools/build-reviews.mjs` pulls approved-review aggregates from Supabase at CF build → `data/reviews.json`; `seo-inject` bakes static `AggregateRating` into product/service HTML so crawlers see stars before JS runs. Live list still hydrates client-side.

### 5. Email landing page — `review.html`

Lightweight page: reads `?order=&sku=&kind=&email=&token=`, calls the API to render the target product/service + a pre-verified write form, POSTs `{order_id, sku, kind, token, ...}`. On success shows "Thanks — your review is pending approval." Handles invalid/expired token gracefully.

### 6. Admin moderation — `functions/api/admin/reviews.js` + admin "Reviews" tab

- `GET` list with `status` filter (default `pending`), search, pagination (reuse `_lib/paginate.js`).
- `PATCH`/`POST` actions: `approve`, `reject`, `edit` (fix typo/title/body), `delete`, and `create_seed` (staff seed/legacy review: sets `source='staff_seed'`, `verified_purchase=true`, `status='approved'`, `order_id NULL`).
- Approving/creating a seed → row public; a subsequent `publish`/build refreshes the SEO snapshot.
- Admin UI: new "Reviews" tab (`admin.js` modular pattern, `delegate()` events, `admEmpty`/`admSkeleton` states), pending badge count.

### 7. Tests

- `functions-import-resolve.test.mjs` picks up new endpoints (guard against bad imports freezing CF build).
- `reviews-lib.test.mjs` (pure): token sign/verify (match + tamper reject + constant-time), verified-purchase matcher, aggregate math (avg/count/dist), input validation/clamping, HTML-escape.
- `review-sweep.test.mjs`: due-selection logic (10d threshold, delivered vs fulfilled fallback, reminded_at dedupe, suppression skip still stamps).
- `email.js` category test: `review_request` ∈ marketing stream.

## Data flow

```
Buyer completes order → admin marks delivered/fulfilled
      ↓ (≥10d, pg_cron daily)
review-reminders sweep → sendEmail(review_request) w/ tokened links → review_reminded_at set
      ↓ buyer clicks link
review.html (token verified) → POST /api/reviews → row pending
      ↓ admin approves
approved row public → GET /api/reviews aggregate + JSON-LD → build snapshot bakes static stars
```

Logged-in buyers can also review directly from the product/service page without waiting for the email.

## Error handling

- API fails closed on verification: no proof → 403; never trust client `verified_purchase`/`author_email`.
- Sweep is best-effort per order; a failed send still stamps `review_reminded_at` (no infinite retry / no spam). Suppressed recipients are skipped silently.
- `sendEmail` already handles suppression, streams, logging (`email_events`), and idempotency.
- Public GET never leaks PII (email/user_id/order_id withheld).
- Rate-limit + unique index defend the POST against abuse and dupes.

## Owner ops (post-merge)

1. Apply `supabase/schema-reviews.sql` (pooler).
2. Set env: `REVIEW_CRM_SECRET`, `REVIEW_TOKEN_SECRET` (or reuse `EMAIL_UNSUB_SECRET`).
3. Apply `supabase/review-reminder-cron.example.sql` (replace secret).
4. Add `build-reviews` to the CF build pipeline (before seo-inject) so static AggregateRating bakes.
5. Optionally seed legacy reviews via admin "Reviews" → add.

## Out of scope (YAGNI)

- Review helpfulness voting, replies/Q&A, photo uploads, incentive/coupon-for-review, multi-language reviews. Can layer later.
