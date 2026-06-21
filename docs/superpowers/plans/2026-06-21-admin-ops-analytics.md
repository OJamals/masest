# Admin Ops Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin-first operations dashboard upgrade: richer admin overview metrics, priority action rail, and deeper first-party analytics reporting.

**Architecture:** Extend the existing Cloudflare Pages Functions endpoints rather than adding a new service. Keep `admin.html` as the shell, render data through `js/admin.js`, and preserve current staff auth and graceful pre-migration behavior.

**Tech Stack:** Static HTML/CSS/ES modules, Cloudflare Pages Functions, Supabase service-role client, Node built-in test runner.

---

## File Structure

- Modify `functions/api/admin/stats.js`: add commerce/CRM/account/catalog/action aggregate fields while preserving old keys.
- Modify `functions/api/admin/traffic.js`: add event, funnel, campaign, and richer day aggregates.
- Modify `js/admin.js`: render the new overview action rail and expanded analytics report.
- Modify `css/style.css`: add small admin report/table/rail styles using existing tokens.
- Add `tests/admin-ops-analytics.test.mjs`: source-contract tests for endpoint payloads and UI hooks.

## Task 1: Stats Endpoint Payload

**Files:**
- Create: `tests/admin-ops-analytics.test.mjs`
- Modify: `functions/api/admin/stats.js`

- [ ] **Step 1: Write failing tests**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("admin stats exposes operations grouped metrics and action list", () => {
  const src = read("functions/api/admin/stats.js");
  assert.match(src, /commerce\s*:/, "stats payload should expose commerce group");
  assert.match(src, /crm\s*:/, "stats payload should expose CRM group");
  assert.match(src, /accounts\s*:/, "stats payload should expose accounts group");
  assert.match(src, /catalog_health\s*:/, "stats payload should expose catalog health group");
  assert.match(src, /analytics\s*:/, "stats payload should expose analytics group");
  assert.match(src, /actions\s*:/, "stats payload should expose prioritized actions");
  assert.match(src, /average_order_value/, "commerce group should include AOV");
  assert.match(src, /fulfillment_queue/, "commerce group should include fulfillment queue");
  assert.match(src, /net_exposure/, "commerce group should include NET exposure");
});
```

- [ ] **Step 2: Verify red**

Run: `node --test tests/admin-ops-analytics.test.mjs`

Expected: FAIL mentioning missing `commerce`/`actions` payload strings.

- [ ] **Step 3: Implement stats groups**

Add helpers in `functions/api/admin/stats.js`:

```js
const sumTotals = (orders) => orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
const withinDays = (iso, days) => iso && new Date(iso).getTime() >= Date.now() - days * 86400e3;
const countStatus = (orders, statuses) => orders.filter((order) => statuses.includes(order.status)).length;
```

Build `commerce`, `crm`, `accounts`, `catalog_health`, `analytics`, and `actions` before the final `json(200, ...)`, then include them alongside existing legacy keys.

- [ ] **Step 4: Verify green**

Run: `node --test tests/admin-ops-analytics.test.mjs`

Expected: PASS.

## Task 2: Traffic Endpoint Analytics

**Files:**
- Modify: `tests/admin-ops-analytics.test.mjs`
- Modify: `functions/api/admin/traffic.js`

- [ ] **Step 1: Add failing tests**

```js
test("admin traffic aggregates funnel events campaigns and daily conversion rows", () => {
  const src = read("functions/api/admin/traffic.js");
  assert.match(src, /eventCounts/, "traffic should count event names");
  assert.match(src, /funnel/, "traffic payload should include funnel");
  assert.match(src, /topCampaigns/, "traffic payload should include UTM campaign groups");
  assert.match(src, /utm_source/, "traffic query should select UTM source");
  assert.match(src, /utm_medium/, "traffic query should select UTM medium");
  assert.match(src, /utm_campaign/, "traffic query should select UTM campaign");
  assert.match(src, /conversion_events/, "daily rows should include conversion event count");
});
```

- [ ] **Step 2: Verify red**

Run: `node --test tests/admin-ops-analytics.test.mjs`

Expected: FAIL mentioning missing `eventCounts` or `topCampaigns`.

- [ ] **Step 3: Implement analytics aggregates**

Update the query to select `event,utm_source,utm_medium,utm_campaign`. Add `eventCounts`, `funnel`, `topCampaigns`, and `conversion_events` in `byDay`. Preserve the `available:false` catch response and add empty arrays for new keys there.

- [ ] **Step 4: Verify green**

Run: `node --test tests/admin-ops-analytics.test.mjs`

Expected: PASS.

## Task 3: Admin Overview UI

**Files:**
- Modify: `tests/admin-ops-analytics.test.mjs`
- Modify: `admin.html`
- Modify: `js/admin.js`
- Modify: `css/style.css`

- [ ] **Step 1: Add failing UI tests**

```js
test("admin overview renders operations summary and action rail", () => {
  const html = read("admin.html");
  const js = read("js/admin.js");
  assert.match(html, /admActionRail/, "overview shell should include action rail");
  assert.match(html, /admOpsSummary/, "overview shell should include operations summary");
  assert.match(js, /renderActionRail/, "admin JS should render priority actions");
  assert.match(js, /renderOpsSummary/, "admin JS should render grouped operations summary");
});
```

- [ ] **Step 2: Verify red**

Run: `node --test tests/admin-ops-analytics.test.mjs`

Expected: FAIL mentioning missing `admActionRail`.

- [ ] **Step 3: Add overview shell and renderers**

Add two containers to the overview section in `admin.html`:

```html
<div id="admOpsSummary" class="adm-ops-summary" aria-live="polite"></div>
<div id="admActionRail" class="adm-action-rail" aria-live="polite"></div>
```

Add `renderOpsSummary(stats)` and `renderActionRail(stats.actions || [])` in `js/admin.js`, then call both from `renderStats(stats)`.

- [ ] **Step 4: Verify green**

Run: `node --test tests/admin-ops-analytics.test.mjs`

Expected: PASS.

## Task 4: Admin Analytics UI

**Files:**
- Modify: `tests/admin-ops-analytics.test.mjs`
- Modify: `js/admin.js`
- Modify: `css/style.css`

- [ ] **Step 1: Add failing UI tests**

```js
test("admin traffic page renders funnel campaigns and daily report", () => {
  const js = read("js/admin.js");
  assert.match(js, /renderTrafficFunnel/, "traffic page should render funnel");
  assert.match(js, /renderTrafficCampaigns/, "traffic page should render campaigns");
  assert.match(js, /renderTrafficDays/, "traffic page should render daily rows");
  assert.match(js, /topCampaigns/, "traffic renderer should use topCampaigns payload");
  assert.match(js, /conversion_events/, "traffic renderer should show daily conversion events");
});
```

- [ ] **Step 2: Verify red**

Run: `node --test tests/admin-ops-analytics.test.mjs`

Expected: FAIL mentioning missing `renderTrafficFunnel`.

- [ ] **Step 3: Implement traffic renderers**

Replace the current simple `renderTraffic()` body with a report that renders KPI row, funnel rows, campaigns, top paths/referrers/browsers, and day rows. Escape every dynamic value with `esc`.

- [ ] **Step 4: Verify green**

Run: `node --test tests/admin-ops-analytics.test.mjs`

Expected: PASS.

## Task 5: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused test**

Run: `node --test tests/admin-ops-analytics.test.mjs`

Expected: PASS.

- [ ] **Step 2: Run repo gate**

Run: `npm run verify`

Expected: exits 0.

- [ ] **Step 3: Rendered admin smoke**

Run the existing admin Playwright smoke if local browser dependencies are available:

```bash
npm run smoke:admin
```

Expected: exits 0, or record the exact missing-browser/dependency blocker.

## Self-Review

- Spec coverage: endpoint aggregates, overview UI, analytics UI, and migration fallback are represented.
- Placeholder scan: no `TBD`, no open implementation placeholders.
- Type consistency: payload keys match the design spec and planned UI names.
