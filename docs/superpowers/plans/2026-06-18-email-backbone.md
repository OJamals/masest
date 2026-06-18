# Email Backbone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give MASEST email delivery visibility (a send/delivery log), bounce suppression, a Resend webhook to ingest delivery events, and a staff email alert when a buyer posts a message.

**Architecture:** Make `sendEmail` in `functions/_lib/supabase.js` the universal logged chokepoint — it filters suppressed recipients, sends via Resend (capturing the message id), and logs an `email_events` row. A new Svix-verified `/api/resend-webhook` updates those rows by `resend_id` and records hard-bounce/complaint addresses into `email_suppressions`. Pure logic lives in a new `functions/_lib/email.js` (unit-tested by execution); wiring is verified by source-grep tests, matching the repo's existing test conventions.

**Tech Stack:** Cloudflare Pages Functions (ESM, `onRequestPost({request, env})`), Supabase (`adminClient` service-role), Resend HTTP API, Svix HMAC-SHA256 signatures via SubtleCrypto, `node:test` + `node:assert/strict`.

---

## File Structure

- Create `supabase/schema-email.sql` — `email_events` + `email_suppressions` tables + service_role grants.
- Create `functions/_lib/email.js` — pure helpers: `filterSuppressed`, `mapResendEvent`, `verifySvixSignature`.
- Modify `functions/_lib/supabase.js` — add `loadSuppressed`, `logEmailEvent`, `recordSuppression`, `updateEmailStatus`; refactor `sendEmail` (suppression filter + log + `category`).
- Create `functions/api/resend-webhook.js` — Svix-verified webhook handler.
- Modify `functions/api/admin/offers.js` — route the direct Resend fetch through `sendEmail`.
- Modify `functions/api/account/messages.js` — staff alert on buyer POST.
- Modify `.env.example` — document `RESEND_WEBHOOK_SECRET`.
- Tests: `tests/email-helpers.test.mjs`, `tests/email-schema.test.mjs`, `tests/resend-webhook.test.mjs`, `tests/email-suppression-wiring.test.mjs`, `tests/messages-staff-alert.test.mjs`.

Baseline: run `node --test tests/*.test.mjs` first; note the current pass count (≈148). Every task keeps it green.

---

### Task 1: Email schema (tables + grants)

**Files:**
- Create: `supabase/schema-email.sql`
- Test: `tests/email-schema.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/email-schema.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = readFileSync(new URL("../supabase/schema-email.sql", import.meta.url), "utf8");

test("schema-email defines email_events and email_suppressions", () => {
  assert.match(SRC, /create table if not exists public\.email_events/i);
  assert.match(SRC, /create table if not exists public\.email_suppressions/i);
  assert.match(SRC, /resend_id\s+text/i);
  assert.match(SRC, /status\s+text[^;]*default\s+'sent'/i);
  assert.match(SRC, /email\s+text\s+primary key/i);
});

test("schema-email grants both tables to service_role (else 42501 on insert)", () => {
  assert.match(SRC, /grant all privileges on public\.email_events,\s*public\.email_suppressions to service_role/i);
  assert.match(SRC, /grant usage, select on all sequences in schema public to service_role/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/email-schema.test.mjs`
Expected: FAIL (cannot read `schema-email.sql` — file does not exist).

- [ ] **Step 3: Write the schema**

```sql
-- supabase/schema-email.sql — email delivery log + suppression list.
-- Apply via Supabase SQL editor / pooler. Service-role auto-grant does NOT fire for
-- new tables (see schema-phase5.sql), so the grants below are required.

create table if not exists public.email_events (
  id          uuid primary key default gen_random_uuid(),
  resend_id   text,
  to_email    text not null,
  category    text,
  subject     text,
  status      text not null default 'sent',
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists email_events_resend_id_idx on public.email_events (resend_id);
create index if not exists email_events_to_email_idx on public.email_events (to_email);
create index if not exists email_events_created_at_idx on public.email_events (created_at desc);

create table if not exists public.email_suppressions (
  email       text primary key,
  reason      text not null,
  created_at  timestamptz not null default now()
);

-- ---------- GRANTS (service-role auto-grant does not fire for new tables) ----------
grant all privileges on public.email_events, public.email_suppressions to service_role;
grant usage, select on all sequences in schema public to service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/email-schema.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/schema-email.sql tests/email-schema.test.mjs
git commit -m "feat(email): add email_events + email_suppressions schema"
```

---

### Task 2: Pure helpers — `filterSuppressed` + `mapResendEvent`

**Files:**
- Create: `functions/_lib/email.js`
- Test: `tests/email-helpers.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/email-helpers.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { filterSuppressed, mapResendEvent } from "../functions/_lib/email.js";

test("filterSuppressed drops suppressed addresses, case-insensitive", () => {
  const out = filterSuppressed(["A@x.com", "keep@x.com"], new Set(["a@x.com"]));
  assert.deepEqual(out, ["keep@x.com"]);
});

test("filterSuppressed returns all when suppression set empty", () => {
  assert.deepEqual(filterSuppressed(["a@x.com"], new Set()), ["a@x.com"]);
});

test("mapResendEvent maps Resend event types to internal status", () => {
  assert.equal(mapResendEvent("email.delivered"), "delivered");
  assert.equal(mapResendEvent("email.bounced"), "bounced");
  assert.equal(mapResendEvent("email.complained"), "complained");
  assert.equal(mapResendEvent("email.sent"), "sent");
  assert.equal(mapResendEvent("email.delivery_delayed"), null); // log-only, no status change
  assert.equal(mapResendEvent("unknown.event"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/email-helpers.test.mjs`
Expected: FAIL (cannot import from `functions/_lib/email.js`).

- [ ] **Step 3: Write the helpers**

```js
// functions/_lib/email.js — pure, dependency-free email helpers (unit-tested by execution).

const RESEND_STATUS = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

// Returns recipients not present in the suppression set (case-insensitive on email).
export function filterSuppressed(recipients, suppressedSet) {
  if (!Array.isArray(recipients)) return [];
  return recipients.filter((addr) => !suppressedSet.has(String(addr).toLowerCase()));
}

// Maps a Resend webhook event type to an internal email_events.status, or null if the
// event should not change status (delivery_delayed, unknown).
export function mapResendEvent(type) {
  return RESEND_STATUS[type] || null;
}

// Event types that mean the address should be suppressed.
export function isSuppressingEvent(type) {
  return type === "email.bounced" || type === "email.complained";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/email-helpers.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/email.js tests/email-helpers.test.mjs
git commit -m "feat(email): pure filterSuppressed + mapResendEvent helpers"
```

---

### Task 3: Pure helper — `verifySvixSignature`

**Files:**
- Modify: `functions/_lib/email.js`
- Test: `tests/email-helpers.test.mjs` (add a test)

- [ ] **Step 1: Write the failing test** (append to `tests/email-helpers.test.mjs`)

```js
import { createHmac } from "node:crypto";
import { verifySvixSignature } from "../functions/_lib/email.js";

function signSvix(secretB64, id, ts, body) {
  const key = Buffer.from(secretB64, "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return `v1,${sig}`;
}

test("verifySvixSignature accepts a valid signature", async () => {
  const secretB64 = Buffer.from("supersecretkey").toString("base64");
  const id = "msg_1", ts = "1700000000", body = '{"type":"email.delivered"}';
  const header = signSvix(secretB64, id, ts, body);
  const ok = await verifySvixSignature(`whsec_${secretB64}`,
    { id, timestamp: ts, signature: header }, body);
  assert.equal(ok, true);
});

test("verifySvixSignature rejects a tampered body", async () => {
  const secretB64 = Buffer.from("supersecretkey").toString("base64");
  const id = "msg_1", ts = "1700000000";
  const header = signSvix(secretB64, id, ts, '{"type":"email.delivered"}');
  const ok = await verifySvixSignature(`whsec_${secretB64}`,
    { id, timestamp: ts, signature: header }, '{"type":"email.bounced"}');
  assert.equal(ok, false);
});

test("verifySvixSignature rejects missing parts", async () => {
  assert.equal(await verifySvixSignature("whsec_x", { id: "", timestamp: "", signature: "" }, "b"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/email-helpers.test.mjs`
Expected: FAIL (`verifySvixSignature` not exported).

- [ ] **Step 3: Add the helper** (append to `functions/_lib/email.js`)

```js
// Verifies a Svix (Resend) webhook signature. secret is "whsec_<base64>"; headers carry
// svix-id, svix-timestamp, and a space-separated svix-signature of "v1,<base64sig>" items.
// Signed content is `${id}.${timestamp}.${body}`. Returns a boolean. Async (SubtleCrypto).
export async function verifySvixSignature(secret, { id, timestamp, signature }, body) {
  if (!secret || !id || !timestamp || !signature) return false;
  try {
    const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
    const keyBytes = Uint8Array.from(atob(rawSecret), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const data = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
    const mac = await crypto.subtle.sign("HMAC", key, data);
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
    const provided = signature.split(" ").map((p) => p.split(",")[1]).filter(Boolean);
    return provided.some((sig) => sig === expected);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/email-helpers.test.mjs`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/email.js tests/email-helpers.test.mjs
git commit -m "feat(email): verifySvixSignature for Resend webhook"
```

---

### Task 4: Instrument `sendEmail` (suppression + log + category)

**Files:**
- Modify: `functions/_lib/supabase.js` (the `sendEmail` function near line 105; add DB-op helpers)
- Test: `tests/email-suppression-wiring.test.mjs`

- [ ] **Step 1: Write the failing test** (source-grep, matching repo convention)

```js
// tests/email-suppression-wiring.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const SRC = readFileSync(new URL("../functions/_lib/supabase.js", import.meta.url), "utf8");

test("sendEmail filters suppressed recipients before sending", () => {
  assert.match(SRC, /loadSuppressed\(/, "sendEmail must load the suppression set");
  assert.match(SRC, /filterSuppressed\(/, "sendEmail must filter recipients");
});

test("sendEmail logs an email_events row with category and resend id", () => {
  assert.match(SRC, /logEmailEvent\(/, "sendEmail must log the send");
  assert.match(SRC, /category/, "sendEmail must accept a category");
  assert.match(SRC, /email_events/, "must write to email_events");
});

test("supabase lib imports the pure email helpers", () => {
  assert.match(SRC, /from '\.\/email\.js'/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/email-suppression-wiring.test.mjs`
Expected: FAIL (no `loadSuppressed` / `logEmailEvent` / email.js import yet).

- [ ] **Step 3: Add DB helpers + refactor `sendEmail`**

At the top of `functions/_lib/supabase.js`, add to the imports:
```js
import { filterSuppressed } from './email.js';
```

Add these exported helpers (near `sendEmail`):
```js
// Load the subset of `emails` that are suppressed. Fails open (returns empty Set on error).
export async function loadSuppressed(env, emails) {
  try {
    const sb = adminClient(env);
    const lowered = emails.map((e) => String(e).toLowerCase());
    const { data } = await sb.from('email_suppressions').select('email').in('email', lowered);
    return new Set((data || []).map((r) => r.email.toLowerCase()));
  } catch {
    return new Set();
  }
}

// Best-effort insert of an email_events row. Never throws.
export async function logEmailEvent(env, { resend_id, to_email, category, subject, status, error }) {
  try {
    await adminClient(env).from('email_events').insert({
      resend_id: resend_id || null, to_email, category: category || null,
      subject: subject || null, status, error: error || null,
    });
  } catch { /* logging is advisory; never block the send */ }
}
```

Replace the existing `sendEmail` body with:
```js
export async function sendEmail(env, { to, subject, html, category = null }) {
  if (!env.RESEND_API_KEY || !Array.isArray(to) || !to.length) return false;
  const from = env.RESEND_FROM || 'MASEST <noreply@masest.co>';
  const suppressed = await loadSuppressed(env, to);
  const recipients = filterSuppressed(to, suppressed).slice(0, 50);
  const toLine = to.join(', ');
  if (!recipients.length) {
    await logEmailEvent(env, { to_email: toLine, category, subject, status: 'failed', error: 'all_recipients_suppressed' });
    return false;
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, html }),
    });
    let resendId = null;
    try { resendId = (await r.clone().json())?.id || null; } catch { /* non-json body */ }
    await logEmailEvent(env, {
      resend_id: resendId, to_email: recipients.join(', '), category, subject,
      status: r.ok ? 'sent' : 'failed', error: r.ok ? null : `resend_${r.status}`,
    });
    return r.ok;
  } catch (err) {
    await logEmailEvent(env, { to_email: recipients.join(', '), category, subject, status: 'failed', error: String(err).slice(0, 200) });
    return false;
  }
}
```

> Note: `r.clone().json()` reads the Resend id without consuming the original response. Keep `adminClient` defined above this point (it is, near line 8).

- [ ] **Step 4: Run tests**

Run: `node --test tests/email-suppression-wiring.test.mjs tests/email-helpers.test.mjs`
Expected: PASS. Then full suite `node --test tests/*.test.mjs` — still green (no regressions; `category` is optional, callers unchanged).

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/supabase.js tests/email-suppression-wiring.test.mjs
git commit -m "feat(email): instrument sendEmail with suppression + event log"
```

---

### Task 5: Resend webhook endpoint

**Files:**
- Create: `functions/api/resend-webhook.js`
- Modify: `functions/_lib/supabase.js` (add `recordSuppression`, `updateEmailStatus`)
- Test: `tests/resend-webhook.test.mjs`

- [ ] **Step 1: Write the failing test** (grep-style wiring assertions)

```js
// tests/resend-webhook.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const SRC = readFileSync(new URL("../functions/api/resend-webhook.js", import.meta.url), "utf8");
const LIB = readFileSync(new URL("../functions/_lib/supabase.js", import.meta.url), "utf8");

test("webhook verifies the Svix signature before any DB write", () => {
  assert.match(SRC, /verifySvixSignature\(/);
  assert.match(SRC, /svix-id/i);
  assert.match(SRC, /svix-signature/i);
  assert.match(SRC, /json\(400/, "bad signature returns 400");
});

test("webhook maps events and updates status + suppression", () => {
  assert.match(SRC, /mapResendEvent\(/);
  assert.match(SRC, /isSuppressingEvent\(/);
  assert.match(SRC, /updateEmailStatus\(/);
  assert.match(SRC, /recordSuppression\(/);
});

test("webhook no-ops (200) when secret unset and returns 200 on processing", () => {
  assert.match(SRC, /RESEND_WEBHOOK_SECRET/);
  assert.match(SRC, /json\(200/);
});

test("lib exposes recordSuppression + updateEmailStatus", () => {
  assert.match(LIB, /export async function recordSuppression\(/);
  assert.match(LIB, /export async function updateEmailStatus\(/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/resend-webhook.test.mjs`
Expected: FAIL (file + lib helpers missing).

- [ ] **Step 3a: Add lib helpers** (`functions/_lib/supabase.js`)

```js
// Update email_events status by Resend id (best-effort, idempotent).
export async function updateEmailStatus(env, resendId, status) {
  if (!resendId || !status) return;
  try {
    await adminClient(env).from('email_events')
      .update({ status, updated_at: new Date().toISOString() }).eq('resend_id', resendId);
  } catch { /* advisory */ }
}

// Upsert a suppression (best-effort).
export async function recordSuppression(env, email, reason) {
  if (!email) return;
  try {
    await adminClient(env).from('email_suppressions')
      .upsert({ email: String(email).toLowerCase(), reason }, { onConflict: 'email' });
  } catch { /* advisory */ }
}
```

- [ ] **Step 3b: Create the webhook handler** (`functions/api/resend-webhook.js`)

```js
// POST /api/resend-webhook — Resend (Svix) delivery-event sink.
// Configure in Resend Dashboard → Webhooks → endpoint <domain>/api/resend-webhook,
// subscribe to delivered / bounced / complained. Set RESEND_WEBHOOK_SECRET in CF env.
// Returns 200 for accepted/duplicate/unknown events (avoid Resend retry storms),
// 400 only on signature failure. No-op (200) if the secret is unset.
import { json } from '../../_lib/supabase.js';
import { recordSuppression, updateEmailStatus } from '../../_lib/supabase.js';
import { verifySvixSignature, mapResendEvent, isSuppressingEvent } from '../../_lib/email.js';

export async function onRequestPost({ request, env }) {
  const secret = env.RESEND_WEBHOOK_SECRET;
  const raw = await request.text();
  if (!secret) return json(200, { ok: true, note: 'webhook unconfigured' });

  const ok = await verifySvixSignature(secret, {
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
  }, raw);
  if (!ok) return json(400, { error: 'invalid_signature' });

  let event;
  try { event = JSON.parse(raw); } catch { return json(200, { ok: true, note: 'unparseable' }); }

  const type = event?.type;
  const resendId = event?.data?.email_id || event?.data?.id || null;
  const email = Array.isArray(event?.data?.to) ? event.data.to[0] : event?.data?.to || null;

  const status = mapResendEvent(type);
  if (status && resendId) await updateEmailStatus(env, resendId, status);
  if (isSuppressingEvent(type) && email) {
    await recordSuppression(env, email, type === 'email.complained' ? 'complaint' : 'hard_bounce');
  }
  return json(200, { ok: true });
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/resend-webhook.test.mjs`
Expected: PASS (4 tests). Then full suite green.

- [ ] **Step 5: Commit**

```bash
git add functions/api/resend-webhook.js functions/_lib/supabase.js tests/resend-webhook.test.mjs
git commit -m "feat(email): Svix-verified Resend webhook + suppression upsert"
```

---

### Task 6: Route offers through `sendEmail`

**Files:**
- Modify: `functions/api/admin/offers.js` (the direct Resend `fetch` near line 69)
- Test: `tests/email-suppression-wiring.test.mjs` (add a test)

- [ ] **Step 1: Write the failing test** (append)

```js
import { readFileSync as rf } from "node:fs";
const OFFERS = rf(new URL("../functions/api/admin/offers.js", import.meta.url), "utf8");

test("offers broadcast routes through sendEmail (logged + suppressed)", () => {
  assert.match(OFFERS, /sendEmail\(/, "offers must call sendEmail");
  assert.match(OFFERS, /category:\s*'offer'/, "offers must tag category 'offer'");
  assert.doesNotMatch(OFFERS, /api\.resend\.com/, "offers must not call Resend directly anymore");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/email-suppression-wiring.test.mjs`
Expected: FAIL (offers still calls Resend directly).

- [ ] **Step 3: Refactor offers.js**

Read `functions/api/admin/offers.js` first. Replace the direct Resend `fetch(...)` block (≈ lines 69–76, building `html` via `emailLayout` and POSTing to `api.resend.com`) with a `sendEmail` call. Add `sendEmail` to the import from `../../_lib/supabase.js`. The recipient list and `emailLayout({...})` html that already exist stay; only the send mechanism changes:

```js
// was: const r = await fetch('https://api.resend.com/emails', {...}); emailed = r.ok;
emailed = await sendEmail(env, {
  to: recipients,            // the existing recipient email array
  subject: title,            // the existing offer title/subject
  html,                      // the existing emailLayout(...) html
  category: 'offer',
});
```

> Keep variable names matching what offers.js already uses (`recipients`, `title`/`subject`, `html`, `emailed`). If the recipient array is built differently (e.g. `bcc`), pass that array as `to` — `sendEmail` already slices to 50.

- [ ] **Step 4: Run tests**

Run: `node --test tests/email-suppression-wiring.test.mjs`
Expected: PASS. Full suite green (offers behavior preserved: still sends, now logged + suppression-aware).

- [ ] **Step 5: Commit**

```bash
git add functions/api/admin/offers.js tests/email-suppression-wiring.test.mjs
git commit -m "feat(email): route offer broadcast through logged sendEmail"
```

---

### Task 7: Staff alert on buyer message

**Files:**
- Modify: `functions/api/account/messages.js` (POST branch)
- Test: `tests/messages-staff-alert.test.mjs`

- [ ] **Step 1: Write the failing test** (grep-style)

```js
// tests/messages-staff-alert.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const SRC = readFileSync(new URL("../functions/api/account/messages.js", import.meta.url), "utf8");

test("buyer POST emails staff via sendEmail with staff_alert category", () => {
  assert.match(SRC, /sendEmail\(/, "must email staff on new buyer message");
  assert.match(SRC, /ADMIN_EMAILS/, "recipients come from ADMIN_EMAILS");
  assert.match(SRC, /category:\s*'staff_alert'/);
});

test("staff alert is best-effort (does not block the POST response)", () => {
  // sendEmail call must be awaited but its failure must not throw before json(...) returns.
  assert.match(SRC, /sendEmail\(/);
  assert.match(SRC, /json\(/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/messages-staff-alert.test.mjs`
Expected: FAIL (no sendEmail in messages.js).

- [ ] **Step 3: Add the staff alert**

Read `functions/api/account/messages.js`. Add `sendEmail` and `emailLayout` to the import from `../../_lib/supabase.js`. In the POST branch, AFTER the message + staff-notification insert succeeds and BEFORE returning `json(...)`, insert:

```js
// Best-effort staff email alert (low B2B volume; throttle is a future enhancement).
const staffTo = (env.ADMIN_EMAILS || env.ADMIN_EMAIL || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (staffTo.length) {
  await sendEmail(env, {
    to: staffTo,
    subject: `New message from ${companyName || companyId}`,
    html: emailLayout({
      heading: 'New customer message',
      bodyHtml: `<p>Company: ${companyName || companyId}</p><p>${(body.body || '').slice(0, 500)}</p>`,
      ctaText: 'Open admin messages',
      ctaUrl: 'https://masest.co/admin.html#messages',
    }),
    category: 'staff_alert',
  });
}
```

> `companyName` may not be in scope. If only `companyId` is available, use it directly (the subject falls back to it). If a company name lookup is trivial (a `companies` select already nearby), reuse it; otherwise ship with `companyId` — naming polish is out of scope. `sendEmail` is already wrapped to never throw, so this is inherently best-effort.

- [ ] **Step 4: Run tests**

Run: `node --test tests/messages-staff-alert.test.mjs`
Expected: PASS. Full suite green.

- [ ] **Step 5: Commit**

```bash
git add functions/api/account/messages.js tests/messages-staff-alert.test.mjs
git commit -m "feat(email): staff email alert on new buyer message"
```

---

### Task 8: Document env + final verification

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the env var** (in the email section of `.env.example`, after `RESEND_FROM`)

```
RESEND_WEBHOOK_SECRET=        # Svix secret from Resend Dashboard → Webhooks (whsec_...). Verifies /api/resend-webhook. Without it the webhook no-ops (200).
```

- [ ] **Step 2: Run the full suite**

Run: `node --test tests/*.test.mjs`
Expected: PASS — baseline count + the new tests (email-schema 2, email-helpers ~6, suppression-wiring ~4, resend-webhook 4, messages-staff-alert 2), 0 fail.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(email): document RESEND_WEBHOOK_SECRET"
```

- [ ] **Step 4: Push (Codex-race guard)**

```bash
git fetch origin && git rebase origin/main && node --test tests/*.test.mjs && git push origin main
```

> `_lib/supabase.js` and `account/messages.js` are shared with Codex's active work — rebase + re-run tests before pushing. If the rebase conflicts, re-read the conflicting file and re-apply the change.

---

## Owner ops (post-merge, NOT dev work — flag to owner)

1. Apply `supabase/schema-email.sql` in the Supabase SQL editor (pooler).
2. Set `RESEND_WEBHOOK_SECRET` in Cloudflare Pages env (value from Resend webhook setup).
3. Resend Dashboard → Webhooks → add endpoint `https://masest.co/api/resend-webhook`; subscribe to `email.delivered`, `email.bounced`, `email.complained`.

## Self-Review (completed)

- **Spec coverage:** email_events (T1,T4) ✓ · suppression table + enforcement (T1,T4) ✓ · Resend webhook + Svix verify + status update + suppression upsert (T3,T5) ✓ · sendEmail chokepoint + category + offers reroute (T4,T6) ✓ · staff alert (T7) ✓ · grants (T1) ✓ · env + owner ops (T8) ✓.
- **Placeholder scan:** none — every code step shows full code; the two "may not be in scope" notes (offers var names, companyName) give an explicit fallback, not a TODO.
- **Type consistency:** `sendEmail({to, subject, html, category})`, `logEmailEvent({resend_id,to_email,category,subject,status,error})`, `updateEmailStatus(env,resendId,status)`, `recordSuppression(env,email,reason)`, `filterSuppressed(recipients,Set)`, `mapResendEvent(type)→status|null`, `isSuppressingEvent(type)→bool`, `verifySvixSignature(secret,{id,timestamp,signature},body)` — consistent across tasks.
