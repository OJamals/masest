# B2B Credit Enforcement — Design

**Date:** 2026-06-18
**Roadmap:** #3 — block NET orders over `credit_limit`; show running balance / credit available in dashboard.
**Status:** approved (design)

## Problem

The NET checkout path (`functions/api/checkout.js`, `mode='net'`) places an order on
account (`status='net_open'`) for any approved company with `net_terms_days > 0`. It
performs **no credit check**. A company can place unbounded NET orders, accruing
accounts-receivable risk with no ceiling. `credit_limit` exists on `companies` but is
never enforced and never surfaced to the buyer.

## Goal

1. Enforce `credit_limit` at NET checkout — **hard block** orders that would push the
   company's outstanding NET balance over its limit.
2. Surface running balance + credit available in the buyer dashboard.

Non-goals: multi-currency credit, partial-fill, admin override queue, overdue tracking.

## Policy (decided)

- **Hard block.** Over-limit NET order → `403 credit_limit_exceeded`. Buyer must pay
  now (Stripe) or request a quote. No new order state, no admin approval queue.

## Credit model

- **Outstanding** = `sum(orders.total)` where `company_id = X AND status = 'net_open'`.
  - `net_open` = invoice owed. `net_paid` = settled (excluded). `paid`/`pending_payment`/
    `cart`/`cancelled`/`fulfilled` = not NET-owed (excluded).
- **`credit_limit` semantics:**
  - `null` → **unlimited** (no enforcement). Preserves current behavior; does not break
    existing approved-NET companies whose limit was never set.
  - `0` → **zero credit** → every NET order blocks.
  - `> 0` → enforced ceiling.
- **Available** = `unlimited ? null : max(0, credit_limit − outstanding)`.
- **Block rule:** `!unlimited && (outstanding + order_subtotal) > credit_limit`.
  At-limit (`==`) is **allowed**; strictly over (`>`) is blocked.

## Architecture — 1 new unit + 4 touch points

### 1. `functions/_lib/credit.js` (new) — single source of truth
```
export async function companyCreditState(sb, companyId)
  → { credit_limit, outstanding, available, unlimited }
```
- One query: select `total` from `orders` where `company_id` + `status='net_open'`, sum
  in JS (numeric(12,2), rounded to cents). Returns `outstanding: 0` for null/empty.
- Loads `credit_limit` from `companies` (or accepts it from caller to avoid a 2nd read —
  see touch points). Keep the helper self-contained: it reads both.
- Pure of HTTP concerns; testable with a fake `sb`.

### 2. `functions/api/checkout.js` — enforce (net branch, after approve gate ~`:105`)
- After confirming `status==='approved' && net_terms_days>0`, call
  `companyCreditState(sb, company.id)`.
- If `!unlimited && (outstanding + subtotal) > credit_limit`:
  `return json(403, { error:'credit_limit_exceeded', credit_limit, outstanding,
  available, order_total: subtotal })`.
- Check runs **before** order insert / stock decrement. `subtotal` = NET order subtotal
  already computed in the branch.

### 3. `functions/api/account/me.js` — surface
- Add a `credit` block to the response via `companyCreditState`:
  `credit: { credit_limit, net_outstanding: outstanding, credit_available: available,
  unlimited }`.
- Only when `profile.company_id` present; omit/null otherwise.

### 4. `js/dashboard.js` — display
- New row under the existing NET-terms row (`~:51`): show **balance owed** and **credit
  available** when NET enabled and `!unlimited`. If `unlimited`, show "No credit limit"
  or omit the available figure. Values from `ACCOUNT.credit`.

### 5. `js/cart.js` (checkout client) — handle 403
- On `credit_limit_exceeded`: show "This order ($order_total) exceeds your available
  credit ($available). Pay now or contact sales." Offer the pay-now (Stripe) path /
  link to contact. Exact wording finalized against existing error-toast pattern in the
  client during implementation.

## Data flow

```
Buyer → POST /api/checkout {mode:'net'}
  → approve gate (status, net_terms_days)
  → companyCreditState(sb, companyId)   [SELECT total WHERE net_open]
  → over limit?  yes → 403 credit_limit_exceeded → client shows pay-now/contact
                 no  → insert order (net_open) → 201

Dashboard load → GET /api/account/me → {..., credit:{limit,outstanding,available}}
  → js/dashboard.js renders balance + available row
```

## Error handling

- Credit query failure (DB error): **fail safe = block** is too aggressive for a transient
  error; instead treat a query error as `outstanding = unknown` and **allow** only when
  unlimited, else return `503 credit_check_unavailable` so the buyer retries rather than
  silently over-extending. (Rare path; logged.)
- `credit_limit` malformed/non-numeric: treat as `null` (unlimited) defensively — admin
  data-entry guard is separate.

## Known limitation (accepted)

**TOCTOU:** two simultaneous NET orders from the same company can both pass the check
before either inserts, briefly exceeding the limit. B2B NET ordering is human-paced and
single-company, so risk is low. A DB-atomic guard (trigger / `select ... for update` /
RPC) is deferred. Documented, not fixed.

## Testing (TDD)

- **credit-helper unit** (`tests/credit-helper.test.mjs`): outstanding sums `net_open`
  only; excludes `net_paid`/`paid`/`cancelled`; `null` limit → unlimited; `0` → blocks;
  `available = max(0, limit − outstanding)`; empty orders → 0.
- **checkout net enforcement** (extend existing checkout test or new
  `tests/checkout-credit.test.mjs`): over-limit → 403 `credit_limit_exceeded`;
  under-limit → 201; at-limit (`==`) → 201; `null` limit → 201 (unlimited).
- **account/me credit fields**: response includes `credit` block with correct
  outstanding/available.
- **`tests/functions-import-resolve.test.mjs`**: MUST pass — touches `functions/`.
  New `_lib/credit.js` import depth **differs per file**:
  - `functions/api/checkout.js` → `../_lib/credit.js`
  - `functions/api/account/me.js` → `../../_lib/credit.js`
  A wrong depth fails the CF build silently (`node --check`/grep do NOT catch it) — the
  import-resolve test is the gate.

## Verify gates (before push)

- `node --test tests/*.test.mjs` green.
- `node --test tests/functions-import-resolve.test.mjs` green (functions/ touched).
- Manual/probe: dashboard renders credit row; over-limit NET returns 403.

## Lane / collision

Touches `checkout.js`, `_lib/credit.js`, `account/me.js`, `dashboard.js`, `cart.js` —
clear of Codex's active quote/admin lead-scoring lane. Build in isolated worktree off
`origin/main`; rebase + push to main; verify Codex didn't build the same.
