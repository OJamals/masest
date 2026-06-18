# QBO Auto-Sync — Design Spec

**Date:** 2026-06-18
**Status:** Approved design (pre-implementation)
**Scope item:** P4 — QuickBooks Online receipt/invoice automation

## Goal

Automatically book MASEST orders into QuickBooks Online (Intuit):

- **Paid Stripe orders** (card / ACH, `payment_method='stripe'`, `status='paid'`) → QBO **SalesReceipt**.
- **NET account orders** (`payment_method='net'`, `status='net_open'`) → QBO **Invoice**.

Replaces the current state: NET orders are linked to a QBO invoice **manually** by staff (`record_qbo_invoice` admin action), and paid orders have only a `// TODO Phase 3: QBO sales receipt.` placeholder at `functions/api/stripe-webhook.js:201`. The manual link path is retained as an override/fallback.

## Locked decisions

| Decision | Choice |
|---|---|
| Documents | Paid → SalesReceipt; NET → Invoice (both automatic) |
| Execution model | Decoupled queue + cron (no QBO call inside the Stripe webhook) |
| Cron host | Supabase `pg_cron` + `pg_net` → secret-protected `POST /api/qbo-sync` |
| Customer mapping | **Hybrid** — NET: real company customer; paid B2C: generic catch-all |
| Line items | **Per-SKU QBO Items** (find-or-create QBO Item per SKU) |
| Tax | **TxnTaxDetail TotalTax override** = `order.tax` (no QBO tax-engine calc) |
| Environment | Sandbox-first via `QBO_ENVIRONMENT` (sandbox \| production) |

## Why decoupled (not inline)

Stripe webhooks retry on non-2xx and time out fast; Intuit OAuth tokens expire hourly and refresh tokens rotate on use; QBO can be down. Calling QBO inside the webhook couples order recording to a flaky third party and risks duplicate documents on webhook retry. Instead the webhook only records intent (`qbo_sync_status='pending'`); a separate idempotent processor does the QBO work with retry/backoff. The order is recorded and the buyer emailed regardless of QBO health.

## Architecture / components

### 1. Data model — new migration `supabase/schema-qbo.sql`

```sql
-- OAuth token store (single row; the connected Intuit company).
create table if not exists public.qbo_tokens (
  id                smallint primary key default 1 check (id = 1),
  realm_id          text,
  refresh_token     text,
  access_token      text,
  access_expires_at timestamptz,
  updated_at        timestamptz not null default now()
);

-- SKU -> QBO Item cache (per-SKU Item mapping).
create table if not exists public.qbo_items (
  sku         text primary key,
  qbo_item_id text not null,
  created_at  timestamptz not null default now()
);

-- Per-customer mapping cache (hybrid: real company customers + one generic catch-all).
create table if not exists public.qbo_customers (
  key            text primary key,           -- 'company:<uuid>' | 'generic'
  qbo_customer_id text not null,
  created_at     timestamptz not null default now()
);

-- Order sync state.
do $$ begin
  create type qbo_sync_status as enum ('pending','processing','synced','error','skipped');
exception when duplicate_object then null; end $$;

alter table public.orders
  add column if not exists qbo_sync_status   qbo_sync_status,
  add column if not exists qbo_doc_id        text,
  add column if not exists qbo_doc_type      text,            -- 'sales_receipt' | 'invoice'
  add column if not exists qbo_synced_at     timestamptz,
  add column if not exists qbo_error         text,
  add column if not exists qbo_attempts      int not null default 0,
  add column if not exists qbo_next_attempt_at timestamptz;
-- existing public.orders.qbo_invoice_id is RETAINED; invoice syncs also write it
-- so the current admin/account display keeps working unchanged.

create index if not exists orders_qbo_pending_idx
  on public.orders (qbo_next_attempt_at)
  where qbo_sync_status in ('pending','error');
```

All three new tables get `grant select,insert,update on ... to service_role;` (see [[masest-supabase-raw-sql-grants]] — pooler-created tables need explicit grants or CF inserts fail 42501).

### 2. QBO client lib — `functions/_lib/qbo.js`

Pure-ish module, no Pages-request coupling, unit-testable:

- `qboBaseUrl(env)` → `https://sandbox-quickbooks.api.intuit.com` vs `https://quickbooks.api.intuit.com` from `QBO_ENVIRONMENT`.
- `getAccessToken(sb, env)` → read `qbo_tokens`; if `access_expires_at` within a 5-min skew, POST `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` with `grant_type=refresh_token`; persist rotated `refresh_token` + new `access_token` + `access_expires_at`. Returns `{accessToken, realmId}`.
- `findOrCreateCustomer(sb, env, token, {scope})` → hybrid: `company:<id>` (display name = company name) or `generic`; query QBO `Customer` by DisplayName, create if absent, cache in `qbo_customers`.
- `findOrCreateItem(sb, env, token, {sku, name})` → check `qbo_items`; query QBO `Item` by Name/Sku; create with `Type=Service` + `IncomeAccountRef` (from `QBO_INCOME_ACCOUNT_ID`, or auto-detect first account of type `Income`); cache.
- `createSalesReceipt(...)` / `createInvoice(...)` → build line array (one line per order_item, `ItemRef` from cache, `Amount=line_total`, description=name), `TxnTaxDetail.TotalTax=order.tax`, `DocNumber=order.id`, `CustomerRef`; POST and return QBO doc `Id`.

### 3. One-time admin OAuth connect

- `GET /api/admin/qbo/connect` (requireStaff) → 302 to Intuit consent URL (scope `com.intuit.quickbooks.accounting`, state nonce).
- `GET /api/admin/qbo/callback` (requireStaff) → exchange `code` for tokens, store `refresh_token` + `realm_id` in `qbo_tokens`.
- `admin.html` / `js/admin.js`: a "Connect QuickBooks" button + connected/disconnected status badge (reads a tiny `GET /api/admin/qbo/status`).

### 4. Order tagging (set intent)

- `functions/api/stripe-webhook.js:201` — replace the TODO: on paid `orders.insert`, set `qbo_sync_status='pending'`. Never throws (matches existing email/stock best-effort pattern).
- `functions/api/checkout.js` NET path (~line 110) — set `qbo_sync_status='pending'` on the `net_open` order insert.

### 5. Processor — `POST /api/qbo-sync`

- Auth: shared secret header `X-QBO-Sync-Secret` === `env.QBO_SYNC_SECRET` (constant-time compare). 401 otherwise. Not behind user auth (called by pg_cron).
- **Atomic claim** (prevents double-send under webhook-retry + concurrent cron): a Postgres RPC `claim_qbo_orders(batch int)` defined in `schema-qbo.sql` does `update orders set qbo_sync_status='processing' where id in (select id from orders where qbo_sync_status='pending' and (qbo_next_attempt_at is null or qbo_next_attempt_at <= now()) order by created_at limit batch for update skip locked) returning *`. Called via `sb.rpc('claim_qbo_orders', {batch})` — supabase-js REST can't express `for update skip locked` inline, so it must be an RPC. `security definer`, granted to `service_role`.
- Per claimed order: refresh token once per batch; resolve customer (hybrid) + items (per-SKU); `paid`→SalesReceipt, `net`→Invoice.
  - Success → `qbo_sync_status='synced'`, `qbo_doc_id`, `qbo_doc_type`, `qbo_synced_at=now()`; invoices also set `qbo_invoice_id=doc_id`.
  - Failure → `qbo_attempts+1`; if `>=5` → `status='error'` + `qbo_error`; else → `status='pending'`, `qbo_next_attempt_at=now()+backoff(attempts)` (exponential, capped).
- **Cron**: `pg_cron` job every 5 min runs `select net.http_post('https://masest.co/api/qbo-sync', headers:=jsonb_build_object('X-QBO-Sync-Secret', <secret>))` via `pg_net`.

## Idempotency & failure handling

- DB-status state machine is the single source of truth — only `pending` rows are claimed; `processing` is never re-claimed; `synced` is terminal.
- `DocNumber=order.id` is a secondary QBO-side dedupe guard.
- Webhook retries are harmless: they only ever re-assert `pending` on an unsynced order (and the webhook already dedupes orders on `stripe_payment_intent`).
- Terminal `error` orders remain visible to staff, who can still use the manual `record_qbo_invoice` override.

## Security

- OAuth endpoints: `requireStaff` (existing admin authz pattern in `functions/api/admin/*`).
- Processor endpoint: shared-secret header only; no data leaked on auth failure.
- Tokens (`refresh_token`, `access_token`) live in `qbo_tokens`, service_role-only, never returned to clients.
- Secrets in CF env: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` (already placeholdered), `QBO_SYNC_SECRET`, `QBO_INCOME_ACCOUNT_ID` (optional), `QBO_ENVIRONMENT`, `QBO_REDIRECT_URI`.

## Testing (no live Intuit calls in CI)

- **Source-assert tests** (mirror existing `tests/qbo-invoice.test.mjs` style): webhook sets `pending`; checkout NET sets `pending`; processor endpoint checks the secret; OAuth endpoints require staff.
- **Logic/unit tests** (pure functions): token-refresh expiry decision; SalesReceipt/Invoice payload builders (line mapping, `DocNumber`, `TxnTaxDetail.TotalTax`); customer-scope resolution (hybrid); retry/backoff state-machine transitions (attempts→status/next_attempt).
- **Mapping fixtures**: a sample order → expected QBO payload JSON.
- No network in tests; QBO HTTP calls injected/mocked.

## Owner setup steps (post-merge)

1. Apply `supabase/schema-qbo.sql` (+ verify service_role grants).
2. Enable `pg_cron` + `pg_net` Supabase extensions; create the 5-min cron job.
3. Set CF env: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_SYNC_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT=sandbox`, optional `QBO_INCOME_ACCOUNT_ID`.
4. Run the admin "Connect QuickBooks" flow once (sandbox) → seeds `qbo_tokens`.
5. Verify a sandbox SalesReceipt + Invoice; then flip `QBO_ENVIRONMENT=production` and reconnect.

## Out of scope (YAGNI)

- Refunds/credit-memo sync (Stripe refund → QBO RefundReceipt) — later.
- Editing/voiding already-synced QBO docs.
- Multi-currency (currency is `usd` today).
- Full catalog→QBO Item pre-sync (Items are created lazily on first sale).

## Open dependency / risk

- `pg_net` reaching the public `masest.co` endpoint requires the secret and outbound HTTP from Supabase; if unavailable, fallback trigger = GitHub Actions cron or a manual admin "Run sync now" button hitting the same endpoint.
- QBO Item creation needs a valid Income account; if `QBO_INCOME_ACCOUNT_ID` unset and auto-detect finds none, item creation fails → order goes to `error` (visible, recoverable).
