Review Loop Factory spec `masest-037` against current working tree.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-037.md`

        Review stance:
        - Findings first. Focus correctness, regressions, tests, security, maintainability.
        - Compare implementation against acceptance criteria.
        - Run or inspect verification evidence:
        - `node --test tests/integration-events-schema.test.mjs tests/stripe-effects.test.mjs`
- `node tools/verify-integration-events-db.mjs --live-cycle`
- `npm run check`
- `git diff --check`
        - If accepted, say `ACCEPTED`.
        - If not accepted, say `CHANGES_REQUESTED` and list blocking items.
        - Do not move files. Operator or CLI archive step moves accepted specs.

        Spec:
        ---
        # Grill Gate

- Owner: MASEST maintainer; user already approved deeper website, shipping, Stripe, Intuit, CMS/CRM integration.
- Problem: provider receipts and asynchronous side effects use separate ledgers, making idempotency, replay, audit, and operations inconsistent; foundation is needed before broader fulfillment and financial automation.
- Out of scope: caller cutover; live label purchase; QuickBooks production posting; raw provider request bodies, secrets, tokens, payment credentials, or customer PII in the ledger; re-keying existing orders; compatibility wrappers.
- Review failure: migration changes any existing Stripe effect identity/status/dependency/attempt/provider-success value; duplicate provider event identities become possible; leases or dependency transitions weaken; public roles can access tables/RPCs; no executable rollback; tests/check fail.
- Riskiest assumption: live Stripe effect rows can be represented one-for-one while preserving every retry and provider-success acknowledgement semantic.
- Smallest acceptable: additive generic tables, service-only RPCs, exact live-row migration SQL, verification queries/checksum, and rollback; existing workers continue using the old ledger until `masest-038`.

# Context

Current production has 11 completed `stripe_webhook_effects`, zero `shipment_events`, 17 `email_events`, zero duplicate non-null Resend IDs, zero QBO refund/subscription queue rows, and five orders with QBO state null/skipped. Task 13.2 requires one provider inbox/outbox with duplicate/out-of-order protection, dependent effects, full-jitter retry, terminal state, replay, and immutable audit history. This slice establishes storage and migration without changing runtime callers.

# Acceptance Criteria

- `integration_events` stores provider, provider event identity, provider event type, source occurrence time, receipt time, immutable payload digest, sanitized bounded metadata, processing state, lease, attempt, error, terminal, and audit timestamps.
- Unique `(provider, environment_or_tenant, provider_event_id)` rejects duplicate Stripe, ShipStation, QuickBooks, and Resend receipts without conflating test/prod or separate QuickBooks realms.
- `integration_effects` stores event-scoped effect identity, type, bounded sanitized payload, dependency, processing state, lease, attempts, retry time, provider-success acknowledgement/result, error, completion, terminal, and audit timestamps.
- Unique `(event_id, effect_key)` plus same-event dependency FK preserves current dependency semantics.
- Effect types are extensible via bounded validated text, not a provider-specific enum; payload checks reject keys matching raw payload, secret, token, API key, signature, authorization, card, or bank credentials.
- Service-only RPCs atomically ingest events, enqueue effects, claim due effects with `FOR UPDATE SKIP LOCKED`, record provider success, complete, fail with exponential backoff plus full jitter, terminalize, and replay terminal effects without erasing history.
- Event/effect identity, payload digest, provider-success acknowledgement, original creation time, and completed/terminal audit facts are immutable by triggers.
- RLS enabled; `anon` and `authenticated` have no table or RPC execution rights; `service_role` has only required rights.
- Migration maps every existing `stripe_webhook_effects` row one-for-one under a Stripe integration event while preserving event ID, effect key/type/payload/dependency, state, attempts, availability, lease, provider success/result, error, completion/dead, and timestamps.
- Migration includes deterministic row-count and canonical checksum parity queries. It fails closed on collisions or unmappable rows.
- Rollback removes only generic migrated objects and leaves original `stripe_webhook_effects` and its worker path unchanged.

# Constraints

- Preserve current `stripe_webhook_effects` table/RPCs and all JavaScript callers in this slice.
- Use existing Supabase/Postgres conventions. Own the minimal updated-at trigger locally because production has no shared `public.touch_updated_at()` function.
- No permanent wrapper, dual-write, provider call, or production behavior change.
- Schema must be rerunnable where safe and fail closed where silent remapping would lose evidence.
- Read existing schema before edits; use repository codebase-memory graph first.
- Apply production migration only after transactional forward/rollback proof and exact baseline snapshot.

# Review Notes

- Test hostile duplicates, cross-event dependency attempts, expired lease recovery, concurrent claims, provider-success-before-DB-ack replay, capped retry, terminal replay, immutability, RLS, grants, migration parity, and rollback.
- Compare generic rows against all existing Stripe effect columns, not row count alone.
- Confirm full jitter range is bounded and deterministic tests inject/validate boundaries without weakening production randomness.
