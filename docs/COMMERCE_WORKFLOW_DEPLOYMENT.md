# Commerce workflow database deployment

This runbook deploys Checkout fulfillment contracts, authoritative shipment labels,
transactional Order reversals, and Quote Checkout attempts. Migrations are additive,
transactional where they backfill state, and safe to re-run.

## Preconditions

- Stop no provider manually, but do not run live label/refund tests during migration.
- Keep `SUPABASE_DB_URL` only in `.dev.vars`; never print it or pass it as a literal command argument.
- Capture a schema backup before applying changes:

  ```bash
  set -a
  source .dev.vars
  set +a
  /opt/homebrew/opt/libpq/bin/pg_dump \
    --dbname="$SUPABASE_DB_URL" \
    --schema=public \
    --schema-only \
    --no-owner \
    --no-privileges \
    --file=_local/backups/commerce-workflow-predeploy.sql
  chmod 600 _local/backups/commerce-workflow-predeploy.sql
  ```

- Confirm baseline owners exist before migration: `orders`, `order_items`, `order_shipments`,
  `order_provider_links`, `order_financial_entries`, `shipment_events`, `integration_events`,
  `integration_effects`, `audit_log`, `quotes`, and `increment_variant_stock`.

## Migration order

Apply with `ON_ERROR_STOP=1`, a bounded `lock_timeout`, and a bounded `statement_timeout`:

1. `supabase/schema-checkout-shipping-quotes.sql`
2. `supabase/schema-quotes.sql`
3. `supabase/schema-integration-effect-handlers.sql`
4. `supabase/schema-shipment-label-ownership.sql`
5. `supabase/schema-provider-inbox.sql`
6. `supabase/schema-order-reversals.sql`
7. `supabase/schema-quote-lifecycle.sql`

Files with their own `begin` / `commit` must run directly. Wrap the three older non-transactional
files—`schema-quotes.sql`, `schema-integration-effect-handlers.sql`, and
`schema-provider-inbox.sql`—with `psql --single-transaction`.

Re-run all seven once. Every command must exit zero. This proves forward idempotency against
the installed schema rather than only against static SQL.

## Post-migration verification

Verify:

- `order_shipment_label_ownership`, `shipstation_operation_attempts`,
  `order_reversal_commands`, `order_reversal_lines`, `quote_checkout_attempts`, and
  `quote_checkout_attempt_cutover` exist;
- `orders.updated_at` and `orders.reversal_revision` exist;
- all new tables have RLS enabled;
- `anon` and `authenticated` cannot execute internal mutation RPCs, while `service_role` can;
- all target constraints and public indexes are valid;
- pre/post counts for Orders, Quotes, shipments, provider links, and financial entries match
  expected backfills;
- `quote_checkout_attempt_cutover.ready = false` until application cutover completes.

## Quote Checkout activation

Database migration deliberately disables new Quote Checkout attempts. Next:

1. Deploy matching application code.
2. Drain every old Worker instance.
3. Re-check that every pre-migration Quote Stripe Checkout Session is terminal or absent.
4. Enable the singleton gate:

   ```sql
   update public.quote_checkout_attempt_cutover
      set ready = true,
          ready_at = now(),
          updated_at = now()
    where singleton = true;
   ```

5. Confirm one accepted Quote can create exactly one attempt/Session and an identical retry
   reuses it.

Do not enable the gate merely because `quotes` is currently empty; an old application instance
could still create a legacy Session before it drains.

## Bounded rollback

Prefer application rollback over destructive schema rollback:

1. Set `quote_checkout_attempt_cutover.ready = false`.
2. Stop integration-effect, QBO, and provider-inbox workers before rolling application code back.
3. Deploy the prior Functions/UI version.
4. Keep additive tables, immutable provider links, financial entries, attempts, reversal commands,
   and audit rows. They are recovery evidence; never drop them during an incident.
5. Reconcile any `provider_succeeded`, `reconcile_required`, `review_required`, or `failed` work
   before resuming workers.

Use the predeploy schema dump only for definition recovery. Restoring it wholesale can erase
post-deploy evidence and requires a separately reviewed maintenance window and data backup.
