# B2B Credit Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-block NET checkout orders that would push a company past its `credit_limit`, and show running balance + credit available in the buyer dashboard.

**Architecture:** One pure-ish shared helper (`functions/_lib/credit.js`) holds all credit logic (outstanding = sum of `net_open` order totals; available; over-limit predicate). `checkout.js` calls it to block over-limit NET orders before inserting; `account/me.js` calls it to surface a `credit` block consumed by `dashboard.js`. `cart.html` renders a buyer message for the new `credit_limit_exceeded` error. Logic lives in the helper (functionally unit-tested); the API/UI glue is thin (source-asserted, matching repo convention for `checkout.js`).

**Tech Stack:** Cloudflare Pages Functions (ESM), Supabase (PostgREST via `@supabase/supabase-js`), vanilla JS browser client, `node:test` (functional + source-assertion).

---

## File Structure

- **Create** `functions/_lib/credit.js` — credit logic: `round2`, `exceedsCredit(state, orderTotal)`, `companyCreditState(sb, companyId, creditLimit)`.
- **Create** `tests/credit-helper.test.mjs` — functional unit tests (fake `sb`).
- **Create** `tests/credit-enforcement.test.mjs` — source-assertion: checkout/me/dashboard/cart wiring + import depth.
- **Modify** `functions/api/checkout.js` — import helper (`../_lib/credit.js`); extend company select; enforce in net branch before insert.
- **Modify** `functions/api/account/me.js` — import helper (`../../_lib/credit.js`); add `credit` block to response.
- **Modify** `js/dashboard.js` — render balance owed + credit available from `ACCOUNT.credit`.
- **Modify** `cart.html` — add `credit_limit_exceeded` case to `checkoutErrorMessage`.

**Import depth (prod-critical — wrong depth fails CF build silently):**
- `functions/api/checkout.js` → `../_lib/credit.js`
- `functions/api/account/me.js` → `../../_lib/credit.js`

---

## Task 1: Credit helper + functional unit test

**Files:**
- Create: `functions/_lib/credit.js`
- Test: `tests/credit-helper.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/credit-helper.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { companyCreditState, exceedsCredit, round2 } from "../functions/_lib/credit.js";

// Fake PostgREST builder: .select().eq().eq() then awaited -> { data, error }.
function fakeSb(orders = []) {
  return {
    from(table) {
      let rows = table === "orders" ? [...orders] : [];
      const b = {
        select() { return b; },
        eq(field, value) { rows = rows.filter((r) => r[field] === value); return b; },
        then(resolve) { resolve({ data: rows, error: null }); },
      };
      return b;
    },
  };
}
function errSb() {
  return {
    from() {
      const b = { select: () => b, eq: () => b, then: (res) => res({ data: null, error: { message: "boom" } }) };
      return b;
    },
  };
}

const ORDERS = [
  { company_id: "c1", status: "net_open", total: 100 },
  { company_id: "c1", status: "net_open", total: 50 },
  { company_id: "c1", status: "net_paid", total: 999 },   // settled — excluded
  { company_id: "c1", status: "paid", total: 999 },        // stripe — excluded
  { company_id: "c1", status: "cancelled", total: 999 },   // excluded
  { company_id: "c2", status: "net_open", total: 7 },      // other company — excluded
];

test("outstanding sums only net_open orders for the company", async () => {
  const s = await companyCreditState(fakeSb(ORDERS), "c1", 1000);
  assert.equal(s.outstanding, 150);
  assert.equal(s.credit_limit, 1000);
  assert.equal(s.available, 850);
  assert.equal(s.unlimited, false);
});

test("null credit_limit => unlimited (no enforcement)", async () => {
  const s = await companyCreditState(fakeSb(ORDERS), "c1", null);
  assert.equal(s.unlimited, true);
  assert.equal(s.credit_limit, null);
  assert.equal(s.available, null);
  assert.equal(s.outstanding, 150);
  assert.equal(exceedsCredit(s, 1e9), false);
});

test("zero credit_limit blocks any NET order", async () => {
  const s = await companyCreditState(fakeSb([]), "c1", 0);
  assert.equal(s.unlimited, false);
  assert.equal(s.outstanding, 0);
  assert.equal(s.available, 0);
  assert.equal(exceedsCredit(s, 0.01), true);
});

test("at-limit allowed, strictly-over blocked", async () => {
  const s = await companyCreditState(fakeSb(ORDERS), "c1", 1000); // outstanding 150
  assert.equal(exceedsCredit(s, 850), false);    // 150+850 == 1000 -> allowed
  assert.equal(exceedsCredit(s, 850.01), true);  // > 1000 -> blocked
});

test("empty orders => zero outstanding, full credit available", async () => {
  const s = await companyCreditState(fakeSb([]), "c1", 500);
  assert.equal(s.outstanding, 0);
  assert.equal(s.available, 500);
});

test("query error throws (caller decides how to fail)", async () => {
  await assert.rejects(() => companyCreditState(errSb(), "c1", 500));
});

test("round2 avoids float drift", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/credit-helper.test.mjs`
Expected: FAIL — `Cannot find module '.../functions/_lib/credit.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `functions/_lib/credit.js`:

```js
// Shared B2B credit logic — single source of truth for a company's open NET balance and
// available credit. Used by checkout.js (enforcement) and account/me.js (display).
//
// Outstanding = sum of order totals still owed on account (status 'net_open').
//   'net_paid' = settled (excluded); every other status is not NET-owed (excluded).
// credit_limit semantics:
//   null  -> unlimited (no enforcement; preserves pre-enforcement behavior)
//   0     -> zero credit (every NET order blocks)
//   > 0   -> enforced ceiling

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Pure predicate: would an order of `orderTotal` push the company over its limit?
// At-limit (==) is allowed; strictly over (>) is blocked.
export function exceedsCredit(state, orderTotal) {
  if (state.unlimited) return false;
  return round2(state.outstanding + Number(orderTotal || 0)) > state.credit_limit;
}

// Reads the company's open NET balance and derives available credit.
// `creditLimit` is companies.credit_limit (caller already loaded the company row).
// Throws on query error so the caller chooses how to fail (checkout -> 503; me -> degrade).
export async function companyCreditState(sb, companyId, creditLimit) {
  const unlimited = creditLimit == null;
  const { data, error } = await sb
    .from('orders')
    .select('total')
    .eq('company_id', companyId)
    .eq('status', 'net_open');
  if (error) throw error;
  const outstanding = round2((data || []).reduce((sum, row) => sum + (Number(row.total) || 0), 0));
  const credit_limit = unlimited ? null : Number(creditLimit);
  const available = unlimited ? null : Math.max(0, round2(credit_limit - outstanding));
  return { credit_limit, outstanding, available, unlimited };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/credit-helper.test.mjs`
Expected: PASS — 7 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/credit.js tests/credit-helper.test.mjs
git commit -m "feat(credit): shared B2B credit-state helper + unit tests"
```

---

## Task 2: Enforce credit limit in NET checkout

**Files:**
- Modify: `functions/api/checkout.js` (import line ~6; net branch `:104`, `:109-110`)
- Test: `tests/credit-enforcement.test.mjs` (checkout section)

- [ ] **Step 1: Write the failing test**

Create `tests/credit-enforcement.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("checkout imports credit helper at the correct depth", () => {
  const src = read("functions/api/checkout.js");
  assert.match(src, /from\s+['"]\.\.\/_lib\/credit\.js['"]/, "checkout.js must import ../_lib/credit.js");
});

test("checkout net branch enforces credit before inserting the order", () => {
  const src = read("functions/api/checkout.js");
  assert.match(src, /companyCreditState\(/, "must compute credit state");
  assert.match(src, /exceedsCredit\(/, "must test the over-limit predicate");
  assert.match(src, /credit_limit_exceeded/, "must return the credit_limit_exceeded error");
  assert.match(src, /credit_check_unavailable/, "must 503 on a credit query error");
  // company select must load credit_limit
  assert.match(src, /select\('id,status,net_terms_days,credit_limit'\)/, "net company select must include credit_limit");
  // enforcement must run BEFORE the order insert
  const checkIdx = src.indexOf("credit_limit_exceeded");
  const insertIdx = src.indexOf("from('orders').insert");
  assert.ok(checkIdx > -1 && insertIdx > -1 && checkIdx < insertIdx,
    "credit check must precede the order insert");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/credit-enforcement.test.mjs`
Expected: FAIL — checkout source lacks `companyCreditState`/`credit_limit_exceeded` and the select lacks `credit_limit`.

- [ ] **Step 3: Write the implementation**

Edit `functions/api/checkout.js`.

(3a) Add the import after the existing `checkout-session.js` import (line ~6):

```js
import { companyCreditState, exceedsCredit } from '../_lib/credit.js';
```

(3b) Extend the company select on line 104 to load `credit_limit`. Replace:

```js
    const { data: company } = await sb.from('companies').select('id,status,net_terms_days').eq('id', profile?.company_id).maybeSingle();
```

with:

```js
    const { data: company } = await sb.from('companies').select('id,status,net_terms_days,credit_limit').eq('id', profile?.company_id).maybeSingle();
```

(3c) Insert the credit check between the subtotal computation (line 109) and the order insert (line 110). Replace:

```js
    const subtotal = sellable.reduce((s, p) => s + Number(p.price) * qtyBySku[p.sku], 0);
    const { data: order, error: orderErr } = await sb.from('orders').insert({
```

with:

```js
    const subtotal = sellable.reduce((s, p) => s + Number(p.price) * qtyBySku[p.sku], 0);

    // Credit enforcement: hard-block NET orders that would exceed the company's credit limit.
    let creditState;
    try {
      creditState = await companyCreditState(sb, company.id, company.credit_limit);
    } catch (err) {
      return json(503, { error: 'credit_check_unavailable' });
    }
    if (exceedsCredit(creditState, subtotal)) {
      return json(403, {
        error: 'credit_limit_exceeded',
        credit_limit: creditState.credit_limit,
        outstanding: creditState.outstanding,
        available: creditState.available,
        order_total: subtotal,
      });
    }

    const { data: order, error: orderErr } = await sb.from('orders').insert({
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/credit-enforcement.test.mjs`
Expected: PASS (3 tests). Then run the import-resolve gate (functions/ touched):
Run: `node --test tests/functions-import-resolve.test.mjs`
Expected: PASS (1 test) — confirms `../_lib/credit.js` resolves from checkout.js.

- [ ] **Step 5: Commit**

```bash
git add functions/api/checkout.js tests/credit-enforcement.test.mjs
git commit -m "feat(credit): block over-limit NET orders at checkout"
```

---

## Task 3: Surface credit state in account/me

**Files:**
- Modify: `functions/api/account/me.js` (import; response object)
- Test: `tests/credit-enforcement.test.mjs` (add me.js section)

- [ ] **Step 1: Add the failing test**

Append to `tests/credit-enforcement.test.mjs`:

```js
test("account/me imports credit helper at the correct depth and returns a credit block", () => {
  const src = read("functions/api/account/me.js");
  assert.match(src, /from\s+['"]\.\.\/\.\.\/_lib\/credit\.js['"]/, "me.js must import ../../_lib/credit.js");
  assert.match(src, /companyCreditState\(/, "me.js must compute credit state");
  assert.match(src, /net_outstanding/, "me.js must expose net_outstanding");
  assert.match(src, /credit_available/, "me.js must expose credit_available");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/credit-enforcement.test.mjs`
Expected: FAIL on the new me.js test — `companyCreditState`/`net_outstanding` not in me.js yet.

- [ ] **Step 3: Write the implementation**

Edit `functions/api/account/me.js`.

(3a) Add the import alongside the other `_lib` imports at the top of the file (depth `../../_lib/credit.js`):

```js
import { companyCreditState } from '../../_lib/credit.js';
```

(3b) Compute the credit block after the `company` query and before the `return json(200, {...})`. Insert:

```js
  let credit = null;
  if (company?.id) {
    try {
      const state = await companyCreditState(sb, company.id, company.credit_limit);
      credit = {
        credit_limit: state.credit_limit,
        net_outstanding: state.outstanding,
        credit_available: state.available,
        unlimited: state.unlimited,
      };
    } catch (err) {
      credit = null; // degrade gracefully — never break the dashboard load on a credit read
    }
  }
```

(3c) Add `credit` to the response object. Change:

```js
    can_use_net_terms: company?.status === 'approved' && (company?.net_terms_days || 0) > 0,
    setup: buildAccountSetup(profile, company),
  });
```

to:

```js
    can_use_net_terms: company?.status === 'approved' && (company?.net_terms_days || 0) > 0,
    credit,
    setup: buildAccountSetup(profile, company),
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/credit-enforcement.test.mjs`
Expected: PASS (4 tests). Then:
Run: `node --test tests/functions-import-resolve.test.mjs`
Expected: PASS — confirms `../../_lib/credit.js` resolves from account/me.js (catches a wrong depth).

- [ ] **Step 5: Commit**

```bash
git add functions/api/account/me.js tests/credit-enforcement.test.mjs
git commit -m "feat(credit): expose credit balance/available in account/me"
```

---

## Task 4: Render credit row in the buyer dashboard

**Files:**
- Modify: `js/dashboard.js` (the `ovAccount` template, ~`:46-51`)
- Test: `tests/credit-enforcement.test.mjs` (add dashboard section)

- [ ] **Step 1: Add the failing test**

Append to `tests/credit-enforcement.test.mjs`:

```js
test("dashboard renders balance owed + credit available from ACCOUNT.credit", () => {
  const js = read("js/dashboard.js");
  assert.match(js, /ACCOUNT\??\.credit/, "dashboard must read ACCOUNT.credit");
  assert.match(js, /Balance owed/, "dashboard must label the outstanding balance");
  assert.match(js, /Credit available/, "dashboard must label available credit");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/credit-enforcement.test.mjs`
Expected: FAIL on the dashboard test — strings not present yet.

- [ ] **Step 3: Write the implementation**

Edit `js/dashboard.js`. Find the `ovAccount` template; its last row is the NET-terms line ending in a backtick:

```js
    <div class="dash-row"><span>NET terms</span><b>${ACCOUNT?.can_use_net_terms ? 'NET-' + c?.net_terms_days : 'Not enabled'}</b></div>`;
```

Replace that single line with (adds two conditional rows when NET is enabled and a finite limit is set; `money()` is already used elsewhere in this file):

```js
    <div class="dash-row"><span>NET terms</span><b>${ACCOUNT?.can_use_net_terms ? 'NET-' + c?.net_terms_days : 'Not enabled'}</b></div>${ACCOUNT?.credit && !ACCOUNT.credit.unlimited ? `
    <div class="dash-row"><span>Balance owed</span><b>${money(ACCOUNT.credit.net_outstanding, 'usd')}</b></div>
    <div class="dash-row"><span>Credit available</span><b>${money(ACCOUNT.credit.credit_available, 'usd')}</b></div>` : ''}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/credit-enforcement.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add js/dashboard.js tests/credit-enforcement.test.mjs
git commit -m "feat(credit): show balance owed + credit available on dashboard"
```

---

## Task 5: Buyer message for credit_limit_exceeded

**Files:**
- Modify: `cart.html` (`checkoutErrorMessage`, ~`:166-181`)
- Test: `tests/credit-enforcement.test.mjs` (add cart section)

- [ ] **Step 1: Add the failing test**

Append to `tests/credit-enforcement.test.mjs`:

```js
test("cart surfaces a credit_limit_exceeded buyer message", () => {
  const html = read("cart.html");
  assert.match(html, /credit_limit_exceeded/, "cart must handle the credit_limit_exceeded code");
  assert.match(html, /available credit/i, "cart message must mention available credit");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/credit-enforcement.test.mjs`
Expected: FAIL on the cart test — `cart.html` has no `credit_limit_exceeded` case.

- [ ] **Step 3: Write the implementation**

Edit `cart.html`. In `checkoutErrorMessage(err)`, add a case before the `cart_empty`/default lines. Change:

```js
    if (err?.message === "cart_empty") return "Add at least one product before checkout.";
    return "Checkout is not available for this cart. Send a quote request and MASEST will confirm the order path.";
```

to:

```js
    if (err?.code === "credit_limit_exceeded") {
      const avail = Number(err.available || 0).toFixed(2);
      const total = Number(err.order_total || 0).toFixed(2);
      return `This $${total} order exceeds your available credit ($${avail}). Pay now with a card, or send a quote request and MASEST will review your account terms.`;
    }
    if (err?.message === "cart_empty") return "Add at least one product before checkout.";
    return "Checkout is not available for this cart. Send a quote request and MASEST will confirm the order path.";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/credit-enforcement.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add cart.html tests/credit-enforcement.test.mjs
git commit -m "feat(credit): buyer-facing message when an order exceeds available credit"
```

---

## Task 6: Full verify + integrate to main

**Files:** none (verification + git).

- [ ] **Step 1: Full suite green**

Run: `node --test tests/*.test.mjs`
Expected: all pass, 0 fail (prior ~197 + new credit tests).

- [ ] **Step 2: Import-resolve gate (functions/ touched)**

Run: `node --test tests/functions-import-resolve.test.mjs`
Expected: PASS (1 test). Confirms both credit-helper import depths resolve (CF build safety).

- [ ] **Step 3: Rebase onto latest origin/main (Codex races)**

```bash
git fetch origin
git rebase origin/main
```
If Codex built the same feature, the rebase may drop dups — verify the result still compiles and tests pass; do not blindly force.

- [ ] **Step 4: Re-run both gates after rebase**

Run: `node --test tests/*.test.mjs && node --test tests/functions-import-resolve.test.mjs`
Expected: all pass.

- [ ] **Step 5: Push to main**

```bash
git push origin HEAD:main
```
Then confirm the Cloudflare Pages deploy goes green (no FAILED build in CF Deployments). A build failure here is almost always an import-resolution error — fixed by Step 2 if it passed.

---

## Self-Review notes

- **Spec coverage:** hard-block policy (Task 2), outstanding=net_open-only (Task 1), null=unlimited / 0=zero (Task 1), at-limit allowed (Task 1), dashboard balance+available (Task 4), buyer 403 message (Task 5), 503 on credit query error (Task 2), TOCTOU documented (spec, accepted). All covered.
- **Type consistency:** helper returns `{ credit_limit, outstanding, available, unlimited }` everywhere; me.js remaps `outstanding`→`net_outstanding`, `available`→`credit_available` for the API/dashboard contract; `exceedsCredit(state, orderTotal)` signature consistent across Tasks 1–2.
- **Import depth:** checkout `../_lib/credit.js`; me `../../_lib/credit.js` — asserted in Tasks 2–3 + import-resolve gate in Tasks 2/3/6.
