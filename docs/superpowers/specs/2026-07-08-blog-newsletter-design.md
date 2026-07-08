# Blog Newsletter — Design Spec

**Date:** 2026-07-08 · **Status:** Approved (proceed directive)

## Goal
Automatically email each newly-published blog post to the newsletter subscriber list.

## Decisions
- **Engine:** Resend self-send; subscriber list pulled from Klaviyo (`KLAVIYO_LIST_ID`).
- **Trigger:** on publish (dedup-guarded; re-publish never re-sends).
- **Content:** hero + category + title + byline + excerpt + "Read the full post" CTA → `masest.co/blog/<slug>`.

## Architecture
CMS blog_post publish → `publish-blog.yml` workflow (builds/commits the static page) →
final workflow step curls a secret-gated sweep endpoint → endpoint sends any
published-but-unsent posts. Sweeping after the page is committed guarantees the
CTA link resolves; the dedup table makes it idempotent. Mirrors the existing
`/api/admin/review-reminders` secret-sweep pattern.

## Components
- `functions/_lib/klaviyo.js` — add `klaviyoListProfiles(env, listId)`: paginated
  `GET /api/lists/{id}/profiles`, returns `[{email}]`; skips if unconfigured.
- `functions/_lib/blog-newsletter.js` (new):
  - `renderBlogEmail(post, { unsubUrl })` → branded HTML (hero img, eyebrow, title,
    byline, excerpt, CTA button, unsub footer). All fields HTML-escaped. Plain-text
    alt via `htmlToText`.
  - `sendBlogNewsletter({ post, subscribers, suppressed, env, secret, fetchImpl, nowMs })`
    → filter suppressed + build per-recipient unsub token, chunk into Resend
    `POST /emails/batch` (≤100/call), return `{ recipients, batches }`. I/O injected.
- `functions/api/admin/blog-newsletter.js` (new) — `onRequestPost`, secret-gated
  (`x-blog-newsletter-secret` === `env.BLOG_NEWSLETTER_SECRET`, constant-time).
  Sweep: published `blog_post` (Supabase) minus `blog_newsletter_sends`; for each
  unsent (oldest→newest, cap N per run) pull Klaviyo subscribers + suppression,
  render, batch-send, insert send record. Returns `{ sent: [...], skipped }`.
- `functions/api/admin/content.js` — unchanged trigger surface; the workflow drives
  the send (keeps large sends out of the publish request path).
- `.github/workflows/publish-blog.yml` — add a final step:
  `curl -fsS -X POST "$BLOG_NEWSLETTER_URL/api/admin/blog-newsletter"
   -H "x-blog-newsletter-secret: $SECRET"` (best-effort; `|| true`).
- `email.js` — add `blog_newsletter` to `MARKETING_CATEGORIES`; reuse
  `unsubscribeToken`/`verifyUnsubscribeToken`/`filterSuppressed`/`List-Unsubscribe`.
- `supabase/schema-blog-newsletter.sql` — `blog_newsletter_sends(slug pk, sent_at,
  recipient_count)`, grants to service_role, **seed the 3 existing slugs** (backlog
  guard — never blast old posts).

## Error handling
- Endpoint 401 without valid secret (constant-time compare).
- Klaviyo/Resend unconfigured or failing → best-effort, logged, does not throw the
  publish/workflow. A post only records as "sent" after a successful batch pass.
- Suppressed / unsubscribed recipients filtered via `email_events` + suppression.

## Testing (node --test)
- `renderBlogEmail`: hero/title/excerpt/CTA link present, HTML-escaped, unsub link.
- `sendBlogNewsletter`: suppression filter drops recipients, batch chunking at 100,
  Resend payload shape, category=blog_newsletter, List-Unsubscribe header.
- `klaviyoListProfiles`: paginates + dedupes emails (fetch stub).
- endpoint: 401 without secret; sweep skips already-sent slugs.

## Owner ops (inert until done)
- Apply `supabase/schema-blog-newsletter.sql` (creates table + seeds 3 existing slugs).
- Set `BLOG_NEWSLETTER_SECRET` in CF Pages prod env + as a GitHub repo secret.
- Already set: `KLAVIYO_PRIVATE_KEY`, `KLAVIYO_LIST_ID`, `RESEND_API_KEY`,
  `RESEND_FROM`, `EMAIL_UNSUB_SECRET`.
