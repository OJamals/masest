# Admin Operations Analytics Design

## Goal

Mature the admin dashboard into an operations control room for staff: one place to see revenue risk, fulfillment work, CRM follow-ups, buyer/account health, catalog health, and first-party conversion analytics.

## Scope

This first release is admin-first. It does not rebuild the buyer dashboard, change public marketing pages, or replace the existing Supabase/Cloudflare architecture. It extends the existing `admin.html`, `js/admin.js`, `/api/admin/stats`, and `/api/admin/traffic` surfaces so staff get higher-signal decisions without leaving the current console.

## Current System

The app is a CSS-first Cloudflare Pages site with static HTML and browser modules. Admin auth is server-enforced through `requireStaff`. Existing admin areas already cover orders, accounts, products, pricing, messages, quotes, offers, QuickBooks, traffic, and SEO. First-party analytics are stored in `page_views` with `event`, referrer, visitor, and UTM columns.

## Approaches Considered

### Recommended: additive control-room upgrade

Keep current pages and APIs, add richer aggregate payloads, better admin overview sections, and a more complete analytics page. This gives high leverage without breaking existing workflows or requiring a framework rewrite.

### Alternative: split admin into many dedicated pages

This could improve long-term maintainability, but it would force routing, shared layout, and auth-state changes before improving staff value. It is not the right first release.

### Alternative: full CRM/ecommerce data model expansion first

This would enable deeper lifecycle automation, but it depends on larger schema migrations and sales-process decisions. The current APIs already expose enough data for a meaningful operations dashboard.

## UX Design

Use the existing MASEST product register: dense, scannable, restrained, task-first. No decorative dashboard widgets, no marketing-style metric cards, no nested cards. The overview should answer:

- What revenue/orders need action?
- Which accounts need approval or setup follow-up?
- Which quote/CRM items are overdue?
- Which catalog/inventory items threaten fulfillment?
- What conversion events are moving or stalling?

The analytics page should show first-party data as an operator report, not a vanity graph. Include event funnel, top campaign/source rows, top paths, referrers, browsers, and daily trend rows. If the `page_views` table is missing, keep the current graceful empty-state behavior.

## API Design

`/api/admin/stats` remains the overview source and adds grouped objects:

- `commerce`: revenue windows, average order value, paid/net/open status counts, fulfillment queue, NET exposure.
- `crm`: new/urgent/due quotes, unread messages, setup follow-up counts.
- `accounts`: pending/approved/suspended company counts and setup-step breakdown.
- `catalog_health`: buy/quote SKU counts, low-stock count, inactive count.
- `analytics`: 7-day views, unique visitors, quote submits, checkout starts, purchase confirms, conversion rate.
- `actions`: sorted list of priority action items.

`/api/admin/traffic` remains the analytics source and adds:

- `events`: event counts for pageview, quote_submit, checkout_start, order_confirmed, and other tracked events.
- `funnel`: ordered conversion counts and rates.
- `topCampaigns`: UTM source/medium/campaign groups.
- `byDay`: daily rows with pageviews, unique visitors, and conversion events.
- `topReferrers`, `topPaths`, and `byBrowser` stay present.

Both endpoints must remain staff-gated and degrade safely when optional tables/columns are not migrated.

## Frontend Design

`admin.html` keeps the same app shell and tabs. `js/admin.js` adds small render helpers and richer panels:

- Overview stats keep the existing card vocabulary but add an action rail and operations summary.
- Traffic page gets a compact report: KPI row, funnel table, campaigns table, top paths/referrers/browsers, and day rows.
- Empty states use plain copy and existing token colors.
- New classes go in `css/style.css` only if the current admin styles do not cover the layout. Use tokens from `:root`.

## Testing

Use source-contract tests because these endpoints depend on Cloudflare/Supabase bindings in production. Tests should prove:

- `/api/admin/stats` exposes the new grouped payload keys and keeps graceful catch blocks.
- `/api/admin/traffic` aggregates event, funnel, campaign, and daily rows while preserving `available:false` migration fallback.
- `js/admin.js` renders the new overview and analytics sections with stable IDs/class hooks and no raw unescaped dynamic HTML.
- Existing `npm run verify` remains the final gate.

## Rollout

This release is additive. No required migration beyond already-documented `schema-conversion.sql` and `schema-phase5.sql`. If production lacks `page_views`, analytics returns the existing migration note instead of breaking the admin page.
