# Klaviyo Lead Nurture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On quote submit, subscribe the lead to an industry-specific Klaviyo list (for an owner-built 3-email drip); ship a newsletter landing page; DRY the Klaviyo subscribe call into one helper.

**Architecture:** New `functions/_lib/klaviyo.js` owns the subscription-bulk-create-jobs POST and industry→list resolution. `newsletter.js` refactors to use it; `quote.js` fires a best-effort industry subscribe after its emails. New `newsletter.html` is a standalone signup page reusing site chrome.

**Tech Stack:** Cloudflare Pages Functions (ESM), Klaviyo REST (revision 2024-10-15) via `globalThis.fetch`, vanilla JS client, `node:test`.

---

## File Structure

- **Create** `functions/_lib/klaviyo.js` — `normalizeIndustry`, `listIdForIndustry`, `klaviyoSubscribe`, `subscribeLeadByIndustry`.
- **Create** `tests/klaviyo-helper.test.mjs` — functional (fetch-stubbed).
- **Create** `tests/klaviyo-nurture.test.mjs` — source-assertion wiring.
- **Create** `newsletter.html` — landing page.
- **Modify** `functions/api/newsletter.js` — use `klaviyoSubscribe`.
- **Modify** `functions/api/quote.js` — import + best-effort `subscribeLeadByIndustry` after autoreply.
- **Modify** `.env.example` — document the 12 `KLAVIYO_LIST_*` keys.
- **Modify** `sitemap.xml` — add `newsletter.html`.

**Import depth (prod-critical):** both `functions/api/quote.js` and `functions/api/newsletter.js` are `api/X.js` → `../_lib/klaviyo.js`.

---

## Task 1: Klaviyo helper + functional unit test

**Files:**
- Create: `functions/_lib/klaviyo.js`
- Test: `tests/klaviyo-helper.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/klaviyo-helper.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeIndustry, listIdForIndustry, klaviyoSubscribe, subscribeLeadByIndustry,
} from "../functions/_lib/klaviyo.js";

const ENV = {
  KLAVIYO_PRIVATE_KEY: "pk_test",
  KLAVIYO_LIST_OIL_GAS: "LIST_OIL",
  KLAVIYO_LIST_HVAC_WATER: "LIST_HVAC",
  KLAVIYO_LIST_NURTURE: "LIST_FALLBACK",
};

function stubFetch(status) {
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return { status }; };
  return calls;
}
let realFetch;
test.before(() => { realFetch = globalThis.fetch; });
test.afterEach(() => { globalThis.fetch = realFetch; });

test("normalizeIndustry lowercases and underscores", () => {
  assert.equal(normalizeIndustry("Oil & Gas"), "oil_gas");
  assert.equal(normalizeIndustry("HVAC / Water Treatment"), "hvac_water_treatment");
  assert.equal(normalizeIndustry("  Military / Government "), "military_government");
  assert.equal(normalizeIndustry(""), "");
});

test("listIdForIndustry maps, falls back to NURTURE, or null", () => {
  assert.equal(listIdForIndustry(ENV, "Oil & Gas"), "LIST_OIL");
  assert.equal(listIdForIndustry(ENV, "HVAC / Water Treatment"), "LIST_HVAC");
  assert.equal(listIdForIndustry(ENV, "Other"), "LIST_FALLBACK");   // unmapped -> fallback
  assert.equal(listIdForIndustry(ENV, ""), "LIST_FALLBACK");        // empty -> fallback
  assert.equal(listIdForIndustry({}, "Oil & Gas"), null);          // nothing configured
});

test("klaviyoSubscribe skips without key/list and never throws", async () => {
  const calls = stubFetch(202);
  assert.deepEqual(await klaviyoSubscribe({}, "a@b.co", "L1"), { ok: false, skipped: true });
  assert.deepEqual(await klaviyoSubscribe(ENV, "a@b.co", ""), { ok: false, skipped: true });
  assert.deepEqual(await klaviyoSubscribe(ENV, "bad-email", "L1"), { ok: false, skipped: true });
  assert.equal(calls.length, 0, "no network call when skipped");
});

test("klaviyoSubscribe posts and reports 202 success / non-202 failure", async () => {
  const ok = stubFetch(202);
  const r1 = await klaviyoSubscribe(ENV, "a@b.co", "L1");
  assert.deepEqual(r1, { ok: true, status: 202 });
  assert.equal(ok.length, 1);
  assert.match(ok[0].url, /profile-subscription-bulk-create-jobs/);
  assert.match(ok[0].opts.body, /"id":"L1"/);
  assert.match(ok[0].opts.headers.Authorization, /Klaviyo-API-Key pk_test/);

  stubFetch(400);
  const r2 = await klaviyoSubscribe(ENV, "a@b.co", "L1");
  assert.deepEqual(r2, { ok: false, status: 400 });
});

test("subscribeLeadByIndustry resolves the list and subscribes", async () => {
  const calls = stubFetch(202);
  const r = await subscribeLeadByIndustry(ENV, { email: "a@b.co", industry: "Oil & Gas" });
  assert.equal(r.ok, true);
  assert.equal(r.listId, "LIST_OIL");
  assert.match(calls[0].opts.body, /"id":"LIST_OIL"/);
});

test("subscribeLeadByIndustry skips when no list resolves", async () => {
  const calls = stubFetch(202);
  const r = await subscribeLeadByIndustry({}, { email: "a@b.co", industry: "Oil & Gas" });
  assert.deepEqual(r, { ok: false, skipped: true });
  assert.equal(calls.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/klaviyo-helper.test.mjs`
Expected: FAIL — `Cannot find module '.../functions/_lib/klaviyo.js'`.

- [ ] **Step 3: Write the implementation**

Create `functions/_lib/klaviyo.js`:

```js
// Shared Klaviyo client — single place for the subscription-bulk-create-jobs POST and the
// industry -> nurture-list resolution. Used by newsletter.js (general list) and quote.js
// (per-industry lead nurture). Best-effort: missing config is a no-op, never a throw.
const REVISION = '2024-10-15';

// Normalized industry label (from the quote form) -> env var holding that list's ID.
const INDUSTRY_LIST_ENV = {
  oil_gas: 'KLAVIYO_LIST_OIL_GAS',
  marine: 'KLAVIYO_LIST_MARINE',
  manufacturing: 'KLAVIYO_LIST_MANUFACTURING',
  food_beverage: 'KLAVIYO_LIST_FOOD_BEVERAGE',
  healthcare: 'KLAVIYO_LIST_HEALTHCARE',
  construction: 'KLAVIYO_LIST_CONSTRUCTION',
  military_government: 'KLAVIYO_LIST_MILITARY_GOV',
  education: 'KLAVIYO_LIST_EDUCATION',
  hvac_water_treatment: 'KLAVIYO_LIST_HVAC_WATER',
  plumbing: 'KLAVIYO_LIST_PLUMBING',
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeIndustry(industry) {
  return String(industry || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Resolve a Klaviyo list ID for an industry: mapped env id, else the NURTURE fallback,
// else null (nothing configured).
export function listIdForIndustry(env, industry) {
  const key = INDUSTRY_LIST_ENV[normalizeIndustry(industry)];
  const mapped = key ? env[key] : null;
  return mapped || env.KLAVIYO_LIST_NURTURE || null;
}

// Subscribe one email to a Klaviyo list. Best-effort: skips (no throw) when the private
// key, list, or a valid email is missing. Returns { ok, skipped?, status? }.
export async function klaviyoSubscribe(env, email, listId) {
  const key = env.KLAVIYO_PRIVATE_KEY;
  if (!key || !listId || !EMAIL_RE.test(String(email || ''))) {
    return { ok: false, skipped: true };
  }
  const payload = {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: {
          data: [{
            type: 'profile',
            attributes: { email, subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } } },
          }],
        },
      },
      relationships: { list: { data: { type: 'list', id: listId } } },
    },
  };
  const resp = await globalThis.fetch('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/', {
    method: 'POST',
    headers: {
      Authorization: `Klaviyo-API-Key ${key}`,
      revision: REVISION,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return { ok: resp.status === 202, status: resp.status };
}

// Subscribe a quote lead to its industry nurture list. Best-effort.
export async function subscribeLeadByIndustry(env, { email, industry } = {}) {
  const listId = listIdForIndustry(env, industry);
  if (!listId) return { ok: false, skipped: true };
  const r = await klaviyoSubscribe(env, email, listId);
  return { ...r, listId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/klaviyo-helper.test.mjs`
Expected: PASS — 6 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/klaviyo.js tests/klaviyo-helper.test.mjs
git commit -m "feat(klaviyo): shared subscribe helper + industry list resolver"
```

---

## Task 2: Refactor newsletter.js onto the helper

**Files:**
- Modify: `functions/api/newsletter.js`
- Test: `tests/klaviyo-nurture.test.mjs` (newsletter section)

- [ ] **Step 1: Write the failing test**

Create `tests/klaviyo-nurture.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("newsletter.js subscribes via the shared helper, not an inline job payload", () => {
  const src = read("functions/api/newsletter.js");
  assert.match(src, /from\s+['"]\.\.\/_lib\/klaviyo\.js['"]/, "must import ../_lib/klaviyo.js");
  assert.match(src, /klaviyoSubscribe\(/, "must call klaviyoSubscribe");
  assert.doesNotMatch(src, /profile-subscription-bulk-create-job/, "inline bulk-job payload should move into the helper");
  // contract preserved
  assert.match(src, /newsletter_not_configured/);
  assert.match(src, /klaviyo_error/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/klaviyo-nurture.test.mjs`
Expected: FAIL — newsletter.js still inlines `profile-subscription-bulk-create-job` and lacks `klaviyoSubscribe`.

- [ ] **Step 3: Write the implementation**

Edit `functions/api/newsletter.js`.

(3a) Replace the imports + `REVISION` const block at the top. Change:

```js
import { json, readBody } from '../_lib/supabase.js';
import { rateLimit, clientIp } from '../_lib/ratelimit.js';

const REVISION = '2024-10-15';
```

to:

```js
import { json, readBody } from '../_lib/supabase.js';
import { rateLimit, clientIp } from '../_lib/ratelimit.js';
import { klaviyoSubscribe } from '../_lib/klaviyo.js';
```

(3b) Replace everything from `const key = env.KLAVIYO_PRIVATE_KEY;` through the final
`return json(200, { ok: true });` (the inline payload + fetch + 202 check) with:

```js
  const r = await klaviyoSubscribe(env, email, env.KLAVIYO_LIST_ID);
  if (r.skipped) return json(500, { error: 'newsletter_not_configured' });
  if (!r.ok) return json(502, { error: 'klaviyo_error', status: r.status });
  return json(200, { ok: true });
}
```

(Leave the honeypot, rate-limit, and email-validation lines above untouched.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/klaviyo-nurture.test.mjs`
Expected: PASS (1 test). Then:
Run: `node --test tests/functions-import-resolve.test.mjs`
Expected: PASS — `../_lib/klaviyo.js` resolves from newsletter.js.

- [ ] **Step 5: Commit**

```bash
git add functions/api/newsletter.js tests/klaviyo-nurture.test.mjs
git commit -m "refactor(newsletter): use shared klaviyoSubscribe helper"
```

---

## Task 3: Fire industry nurture subscribe from quote.js

**Files:**
- Modify: `functions/api/quote.js` (import line ~5; after autoreply send, before final return)
- Test: `tests/klaviyo-nurture.test.mjs` (quote section)

- [ ] **Step 1: Add the failing test**

Append to `tests/klaviyo-nurture.test.mjs`:

```js
test("quote.js fires industry nurture subscribe after its emails, before returning", () => {
  const src = read("functions/api/quote.js");
  assert.match(src, /from\s+['"]\.\.\/_lib\/klaviyo\.js['"]/, "quote.js must import ../_lib/klaviyo.js");
  assert.match(src, /subscribeLeadByIndustry\(env/, "quote.js must call subscribeLeadByIndustry");
  const callIdx = src.indexOf("subscribeLeadByIndustry(env");
  const returnIdx = src.lastIndexOf("return json(200");
  const lastEmailIdx = src.lastIndexOf("sendEmail(env");
  assert.ok(callIdx > -1 && returnIdx > -1 && lastEmailIdx > -1, "anchors present");
  assert.ok(lastEmailIdx < callIdx && callIdx < returnIdx, "subscribe runs after emails and before the response");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/klaviyo-nurture.test.mjs`
Expected: FAIL on the quote test — `subscribeLeadByIndustry` not in quote.js yet.

- [ ] **Step 3: Write the implementation**

Edit `functions/api/quote.js`.

(3a) Add the import after the existing `_lib` imports (line ~5):

```js
import { subscribeLeadByIndustry } from '../_lib/klaviyo.js';
```

(3b) Insert the best-effort nurture call immediately before the final
`return json(200, { ok: true, saved });`. Change:

```js
  return json(200, { ok: true, saved });
}
```

to:

```js
  // Lead nurture (best-effort): subscribe to the industry's Klaviyo list. Never blocks the quote.
  try { await subscribeLeadByIndustry(env, { email, industry: fields.industry }); } catch { /* nurture is best-effort */ }

  return json(200, { ok: true, saved });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/klaviyo-nurture.test.mjs`
Expected: PASS (2 tests). Then:
Run: `node --test tests/functions-import-resolve.test.mjs`
Expected: PASS — `../_lib/klaviyo.js` resolves from quote.js.

- [ ] **Step 5: Commit**

```bash
git add functions/api/quote.js tests/klaviyo-nurture.test.mjs
git commit -m "feat(klaviyo): subscribe quote leads to their industry nurture list"
```

---

## Task 4: Newsletter landing page

**Files:**
- Create: `newsletter.html`
- Modify: `sitemap.xml`
- Test: `tests/klaviyo-nurture.test.mjs` (newsletter.html section)

- [ ] **Step 1: Add the failing test**

Append to `tests/klaviyo-nurture.test.mjs`:

```js
test("newsletter.html is a real signup page wired to subscribeNewsletter", () => {
  const html = read("newsletter.html");
  assert.match(html, /<input[^>]*type="email"/, "must have an email input");
  assert.match(html, /subscribeNewsletter\(/, "must call window.MASEST.subscribeNewsletter");
  assert.match(html, /js\/main\.js/, "must boot the shared chrome bundle");
  assert.match(html, /name="company"/, "must include the honeypot field the function checks");
  assert.match(html, /canonical[^>]*newsletter\.html/, "must set its canonical URL");
});

test("sitemap lists the newsletter page", () => {
  assert.match(read("sitemap.xml"), /newsletter\.html/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/klaviyo-nurture.test.mjs`
Expected: FAIL — `newsletter.html` does not exist (ENOENT) / sitemap lacks it.

- [ ] **Step 3: Write the implementation**

Create `newsletter.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Newsletter | MASEST VertKleen</title>
<meta name="description" content="Get VertKleen field results, safety chemistry guidance, and industry-specific cleaning insights from MASEST — straight to your inbox.">
<meta name="theme-color" content="#fafbfc">
<link rel="icon" type="image/png" href="img/favicon-enhanced.png?v=20260617c">
<link rel="stylesheet" href="vendor/phosphor/style.css">
<link rel="stylesheet" href="css/style.css">
<link rel="stylesheet" href="css/components.css">
<link rel="canonical" href="https://masest.co/newsletter.html">
<meta property="og:title" content="Newsletter | MASEST VertKleen">
<meta property="og:description" content="VertKleen field results and safety chemistry guidance in your inbox.">
<meta property="og:url" content="https://masest.co/newsletter.html">
<meta property="og:image" content="https://masest.co/img/og-card.png">
<meta name="twitter:card" content="summary_large_image">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<noscript>
  <nav class="nojs-nav" aria-label="Site">
  <a href="index.html"><b>MASEST</b></a>
  <a href="products.html">Products</a>
  <a href="industries.html">Industries</a>
  <a href="proof.html">Field Results</a>
  <a href="resources.html">Resources</a>
</nav>
</noscript>

<main id="main">
  <section class="hero-split">
    <div class="wrap">
      <h1 class="display">Cleaner intel, in your inbox.</h1>
      <p class="subhead">VertKleen field results, HMIS 0-0-0 safety guidance, and industry-specific cleaning insights. No spam — unsubscribe anytime.</p>
      <form id="newsletterForm" class="newsletter-form" novalidate>
        <label for="nlEmail" class="visually-hidden">Email address</label>
        <input id="nlEmail" name="email" type="email" required placeholder="you@company.com" autocomplete="email">
        <input type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px" hidden>
        <button type="submit" class="btn btn-primary">Subscribe</button>
        <p id="nlMsg" class="form-msg" role="status" aria-live="polite"></p>
      </form>
    </div>
  </section>
</main>

<script type="module" src="js/main.js"></script>
<script src="js/track.js" defer></script>
<script type="module">
  const form = document.getElementById('newsletterForm');
  const msg = document.getElementById('nlMsg');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.company.value) return; // honeypot
    const email = form.email.value.trim();
    msg.textContent = 'Subscribing…';
    try {
      if (!window.MASEST?.subscribeNewsletter) throw new Error('unavailable');
      await window.MASEST.subscribeNewsletter(email);
      msg.textContent = 'You’re in. Check your inbox to confirm.';
      form.reset();
    } catch (err) {
      msg.textContent = err?.message === 'invalid_email'
        ? 'Enter a valid email address.'
        : 'Could not subscribe right now. Try again shortly.';
    }
  });
</script>
</body>
</html>
```

Edit `sitemap.xml`: add a `<url>` entry alongside the others (match the existing entry shape — copy a sibling `<url>` block and change the path):

```xml
  <url><loc>https://masest.co/newsletter.html</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/klaviyo-nurture.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add newsletter.html sitemap.xml tests/klaviyo-nurture.test.mjs
git commit -m "feat(newsletter): standalone signup landing page"
```

---

## Task 5: Document new env keys

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Edit `.env.example`**

Under the existing `# --- Klaviyo marketing email (Phase 4) ---` block (after the
`KLAVIYO_LIST_ID=` line), add:

```bash
# Per-industry nurture lists — each maps to a Klaviyo list with a list-triggered 3-email flow.
# Quote leads are subscribed to the list matching their industry; unmapped/empty -> KLAVIYO_LIST_NURTURE.
KLAVIYO_LIST_OIL_GAS=
KLAVIYO_LIST_MARINE=
KLAVIYO_LIST_MANUFACTURING=
KLAVIYO_LIST_FOOD_BEVERAGE=
KLAVIYO_LIST_HEALTHCARE=
KLAVIYO_LIST_CONSTRUCTION=
KLAVIYO_LIST_MILITARY_GOV=
KLAVIYO_LIST_EDUCATION=
KLAVIYO_LIST_HVAC_WATER=
KLAVIYO_LIST_PLUMBING=
KLAVIYO_LIST_NURTURE=               # fallback list for Other / unspecified industry
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(env): document per-industry Klaviyo nurture list keys"
```

---

## Task 6: Full verify + integrate to main

**Files:** none (verification + git).

- [ ] **Step 1: Full suite green**

Run: `node --test tests/*.test.mjs`
Expected: all pass, 0 fail (prior + new klaviyo tests).

- [ ] **Step 2: Import-resolve gate**

Run: `node --test tests/functions-import-resolve.test.mjs`
Expected: PASS — confirms `_lib/klaviyo.js` resolves from both quote.js and newsletter.js.

- [ ] **Step 3: Rebase onto latest origin/main (Codex races quote.js)**

```bash
git fetch origin
git rebase origin/main
```
If Codex pushed lead-scoring into quote.js, the rebase replays the 2-line nurture
addition. Resolve any quote.js conflict by keeping BOTH (scoring + the nurture call
before the final return). Then re-run Step 1–2.

- [ ] **Step 4: Re-run both gates after rebase**

Run: `node --test tests/*.test.mjs && node --test tests/functions-import-resolve.test.mjs`
Expected: all pass.

- [ ] **Step 5: Push to main**

```bash
git push origin HEAD:main
```
Confirm the Cloudflare Pages deploy serves the new commit: `curl -sSL https://masest.co/newsletter.html | grep -c subscribeNewsletter` should be ≥1 (use `-sSL` — `.html` paths 308-redirect to clean URLs; the redirect body is empty and fools grep).

---

## Self-Review notes

- **Spec coverage:** per-industry list resolution + fallback (Task 1), quote hook best-effort (Task 3), newsletter DRY refactor preserving contract (Task 2), landing page (Task 4), env docs (Task 5), import-resolve gate (Tasks 2/3/6), live verify with `-sSL` (Task 6). Consent flagged in spec as owner decision (no code gate). All covered.
- **Type consistency:** helper returns `{ ok, skipped?, status? }`; `subscribeLeadByIndustry` adds `listId`; `newsletter.js` maps `skipped`→500, `!ok`→502, else 200. Function names identical across tasks (`klaviyoSubscribe`, `subscribeLeadByIndustry`, `listIdForIndustry`, `normalizeIndustry`).
- **Import depth:** quote.js + newsletter.js both `../_lib/klaviyo.js` (api/X.js) — asserted + import-resolve gated.
