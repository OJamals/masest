# Newsletter Platform — Design Spec

**Date:** 2026-07-08 · **Status:** Approved (scope A+B+C chosen). Defer D (user mgmt) + E (admin UX overhaul) — concurrent session owns those.

## Goal
Admin-authored newsletters: compose (rich, shared editor) or pick a blog post, choose an
audience (users + website leads + imported lists + Klaviyo), send now or on a schedule,
manage a queue, and auto-send the latest blog post. Reuses the existing Resend/Klaviyo/
Supabase send stack + the blog editor components.

## Scope (v1)
- A. Authoring: Newsletter admin tab; editor reuses the CMS field/preview/insert-image
  components; body = Markdown **with raw-HTML passthrough** (staff-authored email); source
  toggle = compose | pick published blog post (prefills). Live email preview.
- B. Audience: unified `newsletter_recipients` store (import target + manual + prefs) plus
  live populations (registered users, website leads, Klaviyo list). Per-newsletter audience
  selection. Recipient CRUD + CSV import. Per-recipient subscribe/unsub.
- C. Sending: send now; schedule once or recurring (2wk / monthly / 6mo…); queue UI;
  auto-send-latest-blog toggle (gates the existing blog sweep). GitHub-cron drives due sends.

Out of scope v1: full WYSIWYG (Markdown+HTML toolbar instead), A/B tests, open/click
analytics beyond Resend/email_events, Crisp integration.

## Data model (Supabase — `supabase/schema-newsletters.sql`)
- `newsletters`(id uuid pk, subject text, body_md text, source text['compose'|'blog_post'],
  blog_slug text, status text['draft'|'scheduled'|'sending'|'sent'|'canceled'],
  audience jsonb `{populations:[], recipient_tags:[]}`, schedule jsonb
  `{mode:['once'|'recurring'], send_at timestamptz, interval_days int, next_run_at timestamptz}`,
  recipient_count int, sent_at timestamptz, created_by uuid, created_at, updated_at).
- `newsletter_recipients`(email text pk, name text, source text['import'|'manual'],
  tags text[], subscribed bool default true, created_at). Import/manual only; users+leads
  resolved live at send.
- `newsletter_settings`(id int pk default 1, auto_send_latest_blog bool default false, updated_at).
- Reuse `email_suppressions` (marketing stream) for unsub; `email_events` for logging.
- Grants to service_role. RLS off (service-role only).

## Audience resolution (at send, `_lib/newsletter.js resolveAudience`)
Union of the newsletter's selected `populations`:
- `users` → distinct emails from `profiles`/auth (has-email, marketing-opted-in).
- `leads` → website lead-gen: CRM contacts + newsletter signups (Klaviyo list via
  `klaviyoListProfiles`, and/or a leads source).
- `imported` → `newsletter_recipients` where subscribed (optionally filtered by tags).
Then drop `email_suppressions` (marketing) + unsubscribed. Dedupe by lowercased email.

## Send engine (reuse)
Per-recipient `sendEmail` (suppression + per-recipient List-Unsubscribe + email_event
logging), category `newsletter` (marketing). Idempotency key `newsletter:<id>:<email>`
(24h Resend dedupe). Batched with a per-run cap; the cron re-invokes for large lists.
Email body = `renderNewsletterEmail(newsletter)` → Markdown+HTML → `emailLayout`.

## Endpoints
- `functions/api/admin/newsletters.js` — staff-gated CRUD (list/get/save/delete),
  `action:'send_now'` (resolve+send), `action:'schedule'` (set schedule),
  `action:'test_send'` (to one address). PLUS `action:'sweep_due'` behind the
  constant-time `x-newsletter-cron-secret` (automation; no staff — documented non-staff
  gate) that sends newsletters with `status='scheduled' and next_run_at<=now`, reschedules
  recurring (next_run_at += interval) or marks `sent`.
- `functions/api/admin/recipients.js` — staff-gated: list (+population counts), add, update
  (subscribe/tags), remove, `action:'import'` (CSV/emails array).
- Blog auto-send: gate the existing `blog-newsletter` sweep on
  `newsletter_settings.auto_send_latest_blog`.

## Admin UI (`js/admin/newsletter.js`, `js/admin/recipients.js`; admin.html gains a Newsletter tab)
- **Compose**: subject; source toggle (compose | blog post dropdown); body editor reusing
  content.js field template + markdown preview + Insert-image (extract shared helpers to
  `js/admin/editor-fields.js`); live email preview (rendered via a browser copy of the
  render). Audience picker (checkbox populations + tag filter + live recipient count).
  Buttons: Save draft · Send test · Send now · Schedule.
- **Queue**: scheduled newsletters (status=scheduled) with next_run_at, edit/cancel.
- **Recipients**: table (view/add/remove/modify, subscribe toggle, tags), CSV import,
  population counts.
- **Settings**: auto-send-latest-blog toggle.

## Scheduling
GitHub Actions cron (`.github/workflows/newsletter-cron.yml`, hourly) → curls
`/api/admin/newsletters` `{action:'sweep_due'}` with `NEWSLETTER_CRON_SECRET`. Mirrors the
publish-blog workflow. (CF Cron Triggers considered; GitHub chosen for consistency + repo
visibility.) Recurring intervals computed server-side from `interval_days`.

## Error handling / safety
- Cron endpoint constant-time secret; sends abort if the ledger/tables missing.
- `status='sending'` lock prevents a concurrent cron from double-sending; idempotency keys
  are the backstop.
- Suppression + unsubscribe always applied; test-send never marks sent.
- Per-run recipient cap; cron re-invokes.

## Testing (node --test)
- `_lib/newsletter.js`: renderNewsletterEmail (md+html, escape untrusted, CTA), resolveAudience
  (union, dedupe, suppression filter), schedule math (next_run_at from interval), dueNewsletters.
- endpoints: staff-gate (401/403) for CRUD; cron secret-gate (401) for sweep_due;
  recipients import parsing.
- admin editor: reused field/preview/insert helpers still render (extend blog smoke).

## Integrations used
Resend (send), Klaviyo (leads/list source + existing signup), Supabase (data + auth users),
Cloudflare (deploy + endpoints), GitHub Actions (schedule cron). Crisp: not in v1.

## Owner ops (inert until done)
- Apply `supabase/schema-newsletters.sql`.
- Set `NEWSLETTER_CRON_SECRET` (CF prod env + GitHub repo secret).
- Already set: RESEND_*, KLAVIYO_*, SUPABASE_*, EMAIL_UNSUB_SECRET.

## Build order (plan)
1. Schema + `_lib/newsletter.js` (render, resolveAudience, schedule math) + tests.
2. `recipients.js` endpoint + import + `js/admin/recipients.js`.
3. `newsletters.js` endpoint (CRUD, send_now, schedule, sweep_due) + tests.
4. Extract shared editor helpers → `js/admin/editor-fields.js`; `js/admin/newsletter.js`
   (compose/queue/settings) + admin.html Newsletter tab.
5. `newsletter-cron.yml` + gate blog auto-send on the setting.
6. Verify, merge, deploy, activate secret.
