# Admin QBO inline IDs + quote-owner label — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two blocking `prompt()` dialogs in the admin Orders panel (QuickBooks invoice ID / payment ID) with inline text inputs, and give the quotes `#qOwner` filter an accessible name.

**Architecture:** Pure client-side edits to the existing static console. No API, schema, or build changes. The Orders row already has a `data-qbo-order` / `data-qbo-payment-order` button per net order; we add a sibling `<input>` per button and have the click handler read that input instead of calling `prompt()`. The owner filter gains an `aria-label`. Tests follow the repo's existing **source-contract** style (regex assertions over source files in `tests/*.test.mjs`), because the admin client depends on Supabase/Cloudflare bindings that can't run headless.

**Tech Stack:** Vanilla ES modules (`js/admin.js`), static HTML (`admin.html`), `node --test` source-contract tests, `esc()` from `js/util.js`.

---

## ⚠️ Sequencing constraint (read first)

`admin.html` and `js/admin.js` are under an **active uncommitted Codex edit** (`admin-ops-analytics`). Do **not** apply this plan until that work is committed/merged. After it lands:

1. `git fetch origin main && git rebase origin/main` (or pull) so the working tree is clean and current.
2. Re-locate each anchor below by **symbol/attribute name**, not line number — Codex's changes will have shifted line numbers.
3. Then execute the tasks.

If an anchor string below no longer matches verbatim, re-Read the surrounding function and adapt the surrounding context while keeping the described change identical.

---

## File Structure

- `js/admin.js` — modify `renderOrders()`: (a) net-order action-cell template gains two inputs; (b) `[data-qbo-order]` and `[data-qbo-payment-order]` handlers read those inputs instead of `prompt()`.
- `admin.html` — modify the quotes panel: add `aria-label` to `#qOwner`.
- `tests/admin-qbo-inline-ids.test.mjs` — create: source-contract assertions for both changes.

---

## Task 1: Source-contract test (red)

**Files:**
- Test: `tests/admin-qbo-inline-ids.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

```javascript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("admin Orders uses inline QBO id inputs, not blocking prompt()", () => {
  const src = read("js/admin.js");
  assert.doesNotMatch(src, /prompt\(['"]QuickBooks invoice ID['"]\)/, "invoice prompt() must be removed");
  assert.doesNotMatch(src, /prompt\(['"]QuickBooks payment ID['"]\)/, "payment prompt() must be removed");
  assert.match(src, /data-qbo-invoice-input/, "row should render an inline invoice-id input");
  assert.match(src, /data-qbo-payment-input/, "row should render an inline payment-id input");
});

test("admin quotes owner filter has an accessible name", () => {
  const html = read("admin.html");
  assert.match(html, /id="qOwner"[^>]*aria-label=/, "#qOwner needs an aria-label");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/admin-qbo-inline-ids.test.mjs`
Expected: FAIL — `prompt('QuickBooks invoice ID')` still present and `data-qbo-invoice-input` absent; `#qOwner` has no `aria-label`.

- [ ] **Step 3: Commit the red test**

```bash
git add tests/admin-qbo-inline-ids.test.mjs
git commit -m "test(admin): pin inline QBO id inputs + quote-owner label"
```

---

## Task 2: Add `aria-label` to the quotes owner filter

**Files:**
- Modify: `admin.html` (quotes panel, the `id="qOwner"` input)

- [ ] **Step 1: Edit the input**

Find the owner filter input in the quotes panel. Current form (verified against `573610c`):

```html
<input id="qOwner" class="adm-search" type="search" placeholder="Owner">
```

(Attribute order may differ; the stable anchor is `id="qOwner"`.) Add an `aria-label`:

```html
<input id="qOwner" class="adm-search" type="search" placeholder="Owner" aria-label="Filter quotes by owner">
```

- [ ] **Step 2: Run the owner-label test to verify it passes**

Run: `node --test tests/admin-qbo-inline-ids.test.mjs`
Expected: the "accessible name" test now PASSES; the QBO test still FAILS.

---

## Task 3: Render inline QBO id inputs in the Orders row

**Files:**
- Modify: `js/admin.js` → `renderOrders()`, the per-row action `<td>` template, net-order branch.

**Context:** the action cell currently renders (net-order branch only) two buttons whose labels reflect existing ids:

```javascript
${order.payment_method === 'net' ? ` <button class="btn btn-ghost btn-sm" data-qbo-order="${esc(order.id)}" type="button">${order.qbo_invoice_id ? `Invoice ${esc(order.qbo_invoice_id)}` : 'Add invoice'}</button> <button class="btn btn-ghost btn-sm" data-qbo-payment-order="${esc(order.id)}" type="button">${order.qbo_payment_id ? `Payment ${esc(order.qbo_payment_id)}` : 'Add payment'}</button>` : ''}
```

- [ ] **Step 1: Add an input before each QBO button**

Replace that net-order branch with one that prepends a labelled input to each button (keep the `stripe`/refund branch that follows it untouched):

```javascript
${order.payment_method === 'net' ? ` <input class="adm-input" data-qbo-invoice-input="${esc(order.id)}" value="${esc(order.qbo_invoice_id || '')}" placeholder="QBO invoice ID" aria-label="QuickBooks invoice ID for order ${esc(order.id)}" style="max-width:150px"><button class="btn btn-ghost btn-sm" data-qbo-order="${esc(order.id)}" type="button">${order.qbo_invoice_id ? 'Update invoice' : 'Add invoice'}</button> <input class="adm-input" data-qbo-payment-input="${esc(order.id)}" value="${esc(order.qbo_payment_id || '')}" placeholder="QBO payment ID" aria-label="QuickBooks payment ID for order ${esc(order.id)}" style="max-width:150px"><button class="btn btn-ghost btn-sm" data-qbo-payment-order="${esc(order.id)}" type="button">${order.qbo_payment_id ? 'Update payment' : 'Add payment'}</button>` : ''}
```

(The existing-id value now lives in the input, so the button text drops the inline id and just reads Add/Update.)

- [ ] **Step 2: No test run yet** — handlers still call `prompt()`; the input wiring is verified in Task 4. Proceed.

---

## Task 4: Read the inline inputs in the click handlers

**Files:**
- Modify: `js/admin.js` → the `box.querySelectorAll('[data-qbo-order]')` and `box.querySelectorAll('[data-qbo-payment-order]')` handlers inside `renderOrders()`.

- [ ] **Step 1: Replace the invoice handler's `prompt()`**

Current:

```javascript
  box.querySelectorAll('[data-qbo-order]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.qboOrder;
      const invoiceId = prompt('QuickBooks invoice ID');
      if (!invoiceId) return;
```

Replace the `prompt` line with an input read:

```javascript
  box.querySelectorAll('[data-qbo-order]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.qboOrder;
      const invoiceId = box.querySelector(`[data-qbo-invoice-input="${CSS.escape(id)}"]`)?.value.trim();
      if (!invoiceId) { message('ordStatus', 'Enter a QuickBooks invoice ID first.', 'err'); return; }
```

Leave the rest of the handler (the `api('/api/admin/orders', { method:'POST', body:{ id, action:'record_qbo_invoice', qbo_invoice_id: invoiceId.trim() } })` call etc.) unchanged. Note `invoiceId` is already trimmed, so the existing `invoiceId.trim()` in the body is harmless; you may simplify it to `invoiceId` if desired.

- [ ] **Step 2: Replace the payment handler's `prompt()`**

Current:

```javascript
  box.querySelectorAll('[data-qbo-payment-order]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.qboPaymentOrder;
      const paymentId = prompt('QuickBooks payment ID');
      if (!paymentId) return;
```

Replace with:

```javascript
  box.querySelectorAll('[data-qbo-payment-order]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.qboPaymentOrder;
      const paymentId = box.querySelector(`[data-qbo-payment-input="${CSS.escape(id)}"]`)?.value.trim();
      if (!paymentId) { message('ordStatus', 'Enter a QuickBooks payment ID first.', 'err'); return; }
```

Leave the rest of the handler unchanged.

- [ ] **Step 3: Syntax check**

Run: `node --check js/admin.js`
Expected: no output (exit 0).

- [ ] **Step 4: Run the source-contract test to verify it passes**

Run: `node --test tests/admin-qbo-inline-ids.test.mjs`
Expected: both tests PASS (no `prompt('QuickBooks …')`, both `data-qbo-*-input` present, `#qOwner` labelled).

- [ ] **Step 5: Commit**

```bash
git add js/admin.js admin.html tests/admin-qbo-inline-ids.test.mjs
git commit -m "feat(admin): inline QBO invoice/payment id inputs; label quote-owner filter"
```

---

## Task 5: Full gate + runtime smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full verify gate**

Run: `npm run verify`
Expected: `check` ✓, all tests pass (count = prior total + 2), `build` ✓, `verify:site` ✓.

- [ ] **Step 2: Runtime smoke (browser)**

Serve a clean checkout (`python3 -m http.server` from repo root or an isolated worktree) and open `admin.html`. With the app shell visible (real staff login, or force `#admApp` visible for a structural check), confirm in the Orders panel:
- Each net order shows an editable **QBO invoice ID** and **QBO payment ID** input (no `prompt()` dialog appears on click).
- Clicking "Add/Update invoice" with the input empty shows "Enter a QuickBooks invoice ID first." in `#ordStatus` (no network call).
- `#qOwner` exposes the accessible name "Filter quotes by owner" (DOM: `document.getElementById('qOwner').getAttribute('aria-label')`).

- [ ] **Step 3: Push**

```bash
git fetch origin main && git rebase origin/main
git push origin main
```

---

## Self-Review

**Spec coverage:**
- qOwner accessible name → Task 2 + test in Task 1. ✓
- #7 replace both `prompt()` calls with inline inputs → Tasks 3–4 + test in Task 1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type/anchor consistency:** input attribute names `data-qbo-invoice-input` / `data-qbo-payment-input` are defined in Task 3 and queried (via `CSS.escape(id)`) in Task 4 — names match. Handler anchors `data-qbo-order` / `data-qbo-payment-order` are pre-existing and unchanged. ✓

**Known risk:** Tasks 3–4 edit `renderOrders()` in `js/admin.js`; if Codex's analytics work reorganized that function, re-anchor on the `data-qbo-order` / `data-qbo-payment-order` strings and re-apply the same change. The source-contract test (Task 1) catches a wrong/partial application.

**Optional follow-ups (not in scope):** the quotes filter `<select>`s (`#qFilter`, `#qPriority`, `#qDue`) likely also lack accessible names — same `aria-label` treatment if a later a11y pass wants them.
