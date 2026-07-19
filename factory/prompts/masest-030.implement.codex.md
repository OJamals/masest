You are implementing Loop Factory spec `masest-030`.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-030.md`
        Spec hash: `4fe7bc2e82b08328b7eedf07a0513e336ea4fe9ded564c9fe15aaedfa37303cf`

        Operating rules:
        - Treat spec as source of truth.
        - Automate code generation and verification, not product decisions.
        - If spec is ambiguous, make smallest reversible assumption and record it in implementation notes.
        - Keep changes scoped to acceptance criteria.
        - Update living spec only for facts learned from implementation or tests.
        - Do not archive spec. Review step does that.
        - Use Codex subagents when work splits cleanly. Ask explicitly before spawning. Keep final answer terse with files changed and checks run.

        Required verification:
        - `node --test --test-timeout=120000 tests/newsletter-batching.test.mjs tests/newsletter-endpoints.test.mjs tests/newsletter-lib.test.mjs`
- `npm run check`
- `npm run verify`

        Deliverables:
        1. Implement acceptance criteria.
        2. Run verification commands or explain why unavailable.
        3. Add notes under `factory/runs/` or in final response: changed files, checks, open risks.
        4. Leave spec in `factory/specs/active/` for review.

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
