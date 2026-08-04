Review Loop Factory spec `masest-039` against current working tree.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-039.md`

        Review stance:
        - Findings first. Focus correctness, regressions, tests, security, maintainability.
        - Compare implementation against acceptance criteria.
        - Run or inspect verification evidence:
        - `node --test tests/integration-provider-inbox.test.mjs tests/shipstation-webhook.test.mjs tests/resend-webhook.test.mjs tests/qbo-webhook.test.mjs`
- `npm run check`
- `npm run build`
- `npm run verify:site`
- `git diff --check`
        - If accepted, say `ACCEPTED`.
        - If not accepted, say `CHANGES_REQUESTED` and list blocking items.
        - Do not move files. Operator or CLI archive step moves accepted specs.

        Spec:
        ---
        # Grill Gate

- Owner: MASEST maintainer; user approved unified shipping, finance, website, CMS/CRM operations.
- Problem: ShipStation tracking, QuickBooks change notifications, and Resend delivery events need same receipt identity, acknowledgement, retry, replay, and audit model as Stripe.
- Out of scope: new label-purchase UI; QBO production posting; payout settlement; email template redesign; guest order lookup; broad admin redesign.
- Review failure: provider acknowledgement exceeds provider deadline; signature/token validation weakens; duplicate/out-of-order events mutate state twice; current normalized tracking/email/QBO behavior changes; raw PII/secrets enter ledger; no operator replay/evidence.
- Riskiest assumption: three providers expose sufficient stable event identity to deduplicate without treating distinct updates as duplicates.
- Smallest acceptable: validate each provider, derive documented canonical event ID/digest fallback, ingest sanitized receipt, enqueue existing normalized effect, acknowledge quickly, process once, expose bounded admin health/replay, preserve provider-specific state tables only where they remain domain records rather than queue infrastructure.

# Context

ShipStation currently applies tracking directly through `shipment_events`; Resend writes delivery state directly through `email_events`; QBO has outbound refund/subscription queues but no unified inbound notification receipt. After `masest-038`, generic event/effect infrastructure is production-proven by Stripe. This slice cuts provider receipts without expanding financial or fulfillment product scope.

# Acceptance Criteria

- ShipStation webhook token validation remains constant-time; a stable provider event identity or canonical digest is ingested before one tracking-normalization effect is queued.
- Tracking fetch and webhook payloads converge through same normalization function and idempotent domain mutation.
- Resend signature verification remains intact; provider event identity is unique locally beyond provider idempotency windows; one delivery-state effect updates `email_events`, suppression, and CRM communication timeline.
- QuickBooks webhook verifier validation and `intuit_tid` audit are implemented; endpoint acknowledges accepted notifications under three seconds and queues one effect per realm/entity/change identity.
- Duplicate/out-of-order ShipStation, Resend, and QuickBooks inputs process once; stale events remain immutable history but cannot regress newer domain state.
- Fallback IDs use canonicalized, versioned, privacy-bounded digests; raw provider request bodies, addresses, email content, auth headers, signatures, tokens, and financial credentials are excluded.
- Generic retry/dead/manual replay semantics apply; replay is audited with actor/reason and does not overwrite original receipt/effect history.
- Admin integration health exposes provider freshness, pending/dead counts, oldest age, last sanitized error, unmatched order/provider link count, and permission-gated replay. No secret or raw payload is returned.
- Obsolete provider-specific queue/RPC paths are removed after parity. Domain records (`shipment_events`, `email_events`, QBO document/link fields) remain authoritative business history.
- Production smoke uses Chrome DevTools in existing authenticated browser, not Playwright.

# Constraints

- Depends on accepted `masest-038`.
- Follow current official provider docs captured in repository research artifact; document inference where provider lacks a stable event ID.
- Provider webhook path must validate before ingest; invalid requests create no event/effect.
- No live QBO mutations, label purchase, shipment cancel, or customer email send during tests/smoke.
- Preserve order/provider identity ledger from Task 13.1 and existing permission vocabulary.

# Review Notes

- Test forged signatures/tokens, duplicate bodies, reordered timestamps, collision-resistant canonicalization, same provider ID across providers, concurrent claims, replay, late event suppression, and PII/secret rejection.
- Confirm provider HTTP acknowledgement deadlines and retry expectations against official docs.
- Confirm admin endpoints enforce auth, role permissions, bounded pagination, and safe errors.
