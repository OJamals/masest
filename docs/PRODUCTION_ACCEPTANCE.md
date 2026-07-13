# Production Acceptance Gate

**Purpose:** prove launch readiness for the current MASEST production surface before new feature expansion.

**Current boundary:** this runbook starts with read-only preparation. No live QA records, CMS publishes, Stripe charges, QBO artifacts, or provider cleanup actions happen until the operator explicitly approves the go/no-go checkpoint after preflight.

**Evidence path:** `audits/production-acceptance-2026-06-30/`

**Tracking issue:** https://github.com/OJamals/masest/issues/141

**Disposable QA identity:** `MASEST QA 2026-06-30`

**Payment cap:** live Stripe/QBO acceptance is capped at USD `$1-$5`.

## No-Secrets Evidence Policy

Record only:

- timestamps
- internal row IDs and provider object IDs when they are needed for cleanup
- redacted URLs
- screenshots with sensitive fields masked
- pass/fail notes
- cleanup state
- blockers and exact next action

Never record:

- credentials
- database URLs
- webhook secrets
- provider tokens
- payment card details
- customer PII
- raw provider payloads containing secrets

## Hard Stop Rules

- Stop before live mutation until the operator gives explicit go/no-go.
- Stop if the worktree is dirty with unexplained changes.
- Stop if `origin/main`, local `HEAD`, and the latest Cloudflare Pages production deployment do not point at the same accepted commit.
- Stop if required live-integration config is missing.
- Stop if any provider test creates an artifact that cannot be cleaned up, refunded, voided, archived, or clearly labeled as intentional residue.

## Preflight

Run:

```bash
npm run verify
npm run acceptance:preflight -- --json --cloudflare-env --cloudflare-project masest-commerce --output audits/production-acceptance-2026-06-30/preflight.json
```

Expected:

- `npm run verify` exits 0.
- `acceptance:preflight` exits 0 only when the local tree, `origin/main`, Cloudflare Pages production deployment, and required live-integration env groups are ready.
- The preflight report contains no secret values; local env values appear only as
  `missing` or `set:<length>`, and Cloudflare Pages env values appear only as
  `missing` or `set:cloudflare-<type>`.

Required env groups:

- Supabase operator data source: one complete option from `SUPABASE_DB_URL`, `CONTENT_DB_URL`, or the REST/service-role trio `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY`
- Stripe: `APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- QuickBooks Online: either `QBO_CONNECT_KEY` or the individual set
  `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`,
  `QBO_OAUTH_STATE_SECRET`, `QBO_SYNC_SECRET`, `QBO_ENVIRONMENT`.
  `QBO_INCOME_ACCOUNT_ID` is optional; sync auto-detects an Income account
  from the connected QuickBooks company when it is omitted.
- CMS publish: one of `CONTENT_PUBLISH_HOOK_URL` or `CF_PAGES_DEPLOY_HOOK_URL`

The Supabase operator data source proves the local acceptance runner can read/write the production data store during the approved live pass. The live app runtime must still be verified through deployed app paths such as `/api/health`, dashboard/admin actions, and the provider flows in the checklist.

For a local operator-only env check, use `--skip-pages` explicitly. Production
readiness requires `--cloudflare-env`; it reads encrypted Pages env metadata and
the latest production deployment directly from Cloudflare.

## Go/No-Go Checkpoint

Before live mutation, paste a short checkpoint summary:

```text
Production acceptance checkpoint
- Commit under test:
- Pages build status:
- Preflight report:
- QA identity:
- Payment cap:
- Known residue plan:
- Requested approval: create QA account/company, CMS temporary entry, live Stripe payment/refund, QBO artifact, customer chat message
```

Wait for explicit operator approval.

## Live Acceptance Checklist

- [ ] Freeze commit: `HEAD`, `origin/main`, and Pages build match.
- [ ] Apply `supabase/schema-business-profile.sql`, then `supabase/schema-account-company.sql`; verify `create_company_for_user(uuid, jsonb)` exists before deploying the matching Function.
- [ ] Create disposable QA account/company only.
- [ ] Verify Supabase mutations through app paths, not direct SQL only.
- [ ] Verify buyer dashboard overview, orders, messages, notifications, addresses, payment portal, and team/profile state.
- [ ] Verify `dashboard.html#business` setup, programs, bulk/order/account prompts, and embedded guest state.
- [ ] Verify admin dashboard overview, orders, companies, CRM contacts/tasks/timeline, CMS content, products/pricing, QBO status, traffic, quotes, messages, and offers.
- [ ] Publish one harmless temporary CMS entry, regenerate/export if required by the commit-gated workflow, verify live render, verify revision history, then remove/restore it.
- [ ] Complete one live capped Stripe checkout and verify webhook order persistence.
- [ ] Refund or reverse the Stripe test payment and verify order/refund state.
- [ ] Sync the QA order to QBO as invoice/payment or the correct order document.
- [ ] Create the matching QBO refund/credit memo, void, or clearly labeled cleanup state.
- [ ] Send one authenticated customer chat message and one admin reply.
- [ ] Verify the message appears in Admin → Messages and the reply appears in the customer chat thread.
- [ ] If Resend Receiving is configured, reply directly to the admin email and verify it appears in Admin → Messages and the buyer dashboard thread.
- [ ] Verify anonymous, buyer, company admin, staff read-only/support/finance/owner boundaries for protected surfaces and mutations.
- [ ] Verify controlled failure paths: invalid checkout line, CMS validation rejection, unauthorized API call, and customer-chat authentication gating.
- [ ] Run focused accessibility/performance checks: core public pages, dashboard/admin/CMS/CRM keyboard flow, mobile overflow, and no hung dashboard/API states.

## Cleanup Checklist

- [ ] Temporary CMS entry removed/restored and snapshot state documented.
- [ ] QA Stripe payment refunded or documented with exact residual state.
- [ ] QBO invoice/payment/refund/void artifact cleaned up or clearly marked as QA residue.
- [ ] QA CRM/company/contact/order records archived, labeled, or documented for retention.
- [ ] Evidence artifact lists every live object ID needed for later cleanup.
- [ ] Blockers are converted into issues before new feature work resumes.

## Controlled Failure Paths

Use harmless failures only:

- invalid checkout quantity or SKU rejected before payment creation
- CMS invalid payload rejected before publish
- unauthorized buyer/admin mutation rejected
- QBO retry/status check through existing failed-row handling only if a safe QA row exists

Do not force destructive production provider failures.

## Blocker Policy

Any failed live gate blocks feature expansion. The next development task becomes one of:

- fix the failing integration
- add missing runbook/provider setup
- add a regression test for the failed contract
- rerun the failed acceptance slice after cleanup
