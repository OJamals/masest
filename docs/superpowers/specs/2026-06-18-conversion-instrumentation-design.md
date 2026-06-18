# Design: Conversion Instrumentation (UTM attribution + funnel events)

**Date:** 2026-06-18 · **Status:** Approved (owner standing autonomy) · **Type:** Feature (analytics)

## Goal
Make the marketing funnel measurable: capture UTM attribution (first-touch) and emit named
funnel events (visit → checkout_start / quote_submit → order_complete) so visits can be tied
to leads, orders, and traffic source. Closes the "no funnel analytics / no attribution" gap
flagged across the roadmap audit. Pure frontend + `track.js` lane (no collision with Codex's
admin/QBO/account work).

## Components
1. **Schema** `supabase/schema-conversion.sql` — additive `alter table public.page_views`:
   `event text default 'pageview'`, `utm_source text`, `utm_medium text`, `utm_campaign text`,
   plus `page_views_event_idx`. `page_views` already granted to `service_role`.
2. **`js/track.js`** — capture first-touch UTM from URL into `sessionStorage` (`masest_utm`);
   expose `window.mtrack(eventName)` that beacons `{event, utm, path, visitor}`; keep the
   automatic `pageview` beacon (back-compat). No cookies, no PII (matches current privacy note).
3. **`functions/api/track.js`** — accept + store `event` (default `'pageview'`) and the three
   `utm_*` columns. Still fails open (204), still drops bots.
4. **Funnel emit points:** `mtrack('quote_submit')` in `js/main/engagement.js` after a
   successful quote POST; `mtrack('checkout_start')` on the cart checkout action
   (`js/cart.js`); `mtrack('order_complete')` inline on `order-confirmed.html`.
5. **Quote attribution:** include the captured UTM in the quote submission body so
   `/api/quote` stores it in the existing `payload` jsonb (no quotes schema change).

## Data flow
URL `?utm_*` → track.js stores first-touch → every beacon + the quote POST carry it →
`page_views(event, utm_*)` + `quotes.payload.utm`. Funnel = group `page_views` by `event`
(+ utm) over `visitor`; attribution = `quotes.payload.utm`.

## Error handling / compat
- New columns additive (`add column if not exists`); old rows default `event='pageview'`.
- `window.mtrack` no-ops if `/api/track` is absent (same beacon guard as today).
- track.js wrapped in try/catch — never affects the page. Localhost still skipped.

## Testing (repo style: source-grep + pure-logic)
- schema-conversion: grep `alter ... add ... event` + the three `utm_*` + index.
- track.js: grep `window.mtrack` + `masest_utm` + utm param parse; pure UTM-parse helper if
  extracted → exec test.
- `/api/track`: grep `event` + `utm_source` in the insert; default `'pageview'`.
- engagement.js: grep `mtrack('quote_submit')` + utm in quote body.
- cart.js / order-confirmed.html: grep the respective `mtrack(...)` calls.

## Owner ops (post-merge, not dev)
Apply `supabase/schema-conversion.sql` in Supabase SQL editor. (Until applied: track inserts
that include the new columns will error → caught by the existing fail-open try/catch, so
pageviews keep working without event/utm — degrades safely.)

## Out of scope (v1)
Admin conversion dashboard (Codex's admin lane), exit-intent capture, retargeting pixels,
per-card product_view events, multi-touch attribution.
