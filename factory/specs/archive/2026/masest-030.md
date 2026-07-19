---
id: masest-030
title: Queue newsletter delivery with a durable recipient ledger
agent: codex
risk: high
grill: completed
verification:
  - node --test --test-timeout=120000 tests/newsletter-batching.test.mjs tests/newsletter-endpoints.test.mjs tests/newsletter-lib.test.mjs
  - npm run check
  - npm run verify
---

# Grill Gate

- Owner: maintainer.
- Decision source: maintainer selected materialized audiences, per-recipient state, and initial concurrency 5; production scheduler/migration remains operator-owned.
- Problem: request-time sequential fanout can time out after partial delivery and diverge from campaign completion state.
- Out of scope: audience/consent/suppression/template changes, external queue vendors, production execution, provider changes, and editor redesign.
- Review failure: handlers still fan out, recipients duplicate, completion ignores ledger truth, retries lose idempotency, worker is unbounded, or staging/gates fail.
- Riskiest assumption: provider idempotency retention spans the required retry window.
- Smallest acceptable: materialize unique deliveries, return 202, and process them through a bounded lease-safe worker shared by admin/blog mechanics.

# Context

Admin newsletters can sequentially send 500 recipients inside one request; blog newsletters repeat nested fanout. Durable rows must separate campaign/audience composition from transport and make interruption/retry observable.

# Acceptance Criteria

- Materialize recipient rows once per campaign or blog post.
- Unique delivery key uses source plus normalized email; case-insensitive overlap deduplicates.
- Send-now returns 202 after queue creation and performs no recipient fanout.
- Worker claims bounded rows with leases; concurrency starts at 5.
- Per-recipient state supports `pending`, `processing`, `sent`, `suppressed`, `retry`, and `dead`.
- Retry/backoff handles Resend 429/500/network failure and preserves provider idempotency key.
- Campaign/post totals and completion derive from ledger; completion occurs only after all rows are terminal.
- Admin and blog flows share delivery mechanics while retaining distinct composition/audience rules.
- Tests cover empty/overlapping audiences; sizes 1, 5, 6, 500, and over 500; duplicate cron; lease expiry; suppression; provider errors; and partial blog failure.
- Staging queues a disposable campaign and proves interrupt/retry behavior.
- Frontmatter verification commands pass; mark row 030 `DONE` only after approved staging proof.

# Constraints

- Dependencies: `masest-019`, `masest-021`, and `masest-025` must be accepted first.
- Scope: additive newsletter/blog schema, new shared delivery library, admin/blog handlers, focused tests, secret/config names only in `.env.example`, and row-030 status.
- Do not change audience membership, consent, suppression streams, templates, provider, rate limits, editor, or adopt an external queue.
- Do not execute production migration/cron without approval.
- STOP if audience must be reevaluated dynamically after start, provider idempotency cannot cover retries, scheduler/secret ownership is undefined, or post-queue content edits need product policy.

# Review Notes

- Inspect unique keys, normalized-email behavior, leases, bounded concurrency, retry transitions, and ledger-derived totals.
- Require interruption evidence and prove request handlers return before transport begins.

# Implementation Notes

- Accepted on 2026-07-19 after independent review of the isolated staging interruption/retry proof. Row 030 is `DONE`.
- Focused Node verification passed 38/38 on 2026-07-19; repository `check` and full `verify` also passed in the final masest-036 sweep.
- The disposable staging campaign normalized three recipient variants into exactly one delivery. The worker reclaimed it after an intentional post-provider crash and completed it on attempt 2 with the original provider message ID.
- Independent staging queries confirmed source totals 1/1/0/0, a terminal `sent` parent, and a released lease. Production remained on a distinct Supabase project and Pages project.
- Evidence: `factory/runs/masest-029-030-staging-proof.md`.
- Each retry preserves one provider idempotency key. The accepted staging proof exercised recovery after provider success and before the local completion write within the provider idempotency window.
