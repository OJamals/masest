# MASEST email and DNS audit

Initial audit observed 2026-09-25, approximately 05:37–05:44 UTC. Follow-up authenticated AWS and applied four DNS corrections, verified at 11:43 UTC. Authorized diagnostics to `dev@masest.co` subsequently found and reproduced the SES suppression bug below. The tested fix was deployed with explicit approval; a post-deployment SES canary verified the repaired behavior at 12:28 UTC.

## Latest follow-up: requested opt-in and successful SES delivery

The owner explicitly requested reversal of the diagnostic inbox's marketing opt-out. Enabled **Include dev@masest.co in newsletters** through the live admin Recipients UI. The canonical consent event at `2026-09-25T12:33:35.408701Z` is `enabled=true`, source `admin_manual`, provider sync `synced`, with no error. SES subsequently reported topic `marketing=OPT_IN` and `UnsubscribeAll=false`; MASEST reported `subscribed=true` and no suppression rows for this address. This supersedes the opt-out state preserved during the earlier bug diagnosis below.

Sent exactly one labeled test through **Newsletter → Compose → Send test**, addressed only to `dev@masest.co`:

- Subject: `[TEST] MASEST SES marketing delivery test after opt-in — 2026-09-25`.
- Delivery source: `01911857-cd5c-4938-9805-1ab1d51418c3`, type `test`, complete; one recipient, one sent, zero suppressed/dead.
- SES message: `010001a0d88fa276-be5a67f3-a6cf-4b3d-a6a8-473e98625765-000000`; one attempt, no error.
- Genuine SNS delivery event: `ses:3930e2c4-25c7-5631-bd41-81f449609c77:0`, terminal `delivered` at `2026-09-25T12:34:47.698Z`.
- Both the recipient delivery ledger and application email record show `delivered`. No suppression was recreated. Marketing remains enabled as requested.

This verifies admin preference → consent sync → SES contact update and admin composer → durable queue → marketing Worker → SES → delivery callback persistence. No audience-wide campaign was launched. Inbox placement and received authentication headers remain uninspected.

## Diagnostic follow-up: confirmed suppression bug

The initial real admin Newsletter **Send test** workflow queued one recipient and the marketing Worker sent it through SES. SES returned `Permanent / UnsubscribedRecipient`: at that time this inbox had `UnsubscribeAll=true` and topic `marketing=OPT_OUT` in `masest-marketing`. SES correctly refused to attempt delivery. The application incorrectly treated every permanent bounce as a mailbox failure, creating `email_suppressions(reason='bounce', stream='all')`. This promoted a marketing opt-out into a transactional block.

Differential diagnostic evidence:

- Admin test SES ID `010001a0d872aae2-e3090e82-183e-48f2-a831-9e24b7f9dc38-000000`: processed by the real queue, then recorded as bounced. Created the erroneous all-stream row at `2026-09-25T12:03:09.443042Z`.
- Authorized direct SES canary without list-management options, ID `010001a0d875ddec-6236533a-d122-4b26-a383-78931c0007f0-000000`: delivered at `12:06:38.944Z`; Proofpoint accepted it with `250 2.0.0 Ok: queued as DED718006D`.
- Same diagnostic with list management, ID `010001a0d876c656-43d9ed2c-d372-4302-b3a1-b5c0df753930-000000`: captured SNS payload explicitly reports `UnsubscribedRecipient`, status `5.7.1`, and that SES did not send because the contact unsubscribed.

This matches [AWS's documented subtype semantics](https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html): no delivery attempt, no reputation penalty, no SES suppression-list entry. It does not establish a mailbox or DNS failure.

Repair in `workers/marketing-email/src/sns.js`: normalize `UnsubscribedRecipient` as terminal `rejected` with no global suppression reason. Preserve true hard-bounce/complaint handling and the existing marketing opt-out. Regression through the SNS HTTP handler failed before the fix (`bounced` versus `rejected`) and passed afterward. All 28 focused SNS, event, stream, and suppression tests pass; Wrangler deployment dry-run passes.

Approved deployment: `masest-marketing-email` version `0e7a3414-446c-43de-9632-de32bce76aa4`, replacing `72007b36-df68-4de1-9bb7-6473a020b602`. Used `wrangler deploy --keep-vars`; no Pages deployment, credential rotation, commit, or push. The downloaded live Worker includes the exact `UnsubscribedRecipient` branch. `node tools/verify-ses-production.mjs --profile default --json` returned `ok: true`, no failures, the new version ID, and unchanged pacing (batch 10, concurrency 4, continuation delay 1 second).

Post-deployment authorized SES canary with the existing marketing list/topic returned message ID `010001a0d889b908-7e35272a-e9c2-479a-9ad0-cd12665406c0-000000`. Its genuine SNS notification persisted terminal `rejected` at `2026-09-25T12:28:19.757Z` (event `ses:94801870-2d08-5ab2-9551-7b40462b60fe:0`). The recipient still has exactly its original marketing-only suppression; no all-stream row was recreated. SES `OPT_OUT` / `UnsubscribeAll=true` remained intact. This verifies the deployed event-normalization and persistence path with a real provider event.

Removed only the diagnostic-created all-stream bounce row for `dev@masest.co`, matching email, stream, reason, and exact creation timestamp. Verified its original `marketing/user_preference` row remains. SES opt-out was not changed. Historical event records remain intact. Evidence and pre-repair row saved in `email-suppression-diagnostic-evidence.json` beside the DNS snapshots.

A temporary encrypted SQS subscription captured the diagnostic SNS payload. The temporary subscription and queue were then deleted; the topic retains its original HTTPS Worker subscription.

### Cloudflare transactional and Auth tests

- Created clearly labeled support ticket `MAS-000005` through the actual staff UI, addressed only to `dev@masest.co`. Application category `messages`; provider ID `<UN0ZUnS5NhXqAbi9CTSQSw8pKI6zI91M1RNo@send.masest.co>`.
- Cloudflare's signed lifecycle callback persisted terminal `delivered` at `2026-09-25T12:15:09.360Z`, event ID `01a0d87d-a6c4-7f90-be2a-3b73de0de8a6`. Application status advanced from `sent` to `delivered`. This is fresh proof of the Pages → email Worker → Cloudflare delivery path and callback persistence, not merely API acceptance.
- Supabase Auth recovery email requested through its authenticated administrator API, HTTP 200. User `recovery_sent_at` advanced to `2026-09-25T12:15:59.059698Z`. Cloudflare's per-message log confirms `Reset your password` delivered to `dev@masest.co`, provider ID `<bVr0pei60ATfD0fp8GuuRUSGFRYlNd3i78nz@send.masest.co>`, timestamp `12:16:00Z`, with no error. No password changed; no reset link opened. CAPTCHA remains enabled; Supabase explicitly authorizes administrator credentials for this operation. This verifies the separate Auth → Cloudflare SMTP delivery path.
- Cloudflare's per-message log independently confirms the support diagnostic delivered, matching its application provider ID. Provider analytics appeared several minutes after the real-time lifecycle callback; an initially empty analytics result was not a delivery failure.
- A preliminary direct SMTP probe used the management API's hash-shaped/redacted `smtp_pass` value and received SMTP 535. That probe is invalid evidence about the actual stored credential. The subsequent successful Auth recovery request supersedes it. No credentials were rotated or replaced.

Received headers, inbox-versus-junk placement, staff mailbox outbound DKIM, and inbound support reply correlation are not yet verified. Delivery means the receiving mail server accepted the message.

## Recommendation

The owner's final decision is to keep GoDaddy/Microsoft Exchange, reporting another year of service. Retain Cloudflare Email Service for transactional/authentication mail and AWS SES for opted-in marketing. Defer Google Workspace shopping and mailbox migration. The existing application already implements this separation.

| Purpose | Recommended owner | Address/domain | Receiving or bounce path |
|---|---|---|---|
| Staff and personal business email | Existing GoDaddy/Microsoft Exchange | `person@masest.co`, role addresses such as `sales@masest.co` | Preserve existing Proofpoint root MX and mailbox service |
| Orders, quotes, invoices, notifications | Cloudflare Email Service | `noreply@send.masest.co` | `cf-bounce.send.masest.co` belongs to Cloudflare |
| Login, verification, password resets | Supabase Auth through Cloudflare SMTP | `noreply@send.masest.co` | Same authenticated transactional domain |
| Website support replies | Cloudflare Email Routing → existing email Worker | `reply@reply.masest.co`, including application's supported subaddressing | `reply.masest.co` MX belongs to Cloudflare |
| Promotional newsletters and consented nurture | AWS SES, `us-east-1` | `news@marketing.masest.co` | `bounce.marketing.masest.co` belongs to SES; human replies currently go to `dev@masest.co` |
| Secondary `masest.us` domain | Decide its purpose before expanding mail use | Currently has Cloudflare routing/sending configuration | No enabled inbound delivery rule found |

### Completed follow-up and remaining cleanup

- AWS CLI authentication succeeded for account `791359098991`; STS identity verified. SES in `us-east-1` is `HEALTHY`, production access and sending enabled, with quota 50,000 messages/day and 14/second. No messages sent in the preceding 24 hours.
- `marketing.masest.co` is verified for sending; DKIM signing is enabled and `SUCCESS`, with 2048-bit keys. Custom MAIL FROM `bounce.marketing.masest.co` is `SUCCESS` with `REJECT_MESSAGE` on MX failure.
- `masest-marketing` configuration set enables sending, reputation metrics, bounce/complaint suppression, and lifecycle events to `masest-ses-events`. Its HTTPS subscription is confirmed at the existing Worker's `/v1/ses/events`. The `marketing` contact-list topic defaults to `OPT_OUT`. These are configuration checks, not an end-to-end delivery test.
- Changed `autodiscover.masest.co` and `msoid.masest.co` to DNS-only, preserving their Microsoft targets. Verified both through the Cloudflare API after saving in the dashboard.
- Added TXT `masest.us._report._dmarc.masest.co` = `v=DMARC1;` to authorize reports from `.us` to its already configured `.co` recipients. Verified through the API.
- After explicit confirmation, deleted the older duplicate `_dmarc.masest.us` TXT (`3ca65cb0a09e0a5f7234e8643a965f08`) containing `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;`. The newer quarantine/reporting record and separate `contact.masest.us` policy are unchanged.
- Cloudflare API reads succeeded, but its DNS batch write returned HTTP 403 / code `10000` (`Authentication error`). No batch mutation succeeded; all four completed changes used the authenticated dashboard.
- Both `1.1.1.1` and `8.8.8.8` resolve the corrected Microsoft CNAMEs and new report-authorization TXT. Both authoritative nameservers, plus these two public resolvers, return exactly one `.us` root DMARC policy: `v=DMARC1; p=quarantine; pct=75; rua=mailto:dev@masest.co,mailto:matthew@masest.co`. Full API comparison against the before snapshot finds exactly two proxy changes, one added report-authorization TXT, and one deleted duplicate DMARC. All other record values are unchanged. Final evidence is `email-dns-final-verification.json` alongside the backup; `email-dns-after-cleanup.json` is the earlier three-change snapshot.

Full before snapshot and exact planned record IDs are saved in `/Users/omar/.codex/visualizations/2026/09/25/01a0d711-86ba-7461-af23-546403080900/email-dns-before-cleanup.json` and `email-dns-cleanup-plan.json`. Rollback data: the two Microsoft CNAMEs previously had proxy enabled; the report-authorization TXT was absent; the removed duplicate's exact value appears above and had Auto TTL. Recreating the deleted record would restore the original invalid duplicate policy and should only be considered as a deliberate rollback. Root mailbox MX/SPF and provider signing records are unchanged.

### How SES is used, and what Cloudflare verification proves

SES is the delivery transport behind MASEST's application-managed marketing system. The application prepares newsletter, blog announcement, offer, review-request, and consent-gated quote-nurture content. It stores a content snapshot and per-recipient delivery ledger in Supabase. A Cloudflare Queue wakes `masest-marketing-email`, which checks current subscription/suppression state and sends individual messages through SES. Cloudflare runs the campaign worker; Amazon delivers the marketing mail. Sender: `news@marketing.masest.co`; human replies: `dev@masest.co`. SES delivery, bounce, complaint, and unsubscribe events return through SNS to the Worker and update application records. See `functions/_lib/ses-email.js:284`, `functions/_lib/marketing-nurture.js:9`, and `docs/email-architecture.md`.

Live database inspection on September 25 found:

- 18 stored delivery sources: 16 `test`, two `newsletter`; all source rows marked complete.
- 21 recipient delivery rows: 18 sent, two suppressed, one dead. Provider outcomes: 13 delivered, two bounced, two complained, one sent, three unset. Source completion means processing finished, not universal delivery success.
- The two newsletter sources targeted three recipients total: one sent, two suppressed.
- Five subscriber records, of which two are subscribed; source labels include migration and QA records. This is not proof of a developed, consent-audited campaign audience.
- Zero current rows in `newsletters`, so no campaign draft or schedule was visible there. Latest stored delivery activity: September 15. SES reported zero sends in the preceding 24 hours.

The evidence supports an implemented and tested marketing pipeline with very limited usage, not an ongoing broad marketing program. Accounts default marketing preferences on according to current architecture documentation; anonymous quote nurture requires explicit recorded consent. Subscription flags alone do not independently prove consent provenance.

At the initial audit, Cloudflare transactional capability was **configuration-verified only**. The authorized follow-up above now proves fresh support-email delivery and callback persistence. The active `send.masest.co` sending domain, its six authentication/bounce DNS records, the deployed sender restriction, Supabase SMTP configuration (`smtp.mx.cloudflare.net:465`), and inbound `reply.masest.co` routing were checked. These support orders, quotes, invoices, notifications, support alerts, and authentication mail.

The initial historical application ledger had 13 delivered entries with transactional categories, latest September 7 (`messages`), plus one bounce and one complaint. However, `email_events` lacks an explicit provider field, and no received headers were inspected. Older transactional delivery statuses alone could not establish that the current Cloudflare path worked. Supabase Auth delivery is also not proven by those application records; its follow-up test is tracked separately above.

Remaining delivery proof: verify inbox receipt and SPF/DKIM/DMARC headers; reply to the diagnostic support email and confirm its original thread receives it. DNS correctness and provider delivery alone do not prove inbox placement.

### Deferred mailbox comparison (historical research)

The following comparison was researched before the owner decided to retain the existing subscription. Google Workspace remains a possible future choice given the Gmail preference; no purchase or migration is recommended now.

Changing mailbox vendors does not by itself clean up DNS or replace the website's transactional and marketing services. A Google cutover needs mailbox-data migration, account/alias mapping, calendar/contact review, and root MX/SPF/DKIM changes; retain the Cloudflare and SES subdomains.

| Mailbox option | Current US list price per person | Best fit |
|---|---|---|
| Microsoft 365 Business Basic, no Teams | $5.40/month, paid yearly | Lowest listed suite cost here; keep existing Microsoft tenant; web/mobile apps |
| Microsoft 365 Business Basic, with Teams | $7/month, paid yearly | Existing Microsoft users who need Teams |
| Google Workspace Business Starter | $7/month with annual commitment; $8.40 flexible monthly | Team prefers Gmail/Google tools |

Prices checked September 25, 2026; compare tax and purchase terms at checkout. Business Basic does not include a license for desktop Office applications. Existing mailbox size, desktop-app licensing, retention, and security needs could require a different plan. [Microsoft plan pricing](https://www.microsoft.com/en-us/microsoft-365/business/microsoft-365-plans-and-pricing), [Google payment plans](https://knowledge.workspace.google.com/admin/billing/compare-flexible-and-annual-fixed-term-payment-plans).

**Earlier expiry observation, superseded for planning:** the owner initially supplied October 2, 2026. The GoDaddy Products page showed that date for `ceo@masest.co` and an unnamed plan; `barry@masest.co` showed November 13. The owner subsequently confirmed another year of GoDaddy/Exchange service and deferred migration. Billing renewal was not independently rechecked.

The previously cited five-business-day requirement applies to GoDaddy's assisted move of an existing Microsoft tenant to another Microsoft provider. It is not a Google Workspace migration requirement. Google provides an Exchange Online data import workflow; its required source permissions and mailbox coverage must be checked for this GoDaddy-managed tenant. [Google Exchange Online import](https://knowledge.workspace.google.com/admin/migrate/migrate-data-from-an-exchange-online-account), [GoDaddy Microsoft transfer process](https://www.godaddy.com/help/move-my-microsoft-365-email-away-from-godaddy-40094).

### Live Google offer and mailbox count

On September 25, the user's Chrome session displayed this offer on [Google's official US pricing page](https://workspace.google.com/pricing.html?hl=en), with annual commitment selected:

| Plan | First three paid months, per user/month | Thereafter, per user/month | Pooled storage per user |
|---|---|---|---|
| Business Starter | $3.50 | $7 | 30 GB |
| Business Standard | $7 | $14 | 2 TB |

The page advertises a 14-day trial, monthly billing with one-year commitment, and discount applied at checkout. The expanded Starter price details explicitly confirm three discounted months followed by $7. A generic footer on the same page mentions a different 12-month introductory period; rely on the specific offer schedule and verify the final checkout terms before committing. Eligibility and price are not yet confirmed in checkout. No coupon is required by the displayed offer.

The GoDaddy Products tab lists nine named MASEST mailboxes: `ceo`, `barry`, `savi`, `sean`, `sales`, `ap`, `dev`, `mseedial`, and `matthew`, all at `masest.co`. It also shows three available Microsoft 365 accounts at account level and an unnamed plan; these are not proof of three additional active MASEST inboxes. Other-domain products also exist, so cancellation must be scoped carefully.

Nine separate Starter seats would total $31.50/month during the promotion and $63/month thereafter, before tax. At the displayed three-month discount, the first 12 paid months would total $661.50, saving $94.50 against $756 at the regular annual-plan rate. These are scenario estimates, not a finalized seat requirement.

Before buying seats, confirm whether `ceo`, `mseedial`, and `matthew` need independent inboxes or belong to one person. Decide whether `sales` and `ap` need independent mailbox histories/access or can be aliases/distribution addresses. Google permits up to 30 aliases per user at no extra cost; an alias has no separate login or independent inbox. Existing mailbox history still requires a deliberate migration destination. [Google alias guidance](https://knowledge.workspace.google.com/admin/users/overview-add-additional-email-addresses-for-users).

Neither SES nor Cloudflare's forwarding service replaces a staff mailbox with stored mail, calendar, and normal mailbox access. No subscription purchase, signup, or migration has been initiated.

## Confirmed findings

### 1. Root Cloudflare routing conflicts with the intended mailbox owner

`masest.co` currently publishes only these root MX records:

```text
10 mx1-us1.ppe-hosted.com
20 mx2-us1.ppe-hosted.com
```

Its single root SPF record is:

```text
v=spf1 a:dispatch-us.ppe-hosted.com include:secureserver.net -all
```

These records, Outlook Autodiscover, and the Microsoft tenant verification record strongly identify the GoDaddy/Microsoft 365 + Proofpoint arrangement. Mailbox provisioning, licensing, and connector health were not inspected.

Cloudflare's routing API nevertheless reports root routing `enabled: true`, `status: misconfigured`, with `mx.foreign`, `mx.missing`, `spf.foreign`, and `spf.missing` errors. Its `reply.masest.co` subdomain independently reports `ready`, and an enabled rule routes `reply@reply.masest.co` to `masest-email-service`.

**Interpretation:** the dashboard's root routing warning is real, but it does not establish that all mail is broken. There are no competing root MX providers in published DNS. Replacing Proofpoint MX with Cloudflare to clear the warning would divert staff mail away from its current receiver.

Preserve root mailbox MX and the reply subdomain. Cloudflare routing is a zone-level feature; do not disable the whole zone merely to remove the root warning. First establish a supported way to retain subdomain routing, or keep the warning documented while the support path is verified. Sending and routing use separate settings. [Cloudflare subdomain model](https://developers.cloudflare.com/email-service/configuration/subdomains/) and [domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/).

### 2. `masest.us` has two competing DMARC policies

Both the Cloudflare API and its authoritative nameserver return:

```text
v=DMARC1; p=quarantine; pct=75; rua=mailto:dev@masest.co,mailto:matthew@masest.co
v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;
```

Publish one policy after confirming which `.us` senders are intended. Multiple DMARC records are discarded during policy discovery; the second record does not simply override the first. This is a definite authentication-policy defect, not proof of a particular message rejection. [DMARC specification, DNS tree walk](https://www.rfc-editor.org/rfc/rfc9989.html#section-4.10.3).

Cloudflare root and `outreach.masest.us` routing report ready, but the rules API returned only a disabled catch-all drop rule and no enabled forwarding/Worker rule. MX presence alone therefore does not establish a working inbox. `contact.masest.us` also has Cloudflare sending authentication records. Choose whether `.us` is an alias domain, an active correspondence domain, or unused before adding more records.

### 3. Outlook Autodiscover is proxied

`autodiscover.masest.co → autodiscover.outlook.com` is orange-cloud/proxied. Change it to DNS-only in the remediation phase. Cloudflare specifically identifies Autodiscover and mail-service hostnames that must expose their provider target as DNS-only records. [Cloudflare email troubleshooting](https://developers.cloudflare.com/dns/troubleshooting/email-issues/).

Also review proxied `sip`, `lyncdiscover`, `msoid`, `bounces.cloud.em`, `email`, and `_domainconnect` records against their actual provider requirements. Some are legacy or web endpoints; do not classify every one as a proven delivery failure or mass-delete them.

### 4. Current transactional DNS and runtime configuration agree

Live `masest-email-service` allows only `noreply@send.masest.co`, with inbound domain `reply.masest.co`. Cloudflare has `send.masest.co` enabled for sending, return path `cf-bounce.send.masest.co`, selector `cf-bounce`.

All six required sending records match the zone semantically: three bounce MX records, bounce SPF, DKIM, and `_dmarc.send.masest.co`. The initial textual DKIM comparison differed only because long TXT data was split into quoted DNS chunks; the published authoritative public key matches Cloudflare's required key.

Supabase's live Auth configuration uses `smtp.mx.cloudflare.net:465`, sender `noreply@send.masest.co`, and email confirmation enabled. Auth email is already on Cloudflare; it is not currently configured to use Resend.

These are configuration checks, not a fresh delivery test.

### 5. SES marketing DNS and account configuration are verified

The live marketing Worker uses:

```text
AWS_SES_REGION=us-east-1
AWS_SES_FROM_EMAIL=news@marketing.masest.co
AWS_SES_REPLY_TO=dev@masest.co
AWS_SES_CONFIGURATION_SET=masest-marketing
AWS_SES_CONTACT_LIST=masest-marketing
```

Three `marketing.masest.co` DKIM CNAMEs resolve to SES public keys. `bounce.marketing.masest.co` has priority-10 MX to `feedback-smtp.us-east-1.amazonses.com` and `v=spf1 include:amazonses.com ~all`.

There is no explicit `_dmarc.marketing.masest.co`. It inherits the root quarantine policy and strict alignment (`aspf=s; adkim=s`). The bounce subdomain differs from the visible From domain, so strict SPF alignment cannot pass; exact-domain DKIM must carry DMARC. This can work, but gives less redundancy. Recommend a dedicated marketing policy after header verification, retaining quarantine initially and explicitly choosing relaxed SPF alignment for the custom bounce subdomain. Do not weaken the root policy as a shortcut. [SES custom MAIL FROM](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html), [SES DMARC alignment](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html).

The initial AWS CLI session had expired. Reauthentication subsequently succeeded, and the live account/identity/configuration checks are recorded above. The billing plan and end-to-end Worker delivery remain unverified. Worker credentials and CLI credentials are separate; CLI login does not validate the Worker's credentials.

### 6. Legacy records are clutter, not automatically active conflicts

Found Resend tracking/DKIM (`links.masest.co`, `resend._domainkey.masest.co`), SES DKIM on the root domain, old SES-style `send.masest.co` MX/SPF, GoDaddy marketing records, and Apollo tracking (`track.masest.co`).

The old `send.masest.co` MX/SPF is separate from Cloudflare's active `cf-bounce.send.masest.co`; it does not overwrite Cloudflare's return-path records. Likewise, different DKIM selectors can coexist. Root SPF does not need every subdomain sender added to it. No duplicate SPF record was found at any owner in either zone.

Treat legacy records as removal candidates only after checking provider identities, current headers, and external applications. Root SES DKIM could still serve another workflow. Apollo tracking may still be intentional. Local `.dev.vars` retains EmailOctopus settings even though the documented application migration retired that companion; local configuration alone does not prove active production use.

## Proposed cleanup order

1. Export both zones and capture routing rules, sender identities, and mailbox settings before changes. Refresh the snapshot because `.us` configuration was changing around audit time.
2. Set Outlook Autodiscover DNS-only. Consolidate `.us` DMARC into one reviewed policy; create explicit `.us` delivery rules only if that domain should receive mail.
3. Preserve Proofpoint root MX, Cloudflare `reply` routing, and all current Cloudflare `cf-bounce.send` records. Resolve or document the root routing warning without interrupting the support subdomain.
4. Inspect a genuine staff outbound message for `Return-Path`, DKIM `d=`/`s=`, and `Authentication-Results`. Neither Microsoft `selector1` nor `selector2` exists in current DNS; no clearly identifiable Proofpoint mailbox DKIM record was found. Obtain the actual signing records from the active provider, rather than inventing selectors. Check inbound mailbox delivery and connector configuration before changing root SPF/MX. [GoDaddy DKIM setup](https://www.godaddy.com/help/enable-and-add-dkim-to-my-domain-for-microsoft-365-41748).
5. Reauthenticate AWS; run the repository's `npm run verify:ses-production` and inspect current identity/custom MAIL FROM, events, and suppression state. Choose explicit marketing DMARC and a monitored human Reply-To mailbox.
6. With separately authorized test sends, verify staff incoming/outgoing mail, Supabase verification/reset, a transactional notification, a support reply returning to the correct thread, and one consented marketing delivery/unsubscribe. Inspect received authentication headers and provider events. API acceptance alone is insufficient.
7. Remove only proven-unused Resend/old SES/GoDaddy marketing records and local obsolete configuration. Keep an exact rollback record for each removal. Preserve active mailbox, support, and marketing records.

If migrating staff administration away from GoDaddy, preserve mailbox data and tenant identity, validate connectors, obtain the tenant's exact Microsoft MX/DKIM values, then coordinate Proofpoint retirement. GoDaddy documents this as a provider migration with mail-flow prerequisites. [GoDaddy migration guidance](https://www.godaddy.com/help/move-my-microsoft-365-email-away-from-godaddy-40094).

## Cost and management

No new campaign platform is needed for the implemented website workflows: retain MASEST's campaign/consent UI, durable delivery queue, unsubscribe, and suppression handling with SES transport. Use a separate mailbox admin console for staff and one documented DNS inventory in Cloudflare. App-level event/suppression contracts are described in `docs/email-architecture.md` and `docs/email-reliability.md`.

Cloudflare currently includes 3,000 outbound messages per month with Workers Paid, then charges $0.35 per 1,000; Workers and queue costs are separate. [Cloudflare pricing](https://developers.cloudflare.com/email-service/platform/pricing/).

AWS currently lists SES Essentials at $0.16 per 1,000 for the first volume tier, or à-la-carte outbound at $0.10 per 1,000, plus applicable data/features. For 100,000 marketing emails, base sending is approximately $16 or $10 respectively. Do not assume which plan this account uses until checked. Mailbox subscription cost is unchanged under the immediate recommendation. [AWS SES pricing](https://aws.amazon.com/ses/pricing/).

## Evidence limits

Reviewed live Cloudflare DNS, routing configuration, sending-domain configuration, both deployed email Worker settings, authoritative/public DNS, Supabase Auth SMTP settings, repository email architecture, and recent application email-event counts. The 14-day event query returned only four events—two delivered, one bounced, one complained—with the latest on September 15. This tiny sample may include earlier validation activity and cannot establish a current failure rate or broad outage.

The initial read-only audit sent no messages; the subsequent authorized diagnostics and their results are documented above. Staff mailbox access and received headers remain unavailable. The confirmed defects justify targeted remediation; the evidence does not support claiming that every provider is currently preventing every other provider from working.
