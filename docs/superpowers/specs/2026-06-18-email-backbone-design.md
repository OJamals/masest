# Design: Email Backbone (delivery log + suppression + webhook + staff alert)

**Date:** 2026-06-18
**Status:** Approved (design) — pending implementation plan
**Type:** Feature (backend / email infrastructure)

## Goal

MASEST sends transactional + offer email through Resend but has no visibility into
what happens after send: no delivery/bounce log, no suppression of bad addresses, and
buyers' inbound messages reach staff only via a 30s dashboard poll (no email alert).
This is the keystone email-infrastructure investment — it unlocks deliverability
monitoring, future nurture sequences, and reliable staff alerting.

Build four components:
1. `email_events` — a log of every send and its delivery lifecycle.
2. Resend webhook — ingest delivery/bounce/complaint events into the log.
3. Bounce suppression — never re-send to hard-bounced / complained addresses.
4. Staff alert — email staff when a buyer posts a message.

Out of v1 scope (deferred): open/click tracking (marketing analytics, privacy +
Resend config implications), an admin email-log UI view, send throttling/digests.

## Current state (grounding)

- `sendEmail(env, { to, subject, html })` — `functions/_lib/supabase.js:105`. Single
  Resend helper, fire-and-forget, returns `r.ok` (boolean), discards Resend's `id`.
  Used by order/quote/team/message flows.
- `functions/api/admin/offers.js:69` — **bypasses** `sendEmail`, calls
  `fetch('https://api.resend.com/emails')` directly via `emailLayout`. Must be routed
  through `sendEmail` so offers are logged + suppression-checked.
- `functions/api/account/messages.js` POST — buyer posts a message; inserts the
  message row + an in-app staff notification, but sends **no email** to staff.
- `requireStaff` (`_lib/supabase.js:73`) reads `env.ADMIN_EMAILS` (comma-separated) as
  the authoritative staff list — reuse for the staff-alert recipient set.
- Webhook pattern: `functions/api/stripe-webhook.js:121` reads the raw body and verifies
  the signature via SubtleCrypto. Mirror this for Svix-signed Resend webhooks.
- Supabase convention: new tables need **explicit grants** — service-role auto-grant
  does not fire (`supabase/schema-phase5.sql:107-110`). Missing grants → inserts fail
  42501. `adminClient(env)` is the service-role client.

## Architecture: `sendEmail` as the universal logged chokepoint (Approach A)

All outbound email flows through one instrumented function. Chosen over a separate
wrapper (partial coverage until every call site migrates) and webhook-only logging
(no send-time record, cannot log suppressed/failed-before-send, no category tags).

```
caller ─► sendEmail(env, {to, subject, html, category})
            │  1. drop suppressed recipients (email_suppressions)
            │  2. POST Resend  ──► capture { id }
            │  3. insert email_events(resend_id, to, category, status='sent')
            ▼
         Resend ──(async events)──► POST /api/resend-webhook
                                       │  svix-verify (RESEND_WEBHOOK_SECRET)
                                       │  update email_events by resend_id
                                       └─ on hard-bounce/complaint: upsert email_suppressions
```

## Components

### 1. Data model — `supabase/schema-email.sql` (new)

```
email_events(
  id            uuid pk default gen_random_uuid(),
  resend_id     text,                 -- Resend message id; null if send failed pre-dispatch
  to_email      text not null,
  category      text,                 -- order|offer|quote|team|message|staff_alert
  subject       text,
  status        text not null default 'sent',  -- sent|delivered|bounced|complained|failed
  error         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
)
index on (resend_id), index on (to_email), index on (created_at desc)

email_suppressions(
  email       text primary key,
  reason      text not null,          -- hard_bounce|complaint|manual
  created_at  timestamptz default now()
)
```
Plus grants (mirror schema-phase5.sql):
`grant all privileges on public.email_events, public.email_suppressions to service_role;`
`grant usage, select on all sequences in schema public to service_role;`

### 2. Send path — `sendEmail` (`_lib/supabase.js`)

- New optional `category` field in the args object (default null). Backward compatible:
  existing callers unchanged; they can add a category opportunistically.
- Before send: query `email_suppressions` for the recipient set; drop matches. If all
  recipients suppressed, skip the Resend call and record `status='failed'`,
  `error='all_recipients_suppressed'`.
- Send: capture the Resend response JSON `id`.
- After send: insert one `email_events` row (`status='sent'` on ok, `'failed'` on error
  with `error` text).
- Stays fire-and-forget for the caller: logging/suppression wrapped in try/catch and
  must never throw into the caller or block the email. Suppression check **fails open**
  (on query error, send anyway).
- Multi-recipient note: current `sendEmail` sends one Resend call with `to: [...].slice(0,50)`.
  v1 logs **one `email_events` row per send** keyed on the Resend `id`, with `to_email` =
  comma-joined recipient list (display only). Per-recipient event rows are out of scope.
  Suppression matching uses the specific email address carried in the webhook payload —
  NOT the `to_email` field — so multi-recipient sends still suppress the correct address.
- Refactor `offers.js:69` direct fetch → `sendEmail(env, {..., category:'offer'})`.

### 3. Webhook — `functions/api/resend-webhook.js` (new)

- `POST` only. Read raw body. Verify Svix signature using `RESEND_WEBHOOK_SECRET` and
  the `svix-id` / `svix-timestamp` / `svix-signature` headers (HMAC-SHA256, base64),
  via SubtleCrypto (Workers runtime), mirroring the stripe-webhook approach.
- Map Resend event `type` → status: `email.delivered`→`delivered`,
  `email.bounced`→`bounced`, `email.complained`→`complained`,
  `email.delivery_delayed`→(log only). Update `email_events` rows by `resend_id`
  (`status`, `updated_at`).
- On `bounced` (hard) or `complained`: upsert `email_suppressions(email, reason)`.
- Idempotent (update-by-id; upsert). Returns **200** for accepted/duplicate/unknown
  events (avoid Resend retry storms on our-side errors); **400** only on signature
  failure. No-op (200) if `RESEND_WEBHOOK_SECRET` unset.

### 4. Staff alert — `functions/api/account/messages.js` POST

- After the message + notification insert, call `sendEmail(env, { to: ADMIN_EMAILS
  list, subject: \`New message from ${companyName}\`, html: emailLayout({...}),
  category: 'staff_alert' })`.
- `ADMIN_EMAILS` parsed the same way as `requireStaff`. Best-effort: a send failure
  must not fail the buyer's POST. Throttle/digest deferred (low B2B message volume).

## Error handling

- Logging + suppression are best-effort and side-effect-only: wrapped in try/catch,
  never throw into callers, never block a send or a message POST.
- Suppression check fails open (send on query error) — deliverability log is advisory,
  not a hard gate that could silence legitimate mail on a DB blip.
- Webhook verifies signature before any DB write; idempotent updates/upserts; returns
  200 on our-side processing errors to prevent Resend retry amplification.
- All new tables carry explicit `service_role` grants (else 42501 on insert).

## Testing (match repo's `node:test` source/logic style)

1. `schema-email.sql` declares `email_events` + `email_suppressions` and grants both to
   `service_role` (grep-style assertion, mirrors existing schema tests).
2. `sendEmail` filters suppressed recipients and tags `category` (logic test with a
   stubbed Resend fetch + suppression source).
3. `resend-webhook` rejects a bad/missing signature (no DB write) and maps event types
   to statuses.
4. `resend-webhook` upserts a suppression on hard bounce / complaint.
5. `messages.js` POST triggers a `staff_alert` send (assert sendEmail called with the
   ADMIN_EMAILS recipients + category).

## Migration / owner ops (post-merge)

1. Apply `supabase/schema-email.sql` (Supabase SQL editor / pooler).
2. Set `RESEND_WEBHOOK_SECRET` in Cloudflare Pages env.
3. Resend dashboard → Webhooks → add endpoint `https://masest.co/api/resend-webhook`,
   subscribe to delivered / bounced / complained events.
4. Add `RESEND_WEBHOOK_SECRET` to `.env.example` with a comment.

## Concurrency / lane

All target files are outside Codex's active admin/QBO work except
`functions/api/account/messages.js` (low contention). `_lib/supabase.js` is shared
infra — re-read before editing and rebase before push (standard Codex-race guard).

## Out of scope (do not build in v1)

Open/click tracking, admin email-log UI, send throttling/digests, per-recipient event
rows, Klaviyo nurture (separate roadmap item #4), SMS.
