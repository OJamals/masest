# Email reliability runbook

Email is a durable side effect of a committed business change. The application
commits the canonical row and its integration-effect intent together; the shared
integration-effect worker reloads the canonical source data, applies the effect
allowlist, checks suppression and consent state, and performs provider delivery
with a stable idempotency key. Source and effect identities remain stable for
retries, while recipient resolution follows each workflow's contract: support
pins its first-send envelope, quote delivery uses a private immutable
`integration_effects.source_snapshot`, order mail resolves current operational
recipients and suppression state, marketing delivery rechecks current
eligibility, and campaign delivery retains its occurrence source ID and
per-recipient ledger identity. This runbook describes
the implementation rollout; it does not claim that production delivery or
provider access has been verified.

The detailed support and quote contract is in
[Durable support and quote communication](email-reliability-communication.md).

## Policy by workflow

- Support messages and quote intake persist first. Their transactional effects
  are delivered by the worker. A temporary readiness failure returns `503`
  with `retryable: true` before a write, so a partial rollout cannot create a
  canonical row without its durable effect.
- Order tracking and return-label finalization enqueue effects in the same
  transaction as the order mutation. Order mail remains mandatory; legacy
  order notification opt-outs do not suppress required operational recipients.
  Return-label retries reuse the captured provider URL and operation identity,
  so they do not purchase another label.
- Quote nurture is created only when intake records marketing consent. An
  immutable private `integration_effects.source_snapshot` preserves the saved
  quote content for rendering. An unsubscribe or suppression remains
  authoritative when the worker materializes and sends the effect; the original
  consent timestamp is retained for audit.
- Newsletter and blog delivery continue to use the existing marketing ledger
  and immutable delivery-source rows. Preparation leases protect the interval
  before source and recipient rows exist. Expired leases can be reclaimed, but
  the stored occurrence source ID and next schedule are retained. Active blog
  leases are excluded before the bounded sweep limit. The Cloudflare
  `masest-marketing-email` worker owns scheduled-newsletter and recovery sweeps
  on its every-five-minute cron; the GitHub workflow is a manual recovery
  fallback. Blog sweeps remain tied to completed content deployment.

## Required baseline

Install the schemas that provide the shared effect store, canonical workflow
rows, and existing marketing ledger before the reliability migrations:

- `supabase/schema-integration-events.sql`
- `supabase/schema-provider-inbox.sql` and
  `supabase/schema-integration-effect-handlers.sql`
- `supabase/migrate-support-participant-threads-2026-09-03.sql`
- `supabase/schema-notification-prefs.sql`
- `supabase/schema-quotes.sql` and `supabase/schema-quote-lifecycle.sql`
- `supabase/schema-newsletters.sql` and
  `supabase/schema-blog-newsletter.sql`, plus the existing marketing queue
  migrations that provide `newsletter_delivery_sources` and delivery rows

Verify that the shared integration-effect dispatcher and the marketing ledger
are present before applying the workflow-specific migrations.

## Rollout order

1. Deploy the application code and integration-effect worker first. The code
   must fail closed when its preparation or readiness RPC is absent; it must
   not fall back to inline provider delivery.
2. Apply
   `supabase/migrate-support-email-envelope-2026-09-05.sql`. It stores the
   first-send envelope on the private canonical effect so retries preserve the
   original recipient and reply context.
3. Apply
   `supabase/migrate-durable-support-message-effects-2026-09-05.sql`. Verify
   the support-message and quote-intake readiness checks before serving writes.
4. Apply
   `supabase/migrate-durable-order-email-effects-2026-09-05.sql`. Its
   readiness gate protects return-label finalization before any provider call.
5. Apply
   `supabase/migrate-campaign-preparation-recovery-2026-09-05.sql`. This adds
   lease-safe preparation recovery for newsletter and blog campaigns and keeps
   materialization fenced to the current lease.

During any partial rollout, a missing readiness function or trigger is an
intentional temporary `503` boundary. Resolve the migration order and verify
readiness before retrying writes. Drain old workers before retiring an inline
delivery path. No step in this document authorizes a production migration,
provider call, or deployment by itself.

## Operational invariants

The worker owns provider transport and effect allowlists. Business handlers own
canonical persistence and enqueueing. Effects contain identifiers and bounded
metadata; delivery reloads the source snapshot rather than trusting mutable
request data. Suppression and consent checks happen at the durable delivery
boundary, while mandatory order recipients remain unchanged. Recovery and
retries preserve the original source, occurrence, and idempotency identities.
Support envelope fields are pinned only where the support contract
requires them; order operational recipients and marketing eligibility are
resolved from current state. Quote rendering uses the private saved snapshot,
while quote nurture still honors current consent and suppression state.
