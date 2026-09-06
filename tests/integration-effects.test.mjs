import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Stripe webhook and generic worker use integration event/effect contracts only', () => {
  const effects = read('functions/_lib/integration-effects.js');
  const webhook = read('functions/api/stripe-webhook.js');
  const route = read('functions/api/admin/integration-effects.js');

  assert.match(effects, /export async function enqueueIntegrationEffects/);
  assert.match(effects, /ingest_provider_event/);
  assert.match(effects, /claim_integration_effects/);
  assert.match(effects, /record_integration_effect_success/);
  assert.match(effects, /complete_integration_effect/);
  assert.match(effects, /fail_integration_effect/);
  assert.match(effects, /integration_events/);
  assert.match(effects, /integration_effects/);
  assert.match(effects, /skipped:\s*0/);
  assert.match(effects, /p_result:\s*outcome\?\.providerResult/);
  assert.doesNotMatch(effects, /stripe_webhook_effects|claim_stripe_webhook_effects|apply_stripe_stock_effect|deliver_stripe_notification_effect/);

  assert.match(webhook, /from '\.\.\/_lib\/integration-effects\.js'/);
  assert.match(webhook, /enqueueRequiredEffects\(\s*sb,\s*event,\s*rawBody,/);
  assert.doesNotMatch(webhook, /stripe-effects\.js|enqueueStripeEffects/);

  assert.match(route, /runIntegrationEffectsWorker/);
  assert.match(route, /x-integration-effects-secret/);
  assert.match(route, /integration_effects_worker_failed/);
  assert.doesNotMatch(route, /api\/admin\/stripe-effects|runStripeEffectsWorker/);
});

test('provider-visible Stripe idempotency keys and delivery plans remain stable', async () => {
  const module = await import('../functions/_lib/integration-effects.js');
  const row = {
    provider: 'stripe',
    provider_event_id: 'evt_123',
    effect_key: 'buyer-confirmation',
  };
  assert.equal(module.effectIdempotencyKey(row), 'stripe/evt_123/buyer-confirmation');
  assert.deepEqual(
    module.checkoutOrderEffects({
      orderId: 'order-1',
      companyId: 'company-1',
      stage: 'card',
      currency: 'USD',
      total: 25,
      discount: 2,
      storeCredit: 10.01,
    }).map(({ effect_key, effect_type, depends_on_effect_key }) => ({
      effect_key, effect_type, depends_on_effect_key,
    })),
    [
      { effect_key: 'stock-decrement', effect_type: 'stock_decrement', depends_on_effect_key: null },
      { effect_key: 'oversell-alert', effect_type: 'oversell_alert', depends_on_effect_key: 'stock-decrement' },
      { effect_key: 'buyer-confirmation', effect_type: 'order_confirmation', depends_on_effect_key: null },
      { effect_key: 'company-order-received', effect_type: 'company_notification', depends_on_effect_key: null },
    ],
  );
  assert.equal(
    module.checkoutOrderEffects({ orderId: 'order-1', stage: 'card', storeCredit: 10.01 })
      .find(({ effect_type }) => effect_type === 'order_confirmation').payload.store_credit,
    10.01,
  );
});

test('generic atomic local effects preserve response-loss protection', () => {
  const sql = read('supabase/schema-integration-effect-handlers.sql');
  assert.match(sql, /create or replace function public\.apply_integration_stock_effect/i);
  assert.match(sql, /create or replace function public\.deliver_integration_notification_effect/i);
  assert.match(sql, /from public\.integration_effects/i);
  assert.match(sql, /provider_succeeded_at/i);
  assert.match(sql, /decrement_variant_stock/i);
  assert.match(sql, /insert into public\.notifications/i);
  assert.match(sql, /deliver_integration_notification_effect[\s\S]*returns jsonb/i);
  assert.match(sql, /jsonb_build_object\('skipped', 'order_terminal'\)/i);
  assert.doesNotMatch(sql, /stripe_webhook_effects|apply_stripe_stock_effect|deliver_stripe_notification_effect/);
});

test('support message effects are durable and use the canonical worker handler', () => {
  const effects = read('functions/_lib/integration-effects.js');
  const migration = read('supabase/migrate-durable-support-message-effects-2026-09-05.sql');
  assert.match(effects, /support_message_email/);
  assert.match(effects, /deliverSupportMessageEmail/);
  assert.match(read('functions/_lib/support-email.js'), /support-message\/\$\{message\.id\}\/\$\{message\.sender_role\}/);
  assert.match(migration, /after insert on public\.messages/i);
  assert.match(migration, /public\.ingest_integration_event/i);
  assert.match(migration, /support_message_email/i);
  assert.match(migration, /support-message-/i);
  assert.match(effects, /quote_intake_email/);
  assert.match(read('functions/_lib/quote-intake-effects.js'), /quote-intake\/\$\{quote\.id\}\/autoreply/);
  assert.match(migration, /quotes_intake_email_effect/i);
});

test('support effect preserves retryable provider outage and accepted delivery state', async () => {
  const { deliverIntegrationEffect } = await import('../functions/_lib/integration-effects.js');
  const message = { id: 'message-1', sender_role: 'staff' };
  const sb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: message, error: null }) }) }) }) };
  const effect = { effect_type: 'support_message_email', provider: 'masest', payload: { message_id: message.id } };
  const failed = await assert.rejects(
    () => deliverIntegrationEffect({ env: {}, sb, effect }, {
      supportDelivery: async () => ({ ok: false, retryable: true, error: 'provider_unavailable' }),
    }),
    /support_email_delivery_failed/,
  );
  assert.equal(failed, undefined);
  const accepted = await deliverIntegrationEffect({ env: {}, sb, effect }, {
    supportDelivery: async () => ({ ok: true, providerMessageId: 'provider-1' }),
  });
  assert.deepEqual(accepted, {
    providerRecorded: false,
    providerResult: { provider_message_id: 'provider-1' },
    skipped: false,
  });
});

test('quote intake worker renders only the frozen effect snapshot', async () => {
  const { deliverIntegrationEffect } = await import('../functions/_lib/integration-effects.js');
  const sent = [];
  const base = { id: 'quote-1', email: 'frozen@example.test', name: 'Frozen Name', company: 'Frozen Co', type: 'sample', priority: 'urgent', lead_score: 90, payload: { current_chemical: 'X' } };
  const sb = {};
  const result = await deliverIntegrationEffect({ env: { SALES_EMAIL: 'sales@example.test' }, sb, effect: {
    effect_type: 'quote_intake_email', provider: 'masest', payload: { quote_id: 'quote-1', kind: 'internal' }, source_snapshot: base,
  } }, { sendEmail: async (_env, options) => { sent.push(options); return { ok: true, providerMessageId: 'mail-1' }; } });
  assert.equal(result.skipped, false);
  assert.match(sent[0].subject, /Frozen Co/);
  assert.match(sent[0].html, /Cleaner used now/);
  await assert.rejects(() => deliverIntegrationEffect({ env: {}, sb, effect: {
    effect_type: 'quote_intake_email', provider: 'masest', payload: { quote_id: 'quote-1', kind: 'internal' }, source_snapshot: { ...base, id: 'other' },
  } }, { sendEmail: async () => { throw new Error('must not send'); } }), /quote_intake_missing/);
});

test('cutover removes legacy table/RPCs only after exact parity and rollback reconstructs them', () => {
  const cutover = read('supabase/cutover-integration-effects.sql');
  const rollback = read('supabase/rollback-integration-effects-cutover.sql');

  assert.match(cutover, /integration_cutover_count_mismatch/i);
  assert.match(cutover, /integration_cutover_checksum_mismatch/i);
  assert.match(cutover, /join public\.stripe_webhook_effects as legacy on legacy\.id = effect\.id/i);
  assert.match(cutover, /drop function if exists public\.claim_stripe_webhook_effects/i);
  assert.match(cutover, /drop table public\.stripe_webhook_effects/i);
  assert.match(rollback, /create table if not exists public\.stripe_webhook_effects/i);
  assert.match(rollback, /from public\.integration_effects/i);
  assert.doesNotMatch(rollback, /event\.environment_or_tenant\s*=\s*'production'/i);
  assert.match(rollback, /rollback_stripe_effect_count_mismatch/i);
  assert.match(rollback, /rollback_stripe_effect_checksum_mismatch/i);
});

test('generic cron and route replace legacy names without forwarding wrappers', () => {
  const cron = read('supabase/integration-effects-cron.example.sql');
  const cutoverCron = read('supabase/cutover-integration-effects-cron.sql');
  const rollbackCron = read('supabase/rollback-integration-effects-cron.sql');
  assert.match(cron, /cron\.unschedule\('stripe-effects'\)/);
  assert.match(cron, /cron\.schedule\(\s*'integration-effects'/);
  assert.match(cron, /\/api\/admin\/integration-effects\?limit=25/);
  assert.match(cron, /x-integration-effects-secret/);
  assert.match(cutoverCron, /stripe-effects[\s\S]*integration-effects/);
  assert.match(cutoverCron, /x-stripe-effects-secret[\s\S]*x-integration-effects-secret/);
  assert.match(rollbackCron, /integration-effects[\s\S]*stripe-effects/);
  assert.match(rollbackCron, /x-integration-effects-secret[\s\S]*x-stripe-effects-secret/);
  assert.equal(existsSync(new URL('../functions/api/admin/stripe-effects.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../functions/_lib/stripe-effects.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../supabase/stripe-effects-cron.example.sql', import.meta.url)), false);
});
