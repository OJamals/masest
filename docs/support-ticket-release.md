# Support ticket release runbook

This runbook covers the support-ticket database and application cutover introduced by
the 039-042 support slices. It is an operator procedure, not authorization to change a
database, deploy an application, send mail, or delete test data.

## Current release status

Production release is not authorized by this document. Staging acceptance is also
blocked until all of the following are proven and approved:

- the target has an authoritative nonproduction identity that is demonstrably distinct
  from production;
- the test owns an exclusive integration-event/effect ledger, with no unrelated worker
  able to claim its rows;
- mail is routed to a receipt-capable test sink that can prove provider acceptance and
  the received message without contacting a real customer;
- the operator can trigger one controlled retry with the same durable identity after
  the intended interruption point; and
- a named owner has approved the privileged cleanup of the test messages, tickets,
  events, effects, envelopes, notifications, and any test identity; and
- the deployed signed inbound-email bridge can be exercised against that isolated
  identity and sink. Local HTTP signature or SQL RPC tests are not live bridge proof.

Do not substitute a successful HTTP response, a shared inbox, a production address, or
manual deletion for these gates. There is no staging command in this runbook while the
gates remain blocked.

The existing service role cannot directly update or delete ticket events, and the
shared effect ledger is not an authorized fixture-cleanup API. Cleanup must preserve
those protections: a separately approved privileged mechanism must identify the owned
fixture graph and delete through its permitted parent relationships, while proving that
no unrelated ledger row is claimed or removed.

## Canonical ownership and prerequisites

- `support_threads` remains the participant/company conversation identity.
- `support_tickets` owns independently managed support episodes beneath a thread.
- `messages.ticket_id` binds every message to its exact ticket after cutover.
- `integration_events` and `integration_effects` are the exclusive durable delivery
  ledger. `support_message_email_envelopes` stores the immutable delivery envelope.
- Pages Functions own `/api/account/messages` and `/api/admin/messages`; the matching
  static dashboard/admin assets must ship in the same Pages deployment.

Before applying 039, confirm that `supabase/schema-phase5.sql`,
`migrate-support-participant-threads-2026-09-03.sql`, and
`schema-integration-events.sql` are already installed. Stop if any prerequisite,
expected table, role, function, constraint, or migration check is absent or ambiguous.
Their prerequisite order is `schema-phase5.sql`,
`migrate-support-participant-threads-2026-09-03.sql`, then
`schema-integration-events.sql`; 039 follows that completed baseline.

## Local verification

PostgreSQL server binaries are required in addition to the Node `pg` client. The
verifier creates and removes its own temporary loopback cluster; it must never receive a
remote database URL or connect to a shared PostgreSQL service.
The harness supports PostgreSQL majors 16, 17, and 18. An explicitly supplied
`PG_BIN` outside that range is an error and is never replaced by a PATH fallback.

```bash
export PG_BIN="${PG_BIN:-$(pg_config --bindir)}"
test -x "$PG_BIN/initdb"
test -x "$PG_BIN/pg_ctl"
test -x "$PG_BIN/postgres"
"$PG_BIN/postgres" --version
npm run qa:support-tickets:db
```

On the current Homebrew installation, the explicit local value is:

```bash
export PG_BIN=/opt/homebrew/opt/postgresql@18/bin
npm run qa:support-tickets:db
```

The canonical package command maps to
`node tools/verify-support-tickets-db.mjs`. A nonzero exit, failed owned-cluster
shutdown, missing cleanup proof, or retained temporary cluster is a release stop. Do not
fall back to a remote Supabase database to make the local gate pass.

## Migration order and traffic boundary

Every migration is transactional and must be applied with `ON_ERROR_STOP`, bounded lock
waits, and a bounded statement timeout. Never concatenate, reorder, or partially copy
their SQL bodies.

0. **Reversible write fence:** `supabase/migrate-support-write-fence-2026-09-07.sql`
   installs the one-time DDL drain and the transaction-held control-row protocol.
   Install it while accepting writes, then close it with the operator-only generation-CAS
   function immediately before 040. The application service role cannot operate the fence.
1. **039 — additive:** `supabase/migrate-support-tickets-2026-09-06.sql`
   creates/backfills ticket episodes and nullable message ownership. Runtime message
   routing remains thread-owned at this point.
2. **040 — cutover installation:**
   `supabase/migrate-support-ticket-routing-2026-09-06.sql` locks existing writers,
   completes the backfill, makes `messages.ticket_id` required, installs replacement
   RPCs, and leaves `support_ticket_routing_contract.version = 1`. Version 1 protects
   old caller shapes; it is not the final activation.
3. **041 — live-compatible future-only delivery effects:**
   `supabase/migrate-support-ticket-live-cutover-2026-09-07.sql` refuses undrained
   predecessor support-email effects, retires the predecessor message triggers before
   replacing their shared function, and installs the single ticket-owned
   `support_message_email` effect/envelope contract. It preserves completed/dead legacy
   ledger history and does not synthesize delivery effects for earlier messages.
4. **042 — queue and optimistic mutation contracts:**
   `supabase/migrate-support-ticket-queue-2026-09-06.sql` installs bounded ticket-list
   pagination and the final exact-ticket reply/update RPC shapes.

039 may be installed before the traffic pause because it is additive and leaves runtime
routing unchanged. Before 040, pause every support write path, including buyer/admin
dashboard writes, order-support creation, inbound email replies, and any worker capable
of appending a support message. Drain already-running callers. Keep support ingress
paused through 040, 041, 042, the Pages deployment, old-instance drain, and activation;
otherwise a message can cross a mixed contract or miss 041's future-only delivery
trigger.

With the database URL loaded into the operator environment rather than written into the
shell history, apply the four files in this exact order:

```bash
set -euo pipefail
: "${PG_BIN:?set PG_BIN to the approved PostgreSQL binary directory}"
: "${SUPABASE_DB_URL:?supply the explicitly approved target database URL}"
export PGOPTIONS='-c lock_timeout=5s -c statement_timeout=120s'
"$PG_BIN/psql" "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrate-support-write-fence-2026-09-07.sql
"$PG_BIN/psql" "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrate-support-tickets-2026-09-06.sql
"$PG_BIN/psql" "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrate-support-ticket-routing-2026-09-06.sql
"$PG_BIN/psql" "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrate-support-ticket-live-cutover-2026-09-07.sql
"$PG_BIN/psql" "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrate-support-message-delivery-effects-2026-09-06.sql
"$PG_BIN/psql" "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrate-support-ticket-queue-2026-09-06.sql
```

Stop on the first error. Do not activate version 2 after a partial sequence.

## Application and asset cutover

1. If the same release changes a separately versioned email Worker, deploy that Worker
   first as required by `CLOUDFLARE_PAGES.md`; the Pages workflow does not deploy email
   Workers.
2. While ingress remains paused and the routing contract remains at version 1, deploy
   the verified commit containing the matching Pages Functions and the static
   dashboard/admin assets. Do not publish either half from a different commit.
   Record the deployment commit, allow the existing cache-busted assets to settle, and
   verify that the served dashboard/admin assets and Functions belong to that same
   commit before continuing. A cache purge is a separate operator action, not an
   automatic substitute for commit parity.
3. Wait for every old Pages Functions instance to drain. A successful deployment record
   alone is not old-instance-drain proof.
4. Confirm the deployed application is the version-2 caller and that the routing row is
   still exactly version 1. Do not infer readiness from an empty queue.
5. Under separately approved database authority, activate exactly once:

   ```sql
   select public.activate_support_ticket_routing(1);
   ```

   The result must report version 2. Any version conflict or unexpected result is a
   release stop.
6. Resume support ingress only after the version-2 result is recorded. Observe the first
   controlled writes and their durable delivery states before widening traffic.

## Monitoring and stop conditions

Monitor the durable ledger directly. `integration_effects.status` uses `pending`,
`processing`, `completed`, and `dead`; a pending row with prior attempts is retry work.
The following query reports those operational buckets without exposing envelope data:

```sql
select case
         when effect.status = 'pending' and effect.attempt_count > 0 then 'retry'
         else effect.status
       end as state,
       count(*) as effects,
       min(effect.available_at) as oldest_available_at,
       max(effect.attempt_count) as max_attempts
  from public.integration_effects effect
  join public.integration_events event on event.id = effect.event_id
 where event.provider = 'masest'
   and event.provider_event_type = 'support.message.created'
   and effect.effect_type = 'support_message_email'
 group by 1
 order by 1;
```

Investigate growth or age in `pending`/`retry`, expired `processing` leases, any `dead`
row, or repeated sanitized `last_error_code` values. Do not delete, re-key, or replay a
row merely to clear the count; controlled replay requires an identified effect, a
recorded reason, and explicit operator authority.

Monitor responses from the existing `/api/account/messages` and
`/api/admin/messages` routes:

- `409 support_ticket_routing_not_enabled` is expected only while the version-1 gate is
  deliberately closed. It is a release fault after activation.
- `409 ticket_version_conflict` and `409 ticket_resolved` are fail-closed optimistic
  concurrency outcomes. A sustained increase after deployment suggests stale UI or a
  mixed application version and requires investigation, not an automatic retry.
- Any sustained 5xx response, missing `ticket_id`, or `email_delivery.state = dead`
  stops the rollout. A committed message must not be resent to repair its email effect;
  reconcile the existing durable effect instead.

## Bounded rollback

Prefer application containment and roll-forward repair over destructive schema
rollback.

- **Before activation:** keep the routing contract at version 1, keep ingress paused,
  deploy the prior matching Functions/assets if necessary, and diagnose the additive
  database state. Do not remove 039-042 objects or their backfilled identities.
- **After activation:** there is no checked-in downgrade operation. Activation is
  monotonic, and version-1 callers are intentionally retired. Deploying old code after
  version 2 can turn writes into failures; keep ingress paused and use a separately
  reviewed roll-forward or privileged database recovery procedure.
- Preserve tickets, ticket events, messages, integration events/effects/attempts,
  delivery envelopes, notifications, and sanitized error evidence. They are required
  for reconciliation and audit.
- 041 is future-only. Removing its trigger or ledger does not recreate effects for the
  resulting gap and can create duplicate or missing mail if reapplied casually.
- Never restore a schema-only dump wholesale over post-cutover data. Any destructive
  cleanup or data restore requires a separate maintenance plan, a current data backup,
  explicit authority, and reconciliation of every pending, retry, processing, or dead
  effect first.
