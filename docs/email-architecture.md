# Email architecture

`functions/_lib/email-policy.js` is the canonical routing policy. Callers assign
an email category; they do not choose a provider independently.

## Provider boundary

| Mail | Categories | Provider | User control |
| --- | --- | --- | --- |
| Required service mail | orders, shipping, billing, refunds, cancellations, returns, auth, team invites, support/chat, requested quote operations, staff alerts | Cloudflare Email Service | Always on |
| Optional marketing mail | offers, newsletters, blog campaigns, nurture sequences, review solicitations | Amazon SES | Default on; user may unsubscribe |

Cloudflare Email Service is transactional-only. Requested quote follow-ups may
use Cloudflare only while they continue a buyer-initiated request and contain no
promotion. Add promotional content or broad prospecting and the category must
move to Amazon SES.

## Canonical modules

- `functions/_lib/email-policy.js`: category to stream/provider/preference.
- `functions/_lib/supabase.js`: Cloudflare transactional send, hard-suppression
  filtering, lifecycle logging, idempotency.
- `functions/_lib/marketing-email.js`: one-to-one SES marketing gateway.
- `functions/_lib/ses-email.js`: SigV4 SES transport, one-click unsubscribe,
  provider result normalization, and single-recipient enforcement.
- `functions/_lib/marketing-subscribers.js`: canonical consent/audience writes.
- `functions/_lib/newsletter-delivery.js`: durable recipient queue, leases,
  retries, suppression checks, and reconciliation.
- `functions/_lib/marketing-nurture.js`: consent-gated three-message quote nurture.
- `functions/_lib/email-template.js`: shared MASEST visual shell for both streams.

`sendEmailResult()` rejects marketing, missing, and unknown categories.
`queueMarketingEmail()` rejects transactional, missing, and unknown categories.
This makes provider drift fail closed.

## Preferences and suppression

- `transactional_email_enabled` is always `true` and read-only in account UI.
- `marketing_email_enabled` defaults to `true` for accounts. Anonymous quote
  nurture requires the checked consent control on the request form.
- `notify_messages` independently controls optional support-reply alerts.
- `set_marketing_email_preferences` atomically updates the account preference,
  `newsletter_recipients`, and local marketing suppression.
- Signed unsubscribe links update that same canonical state; transactional mail
  stays enabled. Send-time filtering rechecks suppression for every recipient.
- SES account-level suppression covers bounce/complaint destinations. Each bulk
  marketing run refreshes that list through one paginated provider read and one
  atomic Supabase RPC; provider blocks are never deleted automatically. User
  marketing opt-in never overrides an SES provider suppression.

## Campaigns

Newsletters, blog announcements, and nurture messages snapshot rendered HTML in
`newsletter_delivery_sources`, then materialize one idempotent recipient row in
`newsletter_deliveries`. Workers lease at most 25 rows, send with concurrency 5,
and reconcile sent/suppressed/dead totals. Audience reads use only the canonical
recipient email column; auth-directory enumeration is not part of campaign send.
Company-targeted offers resolve eligible account emails through one database RPC,
not one Supabase Auth request per user.

Every SES request has one recipient, RFC 8058 headers, a signed unsubscribe URL,
and a signed source/recipient-bound online-view URL. Explicit 429/5xx responses
retry. Ambiguous network failures stop to avoid duplicate marketing delivery.

## Operations

Cloudflare Worker configuration is owned by
`workers/email-service/wrangler.jsonc`. Validate it without publishing:

```sh
npx wrangler deploy --dry-run --config workers/email-service/wrangler.jsonc
```

The send binding must report `noreply@send.masest.co` as an allowed sender.
Cloudflare generates outbound `Message-ID` values; never supply that header in
application payloads or `wrangler email sending send` probes. Use the dedicated
`replyTo` field plus `In-Reply-To` and `References` for support-thread continuity.
The Worker rejects provider-controlled and arbitrary headers before delivery.

SES runtime uses a dedicated IAM access key restricted to `ses:SendEmail` for
`masest.co` and configuration set `masest-marketing` in `us-east-1`. Sender is
`dev@masest.co`; custom MAIL FROM is `marketing.masest.co`. Do not bind root AWS
credentials. Do not add SES credentials until production access is enabled.

Apply these migrations before release:

- `supabase/schema-unified-support-messages.sql`
- `supabase/migrate-cloudflare-email-service-2026-08-31.sql`
- `supabase/migrate-email-inbound-reference-regex-2026-09-01.sql`
- `supabase/migrate-support-participant-threads-2026-09-03.sql`
- `supabase/schema-notification-prefs.sql`
- `supabase/schema-newsletters.sql`
- `supabase/migrate-ses-marketing-2026-09-03.sql`
- `supabase/schema-blog-newsletter.sql`
- offer email columns in `supabase/schema-phase5.sql`

Existing accounts are backfilled into `newsletter_recipients` once. Registration,
explicit preference changes, newsletter signup, consented quote intake, and
recipient admin actions maintain it thereafter.

Support email and dashboard chat share `support_threads`. One participant thread
belongs to one user, may reference that user's current or past orders, and keeps
the same identity when a reply returns through `reply.masest.co`. Company-wide
business conversations use the same table with no participant. Legacy company
summary columns remain a compatibility projection; they do not own chat state.
