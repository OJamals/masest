# EmailOctopus companion provider

EmailOctopus supplements SES for permission-based campaigns composed and sent in
the EmailOctopus dashboard. Its v2 API manages contacts and reads campaigns; it
does not create or send campaigns. MASEST newsletter compose, automated campaigns,
and transactional delivery keep their existing routing.

## Account setup

Use a **standard EmailOctopus account**, not EmailOctopus Connect, which requires
your own SES account. The free plan currently includes 2,500 subscribers and
10,000 emails per month, with EmailOctopus branding. Domain DNS authentication is
optional; verify the sending email address. EmailOctopus may rewrite the sender
to its own domain when the original address's DMARC policy requires it.

The MASEST account was prepared on 2026-09-07:

- Verified sending address: `dev@masest.co`.
- Dedicated list: **MASEST opt-in subscribers**, initially empty.
- API v2 key: **MASEST opt-in sync**, verified with a successful list read.
- Webhook: **MASEST consent sync**, with Created, Updated, Deleted, Bounced,
  Complained, and Unsubscribed events. API/import events are not excluded.
- Endpoint: `https://masest-marketing-email.jolly-credit-0ea1.workers.dev/v1/emailoctopus/events`.
- Root `.dev.vars` holds `EMAILOCTOPUS_API_KEY`, `EMAILOCTOPUS_LIST_ID`, and
  `EMAILOCTOPUS_WEBHOOK_SECRET`; it is Git-ignored and mode `600`.
- `EMAILOCTOPUS_ENABLED=false`: credentials and account setup alone do not activate
  production synchronization. The database migration and runtime deployment are
  still required. No contacts were uploaded and no campaign was sent during setup.

Manage keys at <https://dashboard.emailoctopus.com/developer/api-keys> and webhooks
at <https://dashboard.emailoctopus.com/developer/webhooks>. Never copy credentials
into tracked files, client JavaScript, chat, or deployment logs. Root `.dev.vars`
is local storage, not a production Worker binding.

## Activation order

1. Apply `supabase/schema-emailoctopus.sql` after the existing newsletter, email,
   SES marketing consent, and marketing queue migrations. It is additive and
   rerunnable; it seeds only currently eligible, auditable opt-ins.
2. Set the three EmailOctopus credentials on **masest-marketing-email**, using
   interactive `wrangler secret put NAME --config workers/marketing-email/wrangler.jsonc`
   commands with the values already stored locally. Do not bulk-upload the entire
   root `.dev.vars`; unrelated services' secrets do not belong on this Worker.
3. Deploy the Worker with `EMAILOCTOPUS_ENABLED=false` and deploy the Pages changes.
   Confirm the webhook rejects unsigned requests with HTTP 401. An empty array
   signed with the saved webhook secret should return HTTP 200 without contacts
   or emails being created. The configured endpoint cannot process events until
   this deployment exists.
4. Change `EMAILOCTOPUS_ENABLED` to `true` on the Worker and deploy that configuration.
   The five-minute schedule verifies the list and processes at most 20 contacts
   per run. Backlogs take additional runs; first binding pins the list ID.
5. In Admin → Newsletter → Settings, confirm a recent connection check, zero
   pending rows, and zero rows needing attention before selecting an audience
   for a campaign in EmailOctopus. Review that campaign in the provider dashboard
   and use its native unsubscribe footer. Sending is a separate operator action.

## Consent and synchronization

The companion accepts explicit website newsletter signup and explicit account
email-preference opt-in. Legacy `footer_newsletter` events also qualify. Imported
prospects, administrator additions, default-enabled account registration, and
unknown consent sources cannot enroll contacts. Do not import cold prospects into
this dedicated list or use a provider-native signup form that bypasses MASEST.

Local preference and suppression changes queue durable per-contact revisions.
The Worker rechecks canonical subscription and suppression at claim time. A
create-only POST enrolls a missing contact; an existing pending confirmation or
provider opt-out is never promoted. Withdrawals never create provider contacts.
Network/429/5xx failures retry; terminal failures remain visible for review.
Expired leases recover without dropping a newer preference revision. Successful
contacts are reconciled again after six hours to recover missed negative events.

Signed negative webhooks update canonical MASEST preferences, allowing the existing
SES mirror to follow the withdrawal. Bounces and complaints also create an
all-stream delivery suppression. Provider negatives remain blocked even after a
later local opt-in; restoration needs a separately reviewed correction on both
sides. Positive provider events do not create local consent. Duplicate events are
ignored, and unknown or fully erased recipients are not recreated.

Account or canonical recipient deletion queues removal from EmailOctopus. The
temporary mirror retains the email only until remote deletion is confirmed;
deduplication retains event IDs without contact data. Operational failures can
delay that removal and require attention.

Synchronization is eventual. EmailOctopus dashboard sends cannot call MASEST's
per-recipient send-time policy. A withdrawal racing an in-flight enrollment is
corrected by the next revision; do not send while synchronization is pending or
unhealthy. Run each campaign in one provider to avoid duplicate delivery.

## Recovery and rollback

Set `EMAILOCTOPUS_ENABLED=false` to stop outbound contact synchronization while
retaining signed webhook processing. Keep the webhook active so withdrawals
continue returning to MASEST. Existing SES operation is independent of companion
errors. The flag does not pause EmailOctopus dashboard campaigns or automations;
pause those in the provider dashboard when necessary.

Rows marked `dead` are not silently discarded or automatically resubscribed.
After correcting the reported provider/configuration problem, an operator may
reset only the reviewed rows to `state='retry', attempts=0, available_at=now()`.
Do not clear `provider_blocked` or `erase` during routine retries. A changed list
ID is rejected: migrating to another list requires reconciling the old list first.

## Validation

`npm test` covers HTTP responses, signature verification, event filtering,
disabled configuration, independent schedules, and staff authorization.
`npm run qa:emailoctopus:db` uses an isolated temporary PostgreSQL cluster for
consent, concurrent claims, negative events, erasure, and service-role permissions.
It requires local PostgreSQL `initdb` and `pg_ctl`, with no production DB access.
`npx playwright test tools/admin-newsletter.spec.mjs --workers=1` exercises the
settings state with a browser. Worker packaging can be checked with
`npx wrangler deploy --dry-run --config workers/marketing-email/wrangler.jsonc`.

## Provider comparison

As of 2026-09-07, Klaviyo's free plan includes up to 250 active profiles and 500
emails per month. Its footer logo is mandatory on free accounts. EmailOctopus has
10 times the contact capacity and 20 times the monthly sends; it also requires
branding. Klaviyo is more useful when its commerce segmentation, event-driven
flows, and campaign APIs matter more than free sending capacity.

MASEST previously had a substantial Klaviyo integration: industry lists,
subscription and suppression APIs, commerce events, campaign creation/sending,
quote nurture flows, branded proof templates, and a template synchronization CLI.
Commit `5914b56a` replaced that runtime with SES and removed the Klaviyo client,
template sync module, CLI, and corresponding tests. Git retains that history;
the current site does not have a ready-to-enable Klaviyo switch. Account-side
assets may still exist, but their current status was not verified in this review.
Restoration would need the current durable consent/suppression and delivery
architecture, not a wholesale revert of the SES migration.

Sources: [EmailOctopus pricing](https://emailoctopus.com/pricing),
[API v2](https://emailoctopus.com/api-documentation/v2),
[webhook specification](https://help.emailoctopus.com/article/314-webhooks),
[Klaviyo pricing](https://www.klaviyo.com/pricing), and
[Klaviyo footer branding](https://help.klaviyo.com/hc/en-us/articles/115005066887).
