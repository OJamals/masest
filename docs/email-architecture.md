# Email architecture

`functions/_lib/email-policy.js` is the canonical routing policy. Callers assign
an email category; they do not choose a provider independently.

## Provider boundary

| Mail | Categories | Provider | User control |
| --- | --- | --- | --- |
| Required service mail | orders, shipping, billing, refunds, cancellations, returns, auth, team invites, support/chat, requested quote operations, staff alerts | Cloudflare Email Service | Always on |
| Optional marketing mail | offers, newsletters, blog campaigns, nurture sequences, review solicitations | Klaviyo | Default on; user may unsubscribe |

Cloudflare Email Service is transactional-only. Requested quote follow-ups may
use Cloudflare only while they continue a buyer-initiated request and contain no
promotion. Add promotional content or broad prospecting and the category must
move to Klaviyo.

## Canonical modules

- `functions/_lib/email-policy.js`: category to stream/provider/preference.
- `functions/_lib/supabase.js`: Cloudflare transactional send, hard-suppression
  filtering, lifecycle logging, idempotency.
- `functions/_lib/marketing-email.js`: one-to-one Klaviyo flow events.
- `functions/_lib/klaviyo.js`: Klaviyo subscriptions, campaigns, and provider
  status reconciliation.
- `functions/_lib/email-template.js`: shared MASEST visual shell for both streams.

`sendEmailResult()` rejects marketing categories. `queueMarketingEmail()` rejects
transactional categories. This makes provider drift fail closed.

## Preferences and suppression

- `transactional_email_enabled` is always `true` and read-only in account UI.
- `marketing_email_enabled` defaults to `true` and syncs to the canonical
  Klaviyo list.
- `notify_messages` independently controls optional support-reply alerts.
- Marketing opt-out writes local `email_suppressions` first, then sends the
  Klaviyo unsubscribe job. Old signed unsubscribe links remain valid.
- Marketing opt-in requires successful Klaviyo subscription before the local
  preference is enabled. Hard bounce/complaint suppression is never cleared by
  a user marketing opt-in.

## Campaigns

Newsletters and blog announcements create one Klaviyo campaign and store its
provider campaign/message IDs. Scheduled reconciliation updates local status.
No per-recipient Supabase delivery rows are materialized for new campaigns.
This removes repeated account-directory reads and lowers Supabase egress.

Test sends require `KLAVIYO_TEST_LIST_ID`; production audience always uses
`KLAVIYO_LIST_ID`. Offer and review event mail requires live Klaviyo flows for
`KLAVIYO_FLOW_METRIC_OFFER` and `KLAVIYO_FLOW_METRIC_REVIEW_REQUEST`.

## Operations

Apply these migrations before release:

- `supabase/schema-notification-prefs.sql`
- `supabase/schema-newsletters.sql`
- `supabase/schema-blog-newsletter.sql`
- offer email columns in `supabase/schema-phase5.sql`

Existing accounts are not repeatedly scanned. Backfill them into Klaviyo once,
then rely on registration, explicit preference changes, newsletter signup, and
recipient admin actions for ongoing sync.
