# Klaviyo Lead Nurture — Design

**Date:** 2026-06-18
**Roadmap:** #4 — wire the already-configured Klaviyo: quote → 3-email drip by industry + newsletter landing page. Builds on the email backbone.
**Status:** approved (design)

## Problem

Klaviyo is partially wired: `functions/api/newsletter.js` subscribes an email to one
general list (`KLAVIYO_LIST_ID`) via the subscription-bulk-create-jobs API, and
`js/integrations.js` exposes `subscribeNewsletter()`. There is **no quote-lead nurture**
(a quote submission does not enter any Klaviyo flow) and **no dedicated newsletter
landing page** (only a footer form).

## Goal

1. On quote submit, subscribe the lead to an **industry-specific Klaviyo list** so an
   owner-built, list-triggered 3-email drip nurtures them by industry.
2. Ship a standalone **newsletter landing page** for general signups.
3. Extract the shared Klaviyo subscribe call into one helper (DRY with `newsletter.js`).

Non-goals: building the Klaviyo flows/email content (owner does this in Klaviyo);
server-side event/metric tracking; lead scoring (separate Codex work); double opt-in
mechanics (governed by Klaviyo list settings).

## Decision (chosen)

**Per-industry lists.** Code resolves the lead's `industry` to a Klaviyo list ID from an
env var and subscribes the email to that list. Owner creates the lists + list-triggered
flows. (Alternative server-event approach was declined.)

## Industry → env mapping

The quote form submits `industry` as label text. Normalize (lowercase, collapse
non-alphanumeric runs to `_`, trim) and map:

| Industry (form label) | normalized | env var |
|---|---|---|
| Oil & Gas | `oil_gas` | `KLAVIYO_LIST_OIL_GAS` |
| Marine | `marine` | `KLAVIYO_LIST_MARINE` |
| Manufacturing | `manufacturing` | `KLAVIYO_LIST_MANUFACTURING` |
| Food & Beverage | `food_beverage` | `KLAVIYO_LIST_FOOD_BEVERAGE` |
| Healthcare | `healthcare` | `KLAVIYO_LIST_HEALTHCARE` |
| Construction | `construction` | `KLAVIYO_LIST_CONSTRUCTION` |
| Military / Government | `military_government` | `KLAVIYO_LIST_MILITARY_GOV` |
| Education | `education` | `KLAVIYO_LIST_EDUCATION` |
| HVAC / Water Treatment | `hvac_water_treatment` | `KLAVIYO_LIST_HVAC_WATER` |
| Plumbing | `plumbing` | `KLAVIYO_LIST_PLUMBING` |
| Other / empty / unmapped | — | `KLAVIYO_LIST_NURTURE` (fallback) |

- Unknown/empty industry → fallback `KLAVIYO_LIST_NURTURE`, so every lead is still
  nurtured.
- If the resolved env var is unset (and no fallback) → resolve to `null` → no-op (the
  quote still succeeds).

## Architecture — 1 new unit + 1 new page + 3 touch points

### 1. `functions/_lib/klaviyo.js` (new) — single Klaviyo unit
```
const REVISION = '2024-10-15';
INDUSTRY_LIST_ENV = { 'oil_gas': 'KLAVIYO_LIST_OIL_GAS', ... }   // normalized -> env key

export function normalizeIndustry(industry) -> string            // lowercase/underscore/trim
export function listIdForIndustry(env, industry) -> string|null  // env id or NURTURE fallback or null
export async function klaviyoSubscribe(env, email, listId)
  -> { ok, skipped?, status? }                                   // best-effort; skipped if no key/list
export async function subscribeLeadByIndustry(env, { email, industry })
  -> { ok, skipped?, listId? }                                   // resolve + subscribe; never throws upward path
```
- `klaviyoSubscribe` holds the subscription-bulk-create-jobs POST currently inline in
  `newsletter.js` (same payload, headers, 202-check). Uses `globalThis.fetch`
  (stubbable in tests). Returns `{ ok:false, skipped:true }` when `KLAVIYO_PRIVATE_KEY`
  or `listId` is missing — never throws on config gaps.
- `subscribeLeadByIndustry` resolves the list then calls `klaviyoSubscribe`. A bad
  email or missing list → `{ skipped:true }`.

### 2. `functions/api/quote.js` — fire the nurture subscribe (minimal footprint)
- Add import: `import { subscribeLeadByIndustry } from '../_lib/klaviyo.js';`
- After the autoreply `sendEmail`, before `return json(200, ...)`:
  ```js
  try { await subscribeLeadByIndustry(env, { email, industry: fields.industry }); } catch { /* nurture is best-effort */ }
  ```
- Two-line change near the email cluster — deliberately far from any lead-scoring code
  (top of file) so a rebase against Codex's WIP applies cleanly.

### 3. `functions/api/newsletter.js` — DRY refactor
- Replace the inline payload + fetch + 202-check with
  `const r = await klaviyoSubscribe(env, email, env.KLAVIYO_LIST_ID);`
- Preserve current HTTP contract: `400 invalid_email`, honeypot 200, `429 rate_limited`,
  `500 newsletter_not_configured` when key/list absent, `502 klaviyo_error` on non-202,
  `200 { ok:true }` on success. Map helper results back to these codes.

### 4. `newsletter.html` (new) — landing page
- Standalone page using the site's existing chrome (header/footer, CSS, `js/main` or
  `integrations.js`). A single email field + subscribe button calling
  `window.MASEST.subscribeNewsletter(email)` (already exposed). Success/error inline
  message. Honeypot field (`company`) matching the function's check. SEO meta + added to
  `sitemap.xml`.

### 5. `.env.example` — document new keys
- Add the 11 `KLAVIYO_LIST_*` industry keys + `KLAVIYO_LIST_NURTURE` under the existing
  Klaviyo block, with a one-line note that each maps to a Klaviyo list with a
  list-triggered nurture flow.

## Data flow

```
Quote submit -> /api/quote
  (persist + sales email + autoreply, unchanged)
  -> subscribeLeadByIndustry(env, {email, industry})
       -> listIdForIndustry(env, industry)  [normalize -> env id | NURTURE | null]
       -> klaviyoSubscribe(env, email, listId)  [bulk-subscribe POST, best-effort]
  -> 200 { ok, saved }   (Klaviyo result never changes the quote response)

Newsletter page -> subscribeNewsletter(email) -> /api/newsletter
  -> klaviyoSubscribe(env, email, KLAVIYO_LIST_ID) -> 200 { ok:true }
```

## Error handling

- Klaviyo is **best-effort and non-blocking** for quotes: any failure (no key, unset
  list, network error, non-202) is swallowed; the quote still returns `200`.
- `newsletter.js` keeps surfacing errors (it is the user's direct action): `500` when
  unconfigured, `502` on Klaviyo non-202.
- `klaviyoSubscribe` never throws on missing config — returns `{ skipped:true }`.

## Compliance note (owner decision)

Subscribing quote submitters uses `consent: 'SUBSCRIBED'` (same as the existing
newsletter path) so the drip can send. A quote request is not an explicit marketing
opt-in. **Recommend** adding a short consent line/checkbox to the quote form, or confirm
this soft opt-in fits MASEST policy. Implementation matches the established pattern;
consent UX is an owner call, flagged not blocked.

## Testing (TDD)

- **klaviyo-helper unit** (`tests/klaviyo-helper.test.mjs`):
  - `normalizeIndustry("Oil & Gas") === "oil_gas"`; `"HVAC / Water Treatment" ===
    "hvac_water_treatment"`.
  - `listIdForIndustry` returns the mapped env id; falls back to `KLAVIYO_LIST_NURTURE`
    for `Other`/empty/unmapped; `null` when nothing set.
  - `klaviyoSubscribe` → `{ skipped:true }` with no key; posts and returns `{ ok:true }`
    on a stubbed `globalThis.fetch` 202; `{ ok:false }` on non-202.
  - `subscribeLeadByIndustry` → `{ skipped:true }` when no list resolves; calls subscribe
    with the resolved list id otherwise (assert via fetch stub URL/body).
- **source-assert** (`tests/klaviyo-nurture.test.mjs`):
  - `quote.js` imports `../_lib/klaviyo.js` and calls `subscribeLeadByIndustry` after the
    autoreply send and before `return json`.
  - `newsletter.js` calls `klaviyoSubscribe` (no longer inlines the bulk-job payload).
  - `newsletter.html` has an email input + calls `subscribeNewsletter` + honeypot field.
- **`tests/functions-import-resolve.test.mjs`** — MUST pass. `_lib/klaviyo.js` imported
  from `api/quote.js` (`../_lib`) and `api/newsletter.js` (`../_lib`). Both are
  `api/X.js` → depth `../_lib`. A wrong depth fails the CF build silently.

## Verify gates (before push)

- `node --test tests/*.test.mjs` green.
- `node --test tests/functions-import-resolve.test.mjs` green (functions/ touched).
- Live probe: `newsletter.html` renders (follow redirect, `curl -sSL`); `/api/newsletter`
  returns `200`/`500` as configured.

## Lane / collision

`quote.js` is contended — Codex has uncommitted-local lead-scoring WIP there (not pushed;
origin/main `quote.js` is clean). The quote.js change is a 2-line addition near the email
send, away from the scoring block, so a rebase applies cleanly. Other files
(`_lib/klaviyo.js`, `newsletter.html`, `.env.example`) are clear of Codex. Build in an
isolated worktree off `origin/main`; fetch + rebase before push; if Codex pushed
quote.js lead-scoring in the interim, verify the merged result compiles + tests pass.
