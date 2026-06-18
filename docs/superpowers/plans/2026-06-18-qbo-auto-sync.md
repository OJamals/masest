# QBO Auto-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically book paid Stripe orders into QuickBooks Online as SalesReceipts and NET orders as Invoices, via a decoupled queue + cron processor.

**Architecture:** The Stripe webhook and NET checkout only mark orders `qbo_sync_status='pending'`. A secret-protected `POST /api/qbo-sync` endpoint, triggered every 5 min by Supabase `pg_cron`+`pg_net`, atomically claims pending orders, refreshes the Intuit OAuth token, resolves customers (hybrid) and per-SKU Items, posts the document to QBO, and records the result with retry/backoff. A one-time admin OAuth flow seeds the refresh token.

**Tech Stack:** Cloudflare Pages Functions (vanilla ESM `.js`), Supabase (`@supabase/supabase-js`, service role), Intuit QBO Accounting API v3, `node --test` for unit/source tests.

**Reference spec:** `docs/superpowers/specs/2026-06-18-qbo-auto-sync-design.md`

**Conventions to follow (from existing code):**
- Pages handler shape: `export async function onRequest({ request, env }) { ... }`.
- Lib helpers from `functions/_lib/supabase.js`: `adminClient(env)`, `requireStaff(request, env)` → `{user, staff}`, `json(status, body)`, `readBody(request)`.
- Pure builders live in `functions/_lib/*.js` and are imported directly by tests (pattern: `functions/_lib/checkout-session.js`).
- Tests: `import test from "node:test"; import assert from "node:assert/strict";`. Two styles already in repo — **logic tests** (import pure fn, assert behavior, e.g. `tests/util-format.test.mjs`) and **source-assert tests** (`readFileSync` a source file, `assert.match` regex, e.g. `tests/qbo-invoice.test.mjs`). Use logic tests for pure functions, source-assert for wiring/handlers that need live env.
- Run a single file: `node --test tests/<file>.test.mjs`. Run all: `node --test tests/*.test.mjs`.
- Commits: present-tense conventional commits. Footer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WPoeYFsoRt65QKtJmrGERX
  ```
- **Before each commit/push** the deploy branch is `main` and a Codex process edits this repo concurrently — `git fetch origin && git rebase origin/main` before pushing, and re-Read a file before editing if time has passed (see memory: concurrent-codex-edits, git-push-method).

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/schema-qbo.sql` | Tables (`qbo_tokens`, `qbo_items`, `qbo_customers`), `qbo_sync_status` enum, `orders` columns, `claim_qbo_orders` RPC, grants | Create |
| `functions/_lib/qbo.js` | QBO client: pure helpers, payload builders, token refresh, customer/item find-or-create, doc POST | Create |
| `functions/api/qbo-sync.js` | Processor endpoint: secret gate, claim, per-order sync, status update | Create |
| `functions/api/admin/qbo/connect.js` | OAuth: redirect to Intuit consent | Create |
| `functions/api/admin/qbo/callback.js` | OAuth: code→token exchange, store | Create |
| `functions/api/admin/qbo/status.js` | Connected/disconnected badge data | Create |
| `functions/api/stripe-webhook.js` | Set `qbo_sync_status='pending'` on paid order | Modify (~line 166, ~201) |
| `functions/api/checkout.js` | Set `qbo_sync_status='pending'` on NET order | Modify (~line 110) |
| `js/admin.js`, `admin.html` | "Connect QuickBooks" button + status badge | Modify |
| `.env.example`, `CLOUDFLARE_PAGES.md` | New env vars + owner setup steps | Modify |
| `tests/qbo-*.test.mjs` | Logic + source-assert tests | Create |

---

## Task 1: Database migration

**Files:**
- Create: `supabase/schema-qbo.sql`
- Test: `tests/qbo-schema.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/qbo-schema.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/schema-qbo.sql", import.meta.url), "utf8");

test("migration creates qbo token, item, and customer caches", () => {
  assert.match(sql, /create table if not exists public\.qbo_tokens/);
  assert.match(sql, /create table if not exists public\.qbo_items/);
  assert.match(sql, /create table if not exists public\.qbo_customers/);
});

test("migration adds qbo sync columns and enum to orders", () => {
  assert.match(sql, /create type qbo_sync_status as enum/);
  assert.match(sql, /add column if not exists qbo_sync_status/);
  assert.match(sql, /add column if not exists qbo_doc_id/);
  assert.match(sql, /add column if not exists qbo_attempts/);
  assert.match(sql, /add column if not exists qbo_next_attempt_at/);
});

test("migration defines an atomic claim RPC with skip locked", () => {
  assert.match(sql, /create or replace function public\.claim_qbo_orders/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /security definer/);
});

test("new tables and RPC are granted to service_role", () => {
  assert.match(sql, /grant[\s\S]*qbo_tokens[\s\S]*to service_role/i);
  assert.match(sql, /grant execute on function public\.claim_qbo_orders[\s\S]*to service_role/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/qbo-schema.test.mjs`
Expected: FAIL — `ENOENT` (schema-qbo.sql does not exist).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/schema-qbo.sql — QBO auto-sync: token store, mapping caches, order sync state, claim RPC.

-- OAuth token store (single connected Intuit company).
create table if not exists public.qbo_tokens (
  id                smallint primary key default 1 check (id = 1),
  realm_id          text,
  refresh_token     text,
  access_token      text,
  access_expires_at timestamptz,
  updated_at        timestamptz not null default now()
);

-- SKU -> QBO Item id cache.
create table if not exists public.qbo_items (
  sku         text primary key,
  qbo_item_id text not null,
  created_at  timestamptz not null default now()
);

-- Customer mapping cache (hybrid: 'company:<uuid>' real customers + 'generic' catch-all).
create table if not exists public.qbo_customers (
  key             text primary key,
  qbo_customer_id text not null,
  created_at      timestamptz not null default now()
);

-- Order sync state.
do $$ begin
  create type qbo_sync_status as enum ('pending','processing','synced','error','skipped');
exception when duplicate_object then null; end $$;

alter table public.orders
  add column if not exists qbo_sync_status     qbo_sync_status,
  add column if not exists qbo_doc_id          text,
  add column if not exists qbo_doc_type        text,
  add column if not exists qbo_synced_at       timestamptz,
  add column if not exists qbo_error           text,
  add column if not exists qbo_attempts        int not null default 0,
  add column if not exists qbo_next_attempt_at timestamptz;

create index if not exists orders_qbo_pending_idx
  on public.orders (qbo_next_attempt_at)
  where qbo_sync_status in ('pending','error');

-- Atomic claim: flips up to `batch` due 'pending' rows to 'processing' and returns them.
-- for update skip locked prevents two concurrent cron runs grabbing the same row.
create or replace function public.claim_qbo_orders(batch int)
returns setof public.orders
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.orders o set qbo_sync_status = 'processing'
  where o.id in (
    select id from public.orders
    where qbo_sync_status = 'pending'
      and (qbo_next_attempt_at is null or qbo_next_attempt_at <= now())
    order by created_at
    limit batch
    for update skip locked
  )
  returning o.*;
end $$;

grant select, insert, update on public.qbo_tokens    to service_role;
grant select, insert, update on public.qbo_items     to service_role;
grant select, insert, update on public.qbo_customers to service_role;
grant execute on function public.claim_qbo_orders(int) to service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/qbo-schema.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git fetch origin && git rebase origin/main
git add supabase/schema-qbo.sql tests/qbo-schema.test.mjs
git commit -m "feat(qbo): add sync schema (tokens, caches, order state, claim RPC)"
```

---

## Task 2: QBO pure helpers (token-refresh decision, backoff, retry state)

**Files:**
- Create: `functions/_lib/qbo.js`
- Test: `tests/qbo-helpers.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/qbo-helpers.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { needsRefresh, backoffMs, nextSyncState, docNumber } from "../functions/_lib/qbo.js";

const NOW = Date.parse("2026-06-18T12:00:00Z");

test("needsRefresh: missing token or expiry needs refresh", () => {
  assert.equal(needsRefresh(null, NOW), true);
  assert.equal(needsRefresh({ access_token: "x", access_expires_at: null }, NOW), true);
});

test("needsRefresh: within 5-min skew of expiry needs refresh", () => {
  const soon = new Date(NOW + 4 * 60_000).toISOString();
  const later = new Date(NOW + 30 * 60_000).toISOString();
  assert.equal(needsRefresh({ access_token: "x", access_expires_at: soon }, NOW), true);
  assert.equal(needsRefresh({ access_token: "x", access_expires_at: later }, NOW), false);
});

test("backoffMs: exponential, capped at 6h", () => {
  assert.equal(backoffMs(0), 60_000);
  assert.equal(backoffMs(1), 120_000);
  assert.equal(backoffMs(3), 480_000);
  assert.equal(backoffMs(99), 6 * 60 * 60_000);
});

test("nextSyncState: retries below max, errors at/after max", () => {
  assert.deepEqual(nextSyncState(0, NOW), {
    qbo_sync_status: "pending", qbo_attempts: 1,
    qbo_next_attempt_at: new Date(NOW + 120_000).toISOString(),
  });
  const terminal = nextSyncState(4, NOW);
  assert.equal(terminal.qbo_sync_status, "error");
  assert.equal(terminal.qbo_attempts, 5);
});

test("docNumber: <=21 chars, hyphen-free, deterministic", () => {
  const d = docNumber("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  assert.ok(d.length <= 21);
  assert.ok(!d.includes("-"));
  assert.equal(d, docNumber("a1b2c3d4-e5f6-7890-abcd-ef1234567890"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/qbo-helpers.test.mjs`
Expected: FAIL — cannot find module `../functions/_lib/qbo.js`.

- [ ] **Step 3: Write the helpers**

```javascript
// functions/_lib/qbo.js — QuickBooks Online client (Intuit Accounting API v3).
// Pure helpers first; IO functions appended in later tasks.

const REFRESH_SKEW_MS = 5 * 60_000;     // refresh if access token expires within 5 min
const MAX_ATTEMPTS = 5;
const BACKOFF_CAP_MS = 6 * 60 * 60_000; // 6 hours

// Does the stored token need a refresh at time `nowMs`?
export function needsRefresh(token, nowMs) {
  if (!token || !token.access_token || !token.access_expires_at) return true;
  const expMs = Date.parse(token.access_expires_at);
  if (Number.isNaN(expMs)) return true;
  return expMs - nowMs <= REFRESH_SKEW_MS;
}

// Exponential backoff for retry attempt N (0-based), capped.
export function backoffMs(attempts) {
  return Math.min(2 ** attempts * 60_000, BACKOFF_CAP_MS);
}

// Compute the orders-row patch after a failed sync attempt.
export function nextSyncState(attempts, nowMs) {
  const next = attempts + 1;
  if (next >= MAX_ATTEMPTS) {
    return { qbo_sync_status: "error", qbo_attempts: next };
  }
  return {
    qbo_sync_status: "pending",
    qbo_attempts: next,
    qbo_next_attempt_at: new Date(nowMs + backoffMs(next)).toISOString(),
  };
}

// QBO DocNumber is limited to 21 chars; uuids are 36 with hyphens. Secondary dedupe guard only
// (the DB status machine is the primary idempotency). Full order id goes in PrivateNote.
export function docNumber(orderId) {
  return String(orderId).replace(/-/g, "").slice(0, 21);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/qbo-helpers.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/qbo.js tests/qbo-helpers.test.mjs
git commit -m "feat(qbo): add token-refresh, backoff, and retry-state helpers"
```

---

## Task 3: QBO document payload builders

**Files:**
- Modify: `functions/_lib/qbo.js`
- Test: `tests/qbo-payload.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/qbo-payload.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { buildSalesReceiptPayload, buildInvoicePayload } from "../functions/_lib/qbo.js";

const order = { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", tax: 7.5, total: 107.5 };
const items = [
  { sku: "crhd", name: "CR-HD — 5 gal", qty: 2, unit_price: 25, line_total: 50 },
  { sku: "sar", name: "SAR — 5 gal", qty: 1, unit_price: 50, line_total: 50 },
];
const itemRefs = { crhd: "101", sar: "102" };

test("sales receipt: customer ref, lines per item, tax override, docnumber", () => {
  const p = buildSalesReceiptPayload({ order, items, customerRef: "55", itemRefs });
  assert.equal(p.CustomerRef.value, "55");
  assert.equal(p.Line.length, 2);
  assert.equal(p.Line[0].Amount, 50);
  assert.equal(p.Line[0].SalesItemLineDetail.ItemRef.value, "101");
  assert.equal(p.Line[0].SalesItemLineDetail.Qty, 2);
  assert.equal(p.Line[0].SalesItemLineDetail.UnitPrice, 25);
  assert.equal(p.TxnTaxDetail.TotalTax, 7.5);
  assert.equal(p.DocNumber, "a1b2c3d4e5f67890abcde");
  assert.match(p.PrivateNote, /a1b2c3d4-e5f6-7890-abcd-ef1234567890/);
});

test("invoice: same shape as sales receipt", () => {
  const p = buildInvoicePayload({ order, items, customerRef: "55", itemRefs });
  assert.equal(p.CustomerRef.value, "55");
  assert.equal(p.Line.length, 2);
  assert.equal(p.Line[1].SalesItemLineDetail.ItemRef.value, "102");
  assert.equal(p.TxnTaxDetail.TotalTax, 7.5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/qbo-payload.test.mjs`
Expected: FAIL — `buildSalesReceiptPayload is not a function`.

- [ ] **Step 3: Append the builders to `functions/_lib/qbo.js`**

```javascript
// --- document payload builders ---

function lineFor(item, itemRefs) {
  return {
    DetailType: "SalesItemLineDetail",
    Amount: item.line_total,
    Description: item.name,
    SalesItemLineDetail: {
      ItemRef: { value: itemRefs[item.sku] },
      Qty: item.qty,
      UnitPrice: item.unit_price,
    },
  };
}

function baseDoc({ order, items, customerRef, itemRefs }) {
  return {
    CustomerRef: { value: customerRef },
    DocNumber: docNumber(order.id),
    PrivateNote: `MASEST order ${order.id}`,
    Line: items.map((it) => lineFor(it, itemRefs)),
    TxnTaxDetail: { TotalTax: order.tax || 0 },
  };
}

export function buildSalesReceiptPayload(args) {
  return baseDoc(args);
}

export function buildInvoicePayload(args) {
  return baseDoc(args);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/qbo-payload.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/qbo.js tests/qbo-payload.test.mjs
git commit -m "feat(qbo): add SalesReceipt and Invoice payload builders"
```

---

## Task 4: QBO IO — token refresh, customer & item find-or-create

**Files:**
- Modify: `functions/_lib/qbo.js`
- Test: `tests/qbo-io.test.mjs`

Design: every IO function takes an injected `fetchImpl` (defaults to global `fetch`) and the service-role `sb` client, so tests pass fakes — no network, no real Supabase.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/qbo-io.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { getAccessToken, findOrCreateCustomer, findOrCreateItem } from "../functions/_lib/qbo.js";

// Minimal fake supabase: one in-memory table keyed by name.
function fakeSb(rows = {}) {
  const store = { qbo_tokens: rows.qbo_tokens || null, qbo_items: rows.qbo_items || {}, qbo_customers: rows.qbo_customers || {} };
  return {
    store,
    from(table) {
      return {
        select: () => ({
          eq: (_c, v) => ({ maybeSingle: async () => ({ data: store[table]?.[v] || null }) }),
          limit: () => ({ maybeSingle: async () => ({ data: store.qbo_tokens }) }),
        }),
        upsert: async (row) => { if (table === "qbo_tokens") store.qbo_tokens = { ...store.qbo_tokens, ...row }; else store[table][row.sku || row.key] = row; return { error: null }; },
        insert: async (row) => { store[table][row.sku || row.key] = row; return { error: null }; },
      };
    },
  };
}
const env = { QBO_CLIENT_ID: "id", QBO_CLIENT_SECRET: "sec", QBO_ENVIRONMENT: "sandbox" };

test("getAccessToken refreshes when expired and persists rotated token", async () => {
  const sb = fakeSb({ qbo_tokens: { id: 1, realm_id: "R1", refresh_token: "old", access_token: null, access_expires_at: null } });
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    return { ok: true, json: async () => ({ access_token: "newAccess", refresh_token: "newRefresh", expires_in: 3600 }) };
  };
  const { accessToken, realmId } = await getAccessToken(sb, env, { nowMs: Date.parse("2026-06-18T12:00:00Z"), fetchImpl });
  assert.equal(accessToken, "newAccess");
  assert.equal(realmId, "R1");
  assert.match(calls[0], /oauth\.platform\.intuit\.com/);
  assert.equal(sb.store.qbo_tokens.refresh_token, "newRefresh"); // rotation persisted
});

test("findOrCreateItem returns cached id without calling QBO", async () => {
  const sb = fakeSb({ qbo_items: { crhd: { sku: "crhd", qbo_item_id: "101" } } });
  let called = false;
  const id = await findOrCreateItem(sb, env, "tok", "R1", { sku: "crhd", name: "CR-HD" }, { fetchImpl: async () => { called = true; } });
  assert.equal(id, "101");
  assert.equal(called, false);
});

test("findOrCreateItem creates and caches when absent", async () => {
  const sb = fakeSb();
  const fetchImpl = async (url) => {
    if (/query/.test(url)) return { ok: true, json: async () => ({ QueryResponse: {} }) };       // not found
    return { ok: true, json: async () => ({ Item: { Id: "201" } }) };                              // created
  };
  const id = await findOrCreateItem(sb, { ...env, QBO_INCOME_ACCOUNT_ID: "79" }, "tok", "R1", { sku: "new", name: "New" }, { fetchImpl });
  assert.equal(id, "201");
  assert.equal(sb.store.qbo_items.new.qbo_item_id, "201");
});

test("findOrCreateCustomer caches by company key", async () => {
  const sb = fakeSb();
  const fetchImpl = async (url) => {
    if (/query/.test(url)) return { ok: true, json: async () => ({ QueryResponse: {} }) };
    return { ok: true, json: async () => ({ Customer: { Id: "55" } }) };
  };
  const id = await findOrCreateCustomer(sb, env, "tok", "R1", { key: "company:abc", displayName: "Acme Co" }, { fetchImpl });
  assert.equal(id, "55");
  assert.equal(sb.store.qbo_customers["company:abc"].qbo_customer_id, "55");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/qbo-io.test.mjs`
Expected: FAIL — `getAccessToken is not a function`.

- [ ] **Step 3: Append the IO functions to `functions/_lib/qbo.js`**

```javascript
// --- IO: base URLs ---

const OAUTH_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export function qboApiBase(env) {
  return env.QBO_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

// --- IO: access token (refresh + rotate) ---

export async function getAccessToken(sb, env, { nowMs = Date.now(), fetchImpl = fetch } = {}) {
  const { data: token } = await sb.from("qbo_tokens").select("*").limit(1).maybeSingle();
  if (!token || !token.refresh_token) throw new Error("qbo_not_connected");
  if (!needsRefresh(token, nowMs)) return { accessToken: token.access_token, realmId: token.realm_id };

  const basic = btoa(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`);
  const res = await fetchImpl(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(token.refresh_token)}`,
  });
  if (!res.ok) throw new Error(`qbo_token_refresh_failed_${res.status}`);
  const j = await res.json();
  const access_expires_at = new Date(nowMs + (j.expires_in || 3600) * 1000).toISOString();
  await sb.from("qbo_tokens").upsert({
    id: 1, realm_id: token.realm_id,
    refresh_token: j.refresh_token || token.refresh_token, // Intuit rotates the refresh token
    access_token: j.access_token, access_expires_at, updated_at: new Date(nowMs).toISOString(),
  });
  return { accessToken: j.access_token, realmId: token.realm_id };
}

// --- IO: QBO query/create helpers ---

async function qboQuery(env, accessToken, realmId, query, fetchImpl) {
  const url = `${qboApiBase(env)}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`qbo_query_failed_${res.status}`);
  return res.json();
}

async function qboCreate(env, accessToken, realmId, entity, body, fetchImpl) {
  const url = `${qboApiBase(env)}/v3/company/${realmId}/${entity.toLowerCase()}?minorversion=70`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`qbo_create_${entity}_failed_${res.status}`);
  return res.json();
}

// Escape a value for a QBO SQL-ish query literal.
const ql = (s) => String(s).replace(/'/g, "\\'");

// --- IO: customer find-or-create (hybrid: 'company:<id>' or 'generic') ---

export async function findOrCreateCustomer(sb, env, accessToken, realmId, { key, displayName }, { fetchImpl = fetch } = {}) {
  const { data: cached } = await sb.from("qbo_customers").select("*").eq("key", key).maybeSingle();
  if (cached) return cached.qbo_customer_id;

  const q = await qboQuery(env, accessToken, realmId, `select Id from Customer where DisplayName = '${ql(displayName)}'`, fetchImpl);
  let id = q.QueryResponse?.Customer?.[0]?.Id;
  if (!id) {
    const created = await qboCreate(env, accessToken, realmId, "Customer", { DisplayName: displayName }, fetchImpl);
    id = created.Customer.Id;
  }
  await sb.from("qbo_customers").insert({ key, qbo_customer_id: id });
  return id;
}

// --- IO: item find-or-create (per-SKU) ---

export async function findOrCreateItem(sb, env, accessToken, realmId, { sku, name }, { fetchImpl = fetch } = {}) {
  const { data: cached } = await sb.from("qbo_items").select("*").eq("sku", sku).maybeSingle();
  if (cached) return cached.qbo_item_id;

  const q = await qboQuery(env, accessToken, realmId, `select Id from Item where Name = '${ql(name)}'`, fetchImpl);
  let id = q.QueryResponse?.Item?.[0]?.Id;
  if (!id) {
    let incomeAccountId = env.QBO_INCOME_ACCOUNT_ID;
    if (!incomeAccountId) {
      const acc = await qboQuery(env, accessToken, realmId, "select Id from Account where AccountType = 'Income' maxresults 1", fetchImpl);
      incomeAccountId = acc.QueryResponse?.Account?.[0]?.Id;
    }
    if (!incomeAccountId) throw new Error("qbo_no_income_account");
    const created = await qboCreate(env, accessToken, realmId, "Item",
      { Name: name, Sku: sku, Type: "Service", IncomeAccountRef: { value: incomeAccountId } }, fetchImpl);
    id = created.Item.Id;
  }
  await sb.from("qbo_items").insert({ sku, qbo_item_id: id });
  return id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/qbo-io.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/qbo.js tests/qbo-io.test.mjs
git commit -m "feat(qbo): add token refresh + customer/item find-or-create IO"
```

---

## Task 5: Per-order sync + processor endpoint

**Files:**
- Modify: `functions/_lib/qbo.js` (add `syncOrder` orchestrator)
- Create: `functions/api/qbo-sync.js`
- Test: `tests/qbo-sync.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/qbo-sync.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { documentPlanFor } from "../functions/_lib/qbo.js";

// documentPlanFor decides doc type + customer key from an order, with no IO.
test("paid order with company -> sales_receipt, company customer key", () => {
  const plan = documentPlanFor({ id: "o1", payment_method: "stripe", company_id: "c9", tax: 0 }, { "c9": "Acme" });
  assert.equal(plan.docType, "sales_receipt");
  assert.equal(plan.customer.key, "company:c9");
  assert.equal(plan.customer.displayName, "Acme");
});

test("paid order without company -> sales_receipt, generic customer", () => {
  const plan = documentPlanFor({ id: "o2", payment_method: "stripe", company_id: null, tax: 0 }, {});
  assert.equal(plan.docType, "sales_receipt");
  assert.equal(plan.customer.key, "generic");
  assert.equal(plan.customer.displayName, "Online Sales (MASEST)");
});

test("net order -> invoice, company customer key", () => {
  const plan = documentPlanFor({ id: "o3", payment_method: "net", company_id: "c1", tax: 0 }, { "c1": "Beta LLC" });
  assert.equal(plan.docType, "invoice");
  assert.equal(plan.customer.key, "company:c1");
});

// Endpoint wiring (source-assert; runs without live env).
const src = readFileSync(new URL("../functions/api/qbo-sync.js", import.meta.url), "utf8");

test("endpoint rejects without the shared secret", () => {
  assert.match(src, /QBO_SYNC_SECRET/);
  assert.match(src, /X-QBO-Sync-Secret|x-qbo-sync-secret/i);
  assert.match(src, /401/);
});

test("endpoint claims via the RPC and writes terminal status", () => {
  assert.match(src, /claim_qbo_orders/);
  assert.match(src, /['"]synced['"]/);
  assert.match(src, /nextSyncState/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/qbo-sync.test.mjs`
Expected: FAIL — `documentPlanFor is not a function` (and missing endpoint file).

- [ ] **Step 3a: Append `documentPlanFor` + `syncOrder` to `functions/_lib/qbo.js`**

```javascript
// --- orchestration ---

const GENERIC_CUSTOMER = "Online Sales (MASEST)";

// Pure: decide document type + customer mapping for an order. companyNames: { [companyId]: name }.
export function documentPlanFor(order, companyNames = {}) {
  if (order.payment_method === "net") {
    return { docType: "invoice", customer: { key: `company:${order.company_id}`, displayName: companyNames[order.company_id] || `Company ${order.company_id}` } };
  }
  // stripe / paid
  if (order.company_id) {
    return { docType: "sales_receipt", customer: { key: `company:${order.company_id}`, displayName: companyNames[order.company_id] || `Company ${order.company_id}` } };
  }
  return { docType: "sales_receipt", customer: { key: "generic", displayName: GENERIC_CUSTOMER } };
}

// Sync one order to QBO. Returns the QBO doc id. Throws on any failure (caller records retry state).
// `items` = order_items rows; `companyNames` resolves the display name; deps inject fetch.
export async function syncOrder(sb, env, order, items, companyNames, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const { accessToken, realmId } = await getAccessToken(sb, env, { nowMs, fetchImpl });
  const plan = documentPlanFor(order, companyNames);
  const customerRef = await findOrCreateCustomer(sb, env, accessToken, realmId, plan.customer, { fetchImpl });
  const itemRefs = {};
  for (const it of items) {
    itemRefs[it.sku] = await findOrCreateItem(sb, env, accessToken, realmId, { sku: it.sku, name: it.name }, { fetchImpl });
  }
  const args = { order, items, customerRef, itemRefs };
  const entity = plan.docType === "invoice" ? "Invoice" : "SalesReceipt";
  const payload = plan.docType === "invoice" ? buildInvoicePayload(args) : buildSalesReceiptPayload(args);
  const url = `${qboApiBase(env)}/v3/company/${realmId}/${entity.toLowerCase()}?minorversion=70`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`qbo_${entity}_post_failed_${res.status}`);
  const j = await res.json();
  return { docId: j[entity].Id, docType: plan.docType };
}
```

- [ ] **Step 3b: Create the processor endpoint `functions/api/qbo-sync.js`**

```javascript
// POST /api/qbo-sync — drains pending orders into QuickBooks. Triggered by Supabase pg_cron.
// Auth: shared secret header only (not user auth). Never throws past the response.
import { adminClient, json } from "../_lib/supabase.js";
import { syncOrder, nextSyncState } from "../_lib/qbo.js";

const BATCH = 10;

function authorized(request, env) {
  const got = request.headers.get("x-qbo-sync-secret") || "";
  const want = env.QBO_SYNC_SECRET || "";
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!authorized(request, env)) return json(401, { error: "unauthorized" });

  const sb = adminClient(env);
  const { data: claimed, error } = await sb.rpc("claim_qbo_orders", { batch: BATCH });
  if (error) return json(500, { error: error.message });

  const results = { synced: 0, failed: 0 };
  for (const order of claimed || []) {
    try {
      const { data: items } = await sb.from("order_items").select("sku,name,qty,unit_price,line_total").eq("order_id", order.id);
      const companyNames = {};
      if (order.company_id) {
        const { data: c } = await sb.from("companies").select("name").eq("id", order.company_id).maybeSingle();
        if (c) companyNames[order.company_id] = c.name;
      }
      const { docId, docType } = await syncOrder(sb, env, order, items || [], companyNames);
      const patch = { qbo_sync_status: "synced", qbo_doc_id: docId, qbo_doc_type: docType, qbo_synced_at: new Date().toISOString(), qbo_error: null };
      if (docType === "invoice") patch.qbo_invoice_id = docId; // keep legacy column + existing UI working
      await sb.from("orders").update(patch).eq("id", order.id);
      results.synced++;
    } catch (e) {
      const patch = { ...nextSyncState(order.qbo_attempts || 0, Date.now()), qbo_error: String(e?.message || e).slice(0, 300) };
      await sb.from("orders").update(patch).eq("id", order.id);
      results.failed++;
    }
  }
  return json(200, results);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/qbo-sync.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/qbo.js functions/api/qbo-sync.js tests/qbo-sync.test.mjs
git commit -m "feat(qbo): add per-order sync orchestrator + processor endpoint"
```

---

## Task 6: Tag paid Stripe orders pending

**Files:**
- Modify: `functions/api/stripe-webhook.js` (order insert ~line 166; TODO ~line 201)
- Test: `tests/qbo-webhook-tag.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/qbo-webhook-tag.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync(new URL("../functions/api/stripe-webhook.js", import.meta.url), "utf8");

test("paid order insert marks qbo_sync_status pending", () => {
  // The orders.insert for paid orders sets the pending flag.
  assert.match(src, /qbo_sync_status:\s*['"]pending['"]/);
});

test("the Phase-3 TODO placeholder is gone", () => {
  assert.doesNotMatch(src, /TODO Phase 3: QBO sales receipt/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/qbo-webhook-tag.test.mjs`
Expected: FAIL — pending flag not present; TODO still there.

- [ ] **Step 3: Modify `functions/api/stripe-webhook.js`**

In the paid-order `sb.from('orders').insert({...})` (around line 166), add the flag:

```javascript
    const { data: order } = await sb.from('orders').insert({
      company_id: s.metadata?.company_id || null,
      status: 'paid',
      payment_method: 'stripe',
      subtotal, tax, total,
      currency: s.currency || 'usd',
      stripe_payment_intent: s.payment_intent,
      ship_address: s.shipping_details || s.customer_details || null,
      qbo_sync_status: 'pending',
    }).select('id').single();
```

Replace the placeholder line (around line 201):

```javascript
    // QBO sales receipt is created asynchronously by /api/qbo-sync (order tagged qbo_sync_status='pending' above).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/qbo-webhook-tag.test.mjs`
Expected: PASS (2 tests).

Also re-run the existing webhook suite to confirm no regression:
Run: `node --test tests/stripe-webhook.test.mjs`
Expected: PASS (unchanged).

- [ ] **Step 5: Commit**

```bash
git fetch origin && git rebase origin/main
git add functions/api/stripe-webhook.js tests/qbo-webhook-tag.test.mjs
git commit -m "feat(qbo): tag paid orders pending for QBO sync"
```

---

## Task 7: Tag NET orders pending

**Files:**
- Modify: `functions/api/checkout.js` (NET order insert ~line 110)
- Test: `tests/qbo-checkout-tag.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/qbo-checkout-tag.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync(new URL("../functions/api/checkout.js", import.meta.url), "utf8");

test("NET order insert marks qbo_sync_status pending", () => {
  // The net_open order insert carries the pending flag.
  const netInsert = src.slice(src.indexOf("net_open"));
  assert.match(netInsert.slice(0, 400), /qbo_sync_status:\s*['"]pending['"]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/qbo-checkout-tag.test.mjs`
Expected: FAIL — pending flag not in the NET insert.

- [ ] **Step 3: Modify `functions/api/checkout.js`**

In the NET path `sb.from('orders').insert({...})` (around line 110), add `qbo_sync_status: 'pending',`:

```javascript
    const { data: order, error: orderErr } = await sb.from('orders').insert({
      company_id: company.id,
      user_id: user.id,
      status: 'net_open',
      payment_method: 'net',
      subtotal, tax, total,
      qbo_sync_status: 'pending',
    }).select('id').single();
```

(Match the surrounding fields exactly as they exist; only add the `qbo_sync_status` line.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/qbo-checkout-tag.test.mjs`
Expected: PASS.

Re-run checkout suite:
Run: `node --test tests/checkout-pricing.test.mjs tests/checkout-stock.test.mjs`
Expected: PASS (unchanged).

- [ ] **Step 5: Commit**

```bash
git fetch origin && git rebase origin/main
git add functions/api/checkout.js tests/qbo-checkout-tag.test.mjs
git commit -m "feat(qbo): tag NET orders pending for QBO sync"
```

---

## Task 8: Admin OAuth connect / callback / status endpoints

**Files:**
- Create: `functions/api/admin/qbo/connect.js`, `functions/api/admin/qbo/callback.js`, `functions/api/admin/qbo/status.js`
- Test: `tests/qbo-oauth.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/qbo-oauth.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("connect redirects to Intuit consent and is staff-gated", () => {
  const s = read("functions/api/admin/qbo/connect.js");
  assert.match(s, /requireStaff/);
  assert.match(s, /appcenter\.intuit\.com\/connect\/oauth2|appcenter\.intuit\.com/);
  assert.match(s, /com\.intuit\.quickbooks\.accounting/);
  assert.match(s, /302/);
});

test("callback exchanges the code and stores the refresh token, staff-gated", () => {
  const s = read("functions/api/admin/qbo/callback.js");
  assert.match(s, /requireStaff/);
  assert.match(s, /grant_type=authorization_code/);
  assert.match(s, /qbo_tokens/);
  assert.match(s, /realmId|realm_id/);
});

test("status reports connected state, staff-gated", () => {
  const s = read("functions/api/admin/qbo/status.js");
  assert.match(s, /requireStaff/);
  assert.match(s, /connected/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/qbo-oauth.test.mjs`
Expected: FAIL — files do not exist.

- [ ] **Step 3a: Create `functions/api/admin/qbo/connect.js`**

```javascript
// GET /api/admin/qbo/connect — staff-only; redirects to the Intuit OAuth2 consent screen.
import { requireStaff, json } from "../../../_lib/supabase.js";

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: "unauthenticated" });
  if (!staff) return json(403, { error: "forbidden" });

  const params = new URLSearchParams({
    client_id: env.QBO_CLIENT_ID,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: env.QBO_REDIRECT_URI,
    state: "masest-qbo",
  });
  return new Response(null, { status: 302, headers: { Location: `https://appcenter.intuit.com/connect/oauth2?${params}` } });
}
```

- [ ] **Step 3b: Create `functions/api/admin/qbo/callback.js`**

```javascript
// GET /api/admin/qbo/callback — staff-only; exchanges the auth code for tokens and stores them.
import { requireStaff, adminClient, json } from "../../../_lib/supabase.js";

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: "unauthenticated" });
  if (!staff) return json(403, { error: "forbidden" });

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  if (!code || !realmId) return json(400, { error: "missing_code_or_realm" });

  const basic = btoa(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`);
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(env.QBO_REDIRECT_URI)}`,
  });
  if (!res.ok) return json(502, { error: `token_exchange_failed_${res.status}` });
  const j = await res.json();

  const sb = adminClient(env);
  const { error } = await sb.from("qbo_tokens").upsert({
    id: 1, realm_id: realmId, refresh_token: j.refresh_token,
    access_token: j.access_token, access_expires_at: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) return json(500, { error: error.message });
  return new Response(null, { status: 302, headers: { Location: "/admin.html#qbo-connected" } });
}
```

- [ ] **Step 3c: Create `functions/api/admin/qbo/status.js`**

```javascript
// GET /api/admin/qbo/status — staff-only; reports whether QBO is connected.
import { requireStaff, adminClient, json } from "../../../_lib/supabase.js";

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: "unauthenticated" });
  if (!staff) return json(403, { error: "forbidden" });

  const sb = adminClient(env);
  const { data } = await sb.from("qbo_tokens").select("realm_id,updated_at").limit(1).maybeSingle();
  return json(200, { connected: !!data?.realm_id, realm_id: data?.realm_id || null, updated_at: data?.updated_at || null });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/qbo-oauth.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/api/admin/qbo/ tests/qbo-oauth.test.mjs
git commit -m "feat(qbo): add admin OAuth connect/callback/status endpoints"
```

---

## Task 9: Admin UI — Connect button + status badge

**Files:**
- Modify: `admin.html`, `js/admin.js`
- Test: `tests/qbo-admin-ui.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/qbo-admin-ui.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../js/admin.js", import.meta.url), "utf8");

test("admin page has a QBO connect control + status mount", () => {
  assert.match(html, /id="qbo-connect"/);
  assert.match(html, /id="qbo-status"/);
});

test("admin js wires the QBO status fetch and connect link", () => {
  assert.match(js, /\/api\/admin\/qbo\/status/);
  assert.match(js, /\/api\/admin\/qbo\/connect/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/qbo-admin-ui.test.mjs`
Expected: FAIL — controls absent.

- [ ] **Step 3a: Add to `admin.html`**

Inside the admin settings/header area (follow the existing section markup — place near other admin tools):

```html
<section class="admin-qbo" aria-label="QuickBooks">
  <h3>QuickBooks Online</h3>
  <span id="qbo-status" class="badge">checking…</span>
  <a id="qbo-connect" href="/api/admin/qbo/connect" class="btn btn-secondary">Connect QuickBooks</a>
</section>
```

- [ ] **Step 3b: Add to `js/admin.js`**

Add an initializer that runs on admin load (call it from the existing init path):

```javascript
async function initQboStatus() {
  const badge = document.getElementById('qbo-status');
  const connect = document.getElementById('qbo-connect');
  if (!badge) return;
  try {
    const res = await fetch('/api/admin/qbo/status', { credentials: 'include' });
    const data = await res.json();
    if (data.connected) {
      badge.textContent = 'Connected';
      badge.classList.add('ok');
      if (connect) connect.textContent = 'Reconnect QuickBooks';
    } else {
      badge.textContent = 'Not connected';
    }
  } catch {
    badge.textContent = 'Status unavailable';
  }
}
initQboStatus();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/qbo-admin-ui.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add admin.html js/admin.js tests/qbo-admin-ui.test.mjs
git commit -m "feat(qbo): add admin Connect button + status badge"
```

---

## Task 10: Env vars + owner docs

**Files:**
- Modify: `.env.example`, `CLOUDFLARE_PAGES.md`
- Test: `tests/qbo-env-docs.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/qbo-env-docs.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const env = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test(".env.example documents all new QBO vars", () => {
  for (const k of ["QBO_SYNC_SECRET", "QBO_REDIRECT_URI", "QBO_INCOME_ACCOUNT_ID"]) {
    assert.match(env, new RegExp(`^${k}=`, "m"), `${k} missing`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/qbo-env-docs.test.mjs`
Expected: FAIL — vars not present.

- [ ] **Step 3a: Append to `.env.example`** (under the existing QBO block)

```
QBO_REDIRECT_URI=https://masest.co/api/admin/qbo/callback
QBO_SYNC_SECRET=
QBO_INCOME_ACCOUNT_ID=
```

- [ ] **Step 3b: Append an owner-setup section to `CLOUDFLARE_PAGES.md`**

```markdown
## QBO auto-sync (P4)

1. Apply `supabase/schema-qbo.sql` (verify service_role grants applied).
2. Enable Supabase extensions `pg_cron` and `pg_net`. Create the schedule:
   ```sql
   select cron.schedule('qbo-sync', '*/5 * * * *', $$
     select net.http_post(
       url := 'https://masest.co/api/qbo-sync',
       headers := jsonb_build_object('X-QBO-Sync-Secret', '<QBO_SYNC_SECRET value>')
     );
   $$);
   ```
3. Set CF env vars: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`,
   `QBO_SYNC_SECRET` (random 32+ chars), `QBO_ENVIRONMENT=sandbox`, optional `QBO_INCOME_ACCOUNT_ID`.
4. In the Intuit developer portal, add the redirect URI to the app.
5. Sign in as staff, open Admin → "Connect QuickBooks", complete consent (sandbox).
6. Place a test card order + a NET order; confirm a SalesReceipt and an Invoice appear in QBO sandbox.
7. Flip `QBO_ENVIRONMENT=production`, update the Intuit app to production keys, and reconnect.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/qbo-env-docs.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .env.example CLOUDFLARE_PAGES.md tests/qbo-env-docs.test.mjs
git commit -m "docs(qbo): document sync env vars + owner setup steps"
```

---

## Task 11: Full-suite regression gate

- [ ] **Step 1: Run the entire node suite**

Run: `node --test tests/*.test.mjs`
Expected: PASS — prior 95 + new QBO tests, 0 fail.

- [ ] **Step 2: Run the checkout playwright path (touched by Task 7)**

Run: `npx playwright test tools/checkout-connector.spec.mjs tools/cart-checkout-redirect.spec.mjs --reporter=line`
Expected: all pass.

- [ ] **Step 3: Final commit / push**

```bash
git fetch origin && git rebase origin/main
git push origin main
```

(Push only when the user authorizes deploying to `main`.)

---

## Notes for the implementer

- **No live Intuit calls in tests.** All QBO IO is exercised with an injected `fetchImpl` fake. Source-assert tests cover handler wiring that needs live env.
- **Idempotency** is the DB status machine: `claim_qbo_orders` flips `pending→processing` under `for update skip locked`, so a second concurrent cron run and Stripe webhook retries cannot double-send. `DocNumber` is a secondary QBO-side guard.
- **Failure is recoverable:** a failed sync increments `qbo_attempts`, re-queues with backoff, and after 5 attempts lands in `error` (visible to staff, who keep the manual `record_qbo_invoice` override).
- **Order of NET-order field additions (Task 7):** only add the `qbo_sync_status` line; do not reorder or drop existing insert fields (re-Read the file first — Codex may have changed it).
