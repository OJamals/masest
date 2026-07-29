import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  achFailedEffects,
  billingFailureEffects,
  billingRecoveryEffects,
  checkoutOrderEffects,
  deliverStripeEffect,
  disputeEffects,
  effectIdempotencyKey,
  enqueueStripeEffects,
  runStripeEffectsWorker,
  subscriptionActivationEffects,
  toStripeEffectRows,
} from '../functions/_lib/stripe-effects.js';
import { createStripeEffectsWorkerHandler } from '../functions/api/admin/stripe-effects.js';
import { createStripeWebhookHandler } from '../functions/api/stripe-webhook.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const webhookEnv = { STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test' };
const webhookRequest = () => new Request('https://masest.test/api/stripe-webhook', {
  method: 'POST',
  headers: { 'stripe-signature': 'sig_test' },
  body: '{}',
});
const responseJson = async (response) => ({ status: response.status, body: await response.json() });

function resolvedQuery(result) {
  return {
    select() { return this; },
    update() { return this; },
    eq() { return this; },
    async maybeSingle() { return result; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
}

function effectCaptureDb(calls, tables = {}) {
  return {
    from(table) {
      if (table === 'stripe_webhook_effects') {
        return {
          async upsert(rows, options) {
            calls.push(['effects.upsert', rows, options]);
            return { data: null, error: null };
          },
        };
      }
      if (tables[table]) return tables[table]();
      throw new Error(`unexpected effect capture table: ${table}`);
    },
  };
}

test('effect plans inventory every non-idempotent Stripe webhook effect', () => {
  assert.deepEqual(
    checkoutOrderEffects({
      orderId: 'order-1',
      companyId: 'company-1',
      stage: 'card',
      currency: 'USD',
      total: 25,
      discount: 2,
    }).map(({ effect_key, effect_type, depends_on_effect_key }) => ({
      effect_key,
      effect_type,
      depends_on_effect_key,
    })),
    [
      { effect_key: 'stock-decrement', effect_type: 'stock_decrement', depends_on_effect_key: null },
      { effect_key: 'oversell-alert', effect_type: 'oversell_alert', depends_on_effect_key: 'stock-decrement' },
      { effect_key: 'buyer-confirmation', effect_type: 'order_confirmation', depends_on_effect_key: null },
      { effect_key: 'company-order-received', effect_type: 'company_notification', depends_on_effect_key: null },
    ],
  );

  assert.deepEqual(
    checkoutOrderEffects({
      orderId: 'order-1',
      companyId: 'company-1',
      stage: 'ach_pending',
      currency: 'USD',
      total: 25,
    }).map((effect) => effect.effect_key),
    ['buyer-confirmation', 'company-order-received'],
  );

  assert.deepEqual(
    checkoutOrderEffects({
      orderId: 'order-1',
      companyId: 'company-1',
      stage: 'ach_succeeded',
      currency: 'USD',
      total: 25,
    }).map((effect) => effect.effect_key),
    ['stock-decrement', 'oversell-alert', 'buyer-confirmation', 'company-payment-cleared'],
  );

  assert.deepEqual(
    achFailedEffects({ orderId: 'order-1', companyId: 'company-1' }).map((effect) => effect.effect_key),
    ['buyer-ach-failure', 'company-payment-failed'],
  );
  assert.deepEqual(
    subscriptionActivationEffects({ companyId: 'company-1', tier: 'Gold' }).map((effect) => effect.effect_key),
    ['company-program-active'],
  );
  assert.deepEqual(
    billingFailureEffects({
      companyId: 'company-1',
      amountDue: 25,
      currency: 'USD',
      attempt: 2,
      willRetry: true,
      nextAttemptIso: '2026-07-20T00:00:00.000Z',
    }).map((effect) => effect.effect_key),
    ['billing-failure-email', 'company-billing-failed'],
  );
  assert.deepEqual(
    billingRecoveryEffects({ companyId: 'company-1', amountPaid: 25, currency: 'USD' })
      .map((effect) => effect.effect_key),
    ['billing-recovery-email', 'company-billing-recovered'],
  );
  assert.deepEqual(
    disputeEffects({
      orderId: 'order-1',
      chargeId: 'ch_1',
      amount: 25,
      currency: 'USD',
      reason: 'fraudulent',
      status: 'needs_response',
    }).map((effect) => effect.effect_key),
    ['dispute-alert'],
  );
});

test('ACH failure branch commits buyer and Company effects before 200', async () => {
  const calls = [];
  const orders = () => {
    let operation = 'select';
    return {
      select() { return this; },
      update() { operation = 'update'; return this; },
      eq() { return this; },
      async maybeSingle() {
        return operation === 'select'
          ? { data: { id: 'order-1', status: 'pending_payment', company_id: 'company-1' }, error: null }
          : { data: { id: 'order-1', status: 'cancelled', company_id: 'company-1' }, error: null };
      },
    };
  };
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_ach_failed',
      type: 'checkout.session.async_payment_failed',
      data: { object: { payment_intent: 'pi_1', mode: 'payment' } },
    }),
    adminClient: () => effectCaptureDb(calls, { orders }),
  });
  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(result, { status: 200, body: { received: true } });
  assert.deepEqual(
    calls[0][1].map((row) => row.effect_key),
    ['buyer-ach-failure', 'company-payment-failed'],
  );
});

test('billing-failed branch commits alert effects before 200', async () => {
  const calls = [];
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_invoice_failed',
      type: 'invoice.payment_failed',
      data: {
        object: {
          subscription: 'sub_1',
          metadata: { company_id: 'company-1' },
          amount_due: 2500,
          currency: 'usd',
          attempt_count: 2,
          next_payment_attempt: 1784505600,
        },
      },
    }),
    adminClient: () => effectCaptureDb(calls, {
      program_subscriptions: () => resolvedQuery({ data: null, error: null }),
    }),
  });
  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(result, { status: 200, body: { received: true } });
  assert.deepEqual(
    calls[0][1].map((row) => row.effect_key),
    ['billing-failure-email', 'company-billing-failed'],
  );
});

test('dispute branch commits staff alert effect before 200', async () => {
  const calls = [];
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_dispute',
      type: 'charge.dispute.created',
      data: {
        object: {
          charge: 'ch_1',
          payment_intent: null,
          amount: 2500,
          currency: 'usd',
          reason: 'fraudulent',
          status: 'needs_response',
        },
      },
    }),
    adminClient: () => effectCaptureDb(calls),
  });
  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(result, { status: 200, body: { received: true } });
  assert.deepEqual(calls[0][1].map((row) => row.effect_key), ['dispute-alert']);
});

test('subscription checkout commits Company activation effect before 200', async () => {
  const calls = [];
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_subscription',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_subscription',
          mode: 'subscription',
          subscription: 'sub_1',
          customer: 'cus_1',
          metadata: { company_id: 'company-1', tier: 'Gold' },
        },
      },
    }),
    adminClient: () => effectCaptureDb(calls, {
      program_subscriptions: () => resolvedQuery({
        data: [{ id: 'program-1' }],
        error: null,
      }),
    }),
  });
  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(result, {
    status: 200,
    body: { received: true, subscription: true },
  });
  assert.deepEqual(calls[0][1].map((row) => row.effect_key), ['company-program-active']);
});

test('ledger rows use a unique event/effect identity and allowlisted semantic payload only', () => {
  const rows = toStripeEffectRows('evt_123', checkoutOrderEffects({
    orderId: 'order-1',
    companyId: 'company-1',
    stage: 'card',
    currency: 'USD',
    total: 25,
  }));
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.stripe_event_id === 'evt_123'));
  assert.ok(rows.every((row) => !('raw' in row.payload)));
  assert.ok(rows.every((row) => !('provider_payload' in row.payload)));
  assert.throws(
    () => toStripeEffectRows('evt_123', [{
      effect_key: 'bad',
      effect_type: 'order_confirmation',
      depends_on_effect_key: null,
      payload: { order_id: 'order-1', pending: false, discount: 0, secret: 'nope' },
    }]),
    /unexpected payload key/i,
  );
});

test('enqueue is duplicate-safe and surfaces persistence failure before acknowledgement', async () => {
  const calls = [];
  const sb = {
    from(table) {
      assert.equal(table, 'stripe_webhook_effects');
      return {
        async upsert(rows, options) {
          calls.push({ rows, options });
          return { data: null, error: null };
        },
      };
    },
  };
  const effects = achFailedEffects({ orderId: 'order-1', companyId: 'company-1' });
  assert.deepEqual(await enqueueStripeEffects(sb, 'evt_123', effects), { error: null });
  assert.deepEqual(calls[0].options, {
    onConflict: 'stripe_event_id,effect_key',
    ignoreDuplicates: true,
  });

  const failed = {
    from() {
      return {
        async upsert() {
          return { data: null, error: { code: 'db_down' } };
        },
      };
    },
  };
  assert.deepEqual(await enqueueStripeEffects(failed, 'evt_123', effects), {
    error: { code: 'db_down' },
  });
});

test('provider idempotency key is stable per Stripe event and effect', () => {
  const effect = { stripe_event_id: 'evt_123', effect_key: 'buyer-confirmation' };
  assert.equal(effectIdempotencyKey(effect), 'stripe/evt_123/buyer-confirmation');
  assert.equal(effectIdempotencyKey(effect), 'stripe/evt_123/buyer-confirmation');
  assert.notEqual(
    effectIdempotencyKey({ ...effect, effect_key: 'company-order-received' }),
    effectIdempotencyKey(effect),
  );
});

test('late buyer confirmations skip orders already cancelled or refunded', async () => {
  for (const status of ['cancelled', 'refunded']) {
    let sends = 0;
    const sb = {
      from(table) {
        if (table === 'orders') {
          return resolvedQuery({
            data: {
              id: 'order-1',
              status,
              customer_email: 'buyer@example.com',
              subtotal: 10,
              shipping: 0,
              tax: 0,
              total: 10,
              currency: 'usd',
              purchase_order_number: null,
              ship_address: null,
            },
            error: null,
          });
        }
        if (table === 'order_items') {
          return resolvedQuery({
            data: [{ sku: 'SKU-1', name: 'Product', qty: 1, unit_price: 10, backordered: false }],
            error: null,
          });
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    const result = await deliverStripeEffect({
      env: {},
      sb,
      effect: {
        id: `effect-${status}`,
        stripe_event_id: `evt-${status}`,
        effect_key: 'buyer-confirmation',
        effect_type: 'order_confirmation',
        payload: { order_id: 'order-1', pending: false, discount: 0 },
        lease_owner: 'worker-1',
      },
    }, {
      sendEmail: async () => {
        sends += 1;
        return true;
      },
    });
    assert.deepEqual(result, { providerRecorded: false });
    assert.equal(sends, 0);
  }
});

test('worker records provider success before completion and skips provider after response-loss retry', async () => {
  const calls = [];
  const fresh = {
    id: 'effect-1',
    stripe_event_id: 'evt_123',
    effect_key: 'buyer-confirmation',
    effect_type: 'order_confirmation',
    payload: { order_id: 'order-1', pending: false, discount: 0 },
    lease_owner: 'worker-1',
    provider_succeeded_at: null,
  };
  let claimCount = 0;
  const sb = {
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'claim_stripe_webhook_effects') {
        return { data: claimCount++ === 0 ? [fresh] : [], error: null };
      }
      return { data: true, error: null };
    },
  };
  let deliveries = 0;
  const first = await runStripeEffectsWorker({
    env: {},
    sb,
    workerId: 'worker-1',
    limit: 4,
  }, {
    deliverEffect: async () => {
      deliveries += 1;
      return { providerRecorded: false };
    },
  });
  assert.deepEqual(first, { claimed: 1, completed: 1, retried: 0, dead: 0 });
  assert.equal(deliveries, 1);
  assert.deepEqual(calls.map(([name]) => name), [
    'claim_stripe_webhook_effects',
    'record_stripe_webhook_effect_success',
    'complete_stripe_webhook_effect',
    'claim_stripe_webhook_effects',
  ]);

  calls.length = 0;
  claimCount = 0;
  sb.rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === 'claim_stripe_webhook_effects') {
      return {
        data: claimCount++ === 0
          ? [{ ...fresh, provider_succeeded_at: '2026-07-19T00:00:00Z' }]
          : [],
        error: null,
      };
    }
    return { data: true, error: null };
  };
  const replay = await runStripeEffectsWorker({
    env: {},
    sb,
    workerId: 'worker-1',
    limit: 4,
  }, {
    deliverEffect: async () => {
      throw new Error('provider must not run after success marker');
    },
  });
  assert.deepEqual(replay, { claimed: 1, completed: 1, retried: 0, dead: 0 });
  assert.deepEqual(calls.map(([name]) => name), [
    'claim_stripe_webhook_effects',
    'complete_stripe_webhook_effect',
    'claim_stripe_webhook_effects',
  ]);
});

test('worker retries failures and reports a terminal dead-letter transition', async () => {
  const calls = [];
  const sb = {
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'claim_stripe_webhook_effects') {
        return {
          data: [{
            id: 'effect-1',
            stripe_event_id: 'evt_123',
            effect_key: 'dispute-alert',
            effect_type: 'dispute_alert',
            payload: {},
            lease_owner: 'worker-1',
            provider_succeeded_at: null,
          }],
          error: null,
        };
      }
      if (name === 'retry_stripe_webhook_effect') return { data: 'dead', error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const result = await runStripeEffectsWorker({
    env: {},
    sb,
    workerId: 'worker-1',
    limit: 1,
  }, {
    deliverEffect: async () => {
      const error = new Error('provider body must not persist');
      error.code = 'provider_failed';
      throw error;
    },
  });
  assert.deepEqual(result, { claimed: 1, completed: 0, retried: 0, dead: 1 });
  const retry = calls.find(([name]) => name === 'retry_stripe_webhook_effect');
  assert.equal(retry[1].p_error_code, 'provider_failed');
  assert.doesNotMatch(JSON.stringify(retry[1]), /provider body must not persist/);
});

test('worker endpoint fails closed on missing or invalid secret and bounds batch size', async () => {
  let runs = 0;
  const handler = createStripeEffectsWorkerHandler({
    runWorker: async ({ limit }) => {
      runs += 1;
      assert.equal(limit, 25);
      return { claimed: 0, completed: 0, retried: 0, dead: 0 };
    },
    workerId: () => 'worker-test',
  });

  let response = await handler({
    request: new Request('https://masest.test/api/admin/stripe-effects?limit=999', { method: 'POST' }),
    env: {},
  });
  assert.equal(response.status, 503);

  response = await handler({
    request: new Request('https://masest.test/api/admin/stripe-effects?limit=999', {
      method: 'POST',
      headers: { 'x-stripe-effects-secret': 'wrong' },
    }),
    env: { STRIPE_EFFECTS_WORKER_SECRET: 'correct' },
  });
  assert.equal(response.status, 401);
  assert.equal(runs, 0);

  response = await handler({
    request: new Request('https://masest.test/api/admin/stripe-effects?limit=999', {
      method: 'POST',
      headers: { 'x-stripe-effects-secret': 'correct' },
    }),
    env: { STRIPE_EFFECTS_WORKER_SECRET: 'correct' },
  });
  assert.equal(response.status, 200);
  assert.equal(runs, 1);
});

test('worker cron template schedules bounded effect processing with dedicated secret', () => {
  const sql = read('supabase/stripe-effects-cron.example.sql');
  assert.match(sql, /create extension if not exists pg_cron/i);
  assert.match(sql, /create extension if not exists pg_net/i);
  assert.match(sql, /cron\.unschedule\('stripe-effects'\)/);
  assert.match(sql, /cron\.schedule\(\s*'stripe-effects',\s*'\*\/1 \* \* \* \*'/);
  assert.match(sql, /https:\/\/masest\.co\/api\/admin\/stripe-effects\?limit=25/);
  assert.match(sql, /'x-stripe-effects-secret', '<STRIPE_EFFECTS_WORKER_SECRET>'/);
  assert.doesNotMatch(sql, /QBO_SYNC_SECRET|QUOTE_CRM_SECRET/);
});

test('schema supplies unique rows, bounded lease claims, reclaim, backoff, dead-letter, and least privilege', () => {
  const sql = read('supabase/schema-stripe-effects.sql');
  assert.match(sql, /unique\s*\(\s*stripe_event_id\s*,\s*effect_key\s*\)/i);
  assert.match(sql, /status\s*=\s*'processing'[\s\S]*lease_expires_at\s*<=\s*now\(\)/i);
  assert.match(sql, /for\s+update\s+skip\s+locked/i);
  assert.match(sql, /least\s*\(\s*greatest\s*\(\s*coalesce\(p_limit/i);
  assert.match(sql, /attempt_count\s*\+\s*1/i);
  assert.match(sql, /power\s*\(\s*2/i);
  assert.match(sql, /status\s*=\s*'dead'/i);
  assert.match(sql, /provider_succeeded_at/i);
  assert.match(sql, /apply_stripe_stock_effect/i);
  assert.match(sql, /deliver_stripe_notification_effect/i);
  assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.stripe_webhook_effects\s+from\s+anon,\s*authenticated/i);
  assert.match(sql, /grant\s+all\s+on\s+table\s+public\.stripe_webhook_effects\s+to\s+service_role/i);
  for (const signature of [
    'claim_stripe_webhook_effects\\(text, integer, integer\\)',
    'record_stripe_webhook_effect_success\\(uuid, text, jsonb\\)',
    'complete_stripe_webhook_effect\\(uuid, text\\)',
    'retry_stripe_webhook_effect\\(uuid, text, text, integer, integer\\)',
    'apply_stripe_stock_effect\\(uuid, text\\)',
    'deliver_stripe_notification_effect\\(uuid, text, jsonb\\)',
  ]) {
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${signature}\\s+from\\s+public`, 'i'));
    assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${signature}\\s+to\\s+service_role`, 'i'));
  }
});

test('schema atomically skips stale stock and order notifications for terminal orders', () => {
  const sql = read('supabase/schema-stripe-effects.sql');
  const claim = sql.slice(
    sql.indexOf('create or replace function public.claim_stripe_webhook_effects'),
    sql.indexOf('-- Record an external provider success'),
  );
  assert.match(claim, /update public\.stripe_webhook_effects as effect[\s\S]*set status = 'completed'/i);
  assert.match(claim, /order_row\.status in \('cancelled', 'refunded'\)/i);
  assert.match(claim, /effect_type in \('stock_decrement', 'oversell_alert', 'order_confirmation'\)/i);
  assert.match(claim, /effect\.payload ->> 'kind' in \('order_received', 'payment_cleared'\)/i);
  assert.match(
    sql,
    /apply_stripe_stock_effect[\s\S]*v_order_status[\s\S]*in \('cancelled', 'refunded'\)[\s\S]*'skipped', 'order_terminal'/i,
  );
  assert.match(
    sql,
    /deliver_stripe_notification_effect[\s\S]*order_received[\s\S]*payment_cleared[\s\S]*in \('cancelled', 'refunded'\)[\s\S]*'skipped', 'order_terminal'/i,
  );
  assert.match(
    sql,
    /insert into public\.notifications[\s\S]*v_type::public\.notification_type/i,
  );
});

test('webhook branch wiring enqueues before every relevant 2xx and leaves refund accounting durable', () => {
  const src = read('functions/api/stripe-webhook.js');
  for (const builder of [
    'checkoutOrderEffects',
    'achFailedEffects',
    'subscriptionActivationEffects',
    'billingFailureEffects',
    'billingRecoveryEffects',
    'disputeEffects',
  ]) {
    assert.match(src, new RegExp(`${builder}\\(`), `${builder} must be wired into verified webhook branch`);
  }
  assert.match(src, /await\s+enqueueRequiredEffects\(/);
  assert.match(src, /if\s*\(\s*enqueueError\s*\)\s*return\s+json\(\s*503/);
  assert.match(src, /enqueueQboRefundRows[\s\S]*refundUpdateError/);
  assert.doesNotMatch(src, /await\s+decrementVariantStock\(/);
  assert.doesNotMatch(src, /await\s+notifyBillingFailure\(/);
  assert.doesNotMatch(src, /await\s+alertStaffDispute\(/);
});
