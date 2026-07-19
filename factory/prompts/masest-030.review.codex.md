Review Loop Factory spec `masest-030` against current working tree.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-030.md`

        Review stance:
        - Findings first. Focus correctness, regressions, tests, security, maintainability.
        - Compare implementation against acceptance criteria.
        - Run or inspect verification evidence:
        - `node --test --test-timeout=120000 tests/newsletter-batching.test.mjs tests/newsletter-endpoints.test.mjs tests/newsletter-lib.test.mjs`
- `npm run check`
- `npm run verify`
        - If accepted, say `ACCEPTED`.
        - If not accepted, say `CHANGES_REQUESTED` and list blocking items.
        - Do not move files. Operator or CLI archive step moves accepted specs.

        Spec:
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

- Local status: implemented and locally verified; row 030 remains `BLOCKED` until an approved disposable staging campaign proves worker interruption and retry behavior. Do not mark `DONE`.
- Focused Node verification passed 38/38 on 2026-07-19; repository `check` and full `verify` also passed in the final masest-036 sweep.
- Staging execution was approved on 2026-07-19, but redacted preflight found no dedicated staging target. The only accessible Supabase project is the same project referenced by live `https://masest.co/js/config.js`; the only Cloudflare Pages project serves `masest.co`.
- No schema, secret, scheduler, campaign, recipient, worker, DB row, or provider state changed. Applying the delivery schema or queuing a disposable campaign would have changed the production backend, outside the staging-only approval.
- Unblock with a dedicated staging Supabase project plus a staging Pages/runtime environment. Evidence: `factory/runs/masest-029-030-staging-discovery.md`.
- Each retry preserves one provider idempotency key, but recovery after provider success and before the local completion write is bounded by the provider idempotency window. The required staging interruption proof must exercise that seam before acceptance.
