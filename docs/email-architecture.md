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

EmailOctopus is an optional companion for explicitly opted-in subscribers. It
mirrors eligible contacts and returns signed unsubscribe, bounce, complaint, and
deletion events into canonical MASEST preferences. Campaigns are authored and sent
in EmailOctopus; its API does not provide campaign creation or sending. Existing
MASEST compose, nurture, and transactional routing retain their current providers.
See [EmailOctopus setup and operations](emailoctopus-provider.md).

## Canonical modules

- `functions/_lib/email-policy.js`: category to stream/provider/preference.
- `functions/_lib/supabase.js`: Cloudflare transactional send, hard-suppression
  filtering, lifecycle logging, idempotency.
- `functions/_lib/marketing-delivery-queue.js`: versioned, PII-free Queue wake jobs.
- `functions/_lib/ses-email.js`: SigV4 SES transport, native SES subscription
  management, contact mirroring, provider result normalization, and
  single-recipient enforcement.
- `functions/_lib/marketing-subscribers.js`: canonical consent/audience writes.
- `functions/_lib/emailoctopus.js`: create-only contact enrollment and withdrawal.
- `workers/marketing-email/src/emailoctopus.js`: independent companion recovery
  schedule and signed webhook ingress.
- `supabase/schema-emailoctopus.sql`: durable consent mirror, leases, erasure,
  negative-event deduplication, and aggregate staff status.
- `functions/_lib/newsletter-delivery.js`: durable recipient ledger, leases,
  retries, suppression checks, and reconciliation.
- `workers/marketing-email/`: sole SES credential owner; Queue consumer,
  recovery schedule, suppression reconciliation, and signed SNS ingress.
- `functions/_lib/marketing-nurture.js`: consent-gated three-message quote nurture.
- `functions/_lib/email-template.js`: shared MASEST visual shell for both streams.

`sendEmailResult()` rejects marketing, missing, and unknown categories. Pages never
receives SES credentials or sends campaigns inline. It snapshots content and
recipients, then emits a Queue wake signal containing only source identity.

## Preferences and suppression

- `transactional_email_enabled` is always `true` and read-only in account UI.
- `marketing_email_enabled` defaults to `true` for accounts. Anonymous quote
  nurture requires the checked consent control on the request form.
- `notify_messages` independently controls optional support-reply alerts.
- `set_marketing_email_preferences` atomically updates the account preference,
  `newsletter_recipients`, and local marketing suppression.
- MASEST preference links update that same canonical state; SES footer/header
  unsubscribe updates return through signed SNS. Transactional mail stays enabled.
  Send-time filtering rechecks suppression for every recipient.
- Local changes append ordered consent events. PII-free Queue wakes mirror only
  latest state into SES; campaigns cannot claim recipients while that mirror is
  pending or dead. Stale SES events remain audit rows but cannot overwrite newer
  MASEST preferences.
- SES account-level suppression covers bounce/complaint destinations. SNS updates
  Supabase immediately; six-hour Worker reconciliation uses one paginated provider
  read and one atomic RPC. Provider blocks are never deleted automatically. User
  marketing opt-in never overrides an SES provider suppression.

## Campaigns

Newsletters, blog announcements, nurture, offers, and review requests snapshot rendered HTML in
`newsletter_delivery_sources`, then materialize one idempotent recipient row in
`newsletter_deliveries`. Cloudflare Queue drains a bounded batch using
`MARKETING_DELIVERY_BATCH_SIZE` and `MARKETING_DELIVERY_CONCURRENCY`, then reconciles
sent/suppressed/dead totals. Audience reads use only the canonical
recipient email column; auth-directory enumeration is not part of campaign send.

Code defaults remain `1`; checked-in production Worker vars use batch `10` and
concurrency `4` against the approved `50,000/day`, `14/second` `us-east-1` quota.
Change them only after `aws sesv2 get-account` confirms production access, sending
enabled, healthy enforcement, and a compatible `SendQuota.MaxSendRate`; keep
configured concurrency at or below that current rate.
Production access removes the verified-recipient sandbox restriction but does not
guarantee inbox placement or justify a sudden reputation-damaging volume spike.
Run `npm run verify:ses-production` after AWS login. It fails closed unless production
access, identity/DKIM/custom MAIL FROM, configuration-set sending/reputation/suppression,
all required SNS event types, exact topic policy, confirmed HTTPS subscription,
opt-out-by-default contact topic, and checked-in Worker delivery settings match this contract.
It also reads the active Cloudflare Worker deployment and fails closed when deployed
delivery vars or Queue binding differ from checked-in config.
SES enforces the account send rate; explicit 429 responses retry. Batch/concurrency
settings are not a strict account-wide per-second limiter.
Company-targeted offers resolve eligible account emails through one database RPC,
not one Supabase Auth request per user.

Every SES request has one recipient, native SES `ListManagementOptions`, SES-managed
unsubscribe footer/header behavior, and a signed source/recipient-bound online-view URL. Explicit 429/5xx responses
retry. Ambiguous network failures and expired processing leases become terminal
for manual review, preventing duplicate marketing delivery.

Queue delivery is at-least-once. Supabase leases and unique source-recipient keys
own idempotency; Queue messages contain no email, subject, or HTML. A five-minute
Worker schedule wakes due nurture/retry rows after lost continuation signals.

SES publishes Send, Delivery, DeliveryDelay, Reject, Bounce, Complaint, Rendering
Failure, and Subscription events through one SNS topic. Worker accepts only exact
topic ARN, `SignatureVersion=2`, strict regional Amazon certificate/confirmation
URLs, and valid signatures. DB persistence completes before HTTP ACK. Permanent
bounces and complaints suppress all mail; transient bounces do not.
Lifecycle status is monotonic by severity, then event time, so a slightly later
delivery event cannot erase an already-recorded complaint or hard bounce.
Subscription events require exact `masest-marketing` list + `marketing` topic.
`unsubscribeAll` always wins. Event-time ordering plus per-recipient DB locks keeps
newer consent authoritative.

## Operations

Cloudflare Worker configs remain separate. Validate both without publishing:

```sh
npx wrangler deploy --dry-run --config workers/email-service/wrangler.jsonc
npx wrangler deploy --dry-run --config workers/marketing-email/wrangler.jsonc
```

The send binding must report `noreply@send.masest.co` as an allowed sender.
Cloudflare generates outbound `Message-ID` values; never supply that header in
application payloads or `wrangler email sending send` probes. Use the dedicated
`replyTo` field plus `In-Reply-To` and `References` for support-thread continuity.
The Worker rejects provider-controlled and arbitrary headers before delivery.

SES runtime uses a dedicated IAM access key restricted to `ses:SendEmail` for
`marketing.masest.co` and configuration set `masest-marketing` in `us-east-1`.
Native list-managed sends also authorize only contact list `masest-marketing`.
Sender is `news@marketing.masest.co`; Reply-To is `dev@masest.co`; custom MAIL FROM
is distinct `bounce.marketing.masest.co`. SES credentials exist only on
`masest-marketing-email`, never Pages. Do not bind root AWS credentials.
The SNS topic resource policy is checked in at
`aws/sns/masest-ses-events-policy.json`; only this AWS account may administer the
topic, and only the exact SES configuration set may publish service events.
Contact mirroring is restricted to `ses:CreateContact` and `ses:UpdateContact` on
`arn:aws:ses:us-east-1:791359098991:contact-list/masest-marketing`.

Apply these migrations before release:

- `supabase/schema-unified-support-messages.sql`
- `supabase/migrate-cloudflare-email-service-2026-08-31.sql`
- `supabase/migrate-email-inbound-reference-regex-2026-09-01.sql`
- `supabase/migrate-support-participant-threads-2026-09-03.sql`
- `supabase/migrate-support-tickets-2026-09-06.sql`
- `supabase/schema-notification-prefs.sql`
- `supabase/schema-email.sql`
- `supabase/schema-newsletters.sql`
- `supabase/migrate-ses-marketing-2026-09-03.sql`
- `supabase/migrate-marketing-queue-sns-2026-09-03.sql`
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

`support_tickets` adds independently managed work episodes beneath that stable
transport identity; it does not add a conversation table, Order-specific route, or
email ingress. Until the ticket-routing cutover, the existing `support_threads`
lifecycle remains the runtime compatibility owner. After cutover, the ticket alone
owns status, priority, category, assignment, and resolution; the thread continues to
own participant and transport identity. The default interface may show one active
ticket per thread, while the schema permits a signed reply to reopen its exact
historical ticket.

Signed reply addresses continue to resolve the canonical parent Support Message.
That parent message supplies both thread and ticket identity; neither a `MAS-…`
display number nor caller-supplied ticket ID is a routing or authorization credential.
Buyer-facing authenticated APIs expose explicit safe ticket/message fields. Ticket
events and private notes remain service-role-only and are never readable through the
current authenticated table RLS.

Ticket lifecycle is `open` → `waiting_on_customer` → `open` → `resolved`. A resolved
ticket returns to `open` only for an explicit reply or reopen. Escalation is priority
`high` or `urgent`, not another status. `needs_staff_reply` is derived from the latest
message sender while the ticket is unresolved.

The migration is additive: it retains thread lifecycle columns and permits nullable
message ticket linkage during rollout. If application cutover must be rolled back,
keep the ticket tables, event history, and message links in place and return runtime
routing to the existing thread fields. Do not drop or rewrite ticket data as an
operational rollback; a later reviewed migration may retire compatibility fields only
after all runtimes have completed the cutover.
