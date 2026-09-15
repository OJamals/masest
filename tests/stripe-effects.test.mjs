import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  achFailedEffects,
  billingFailureEffects,
  billingRecoveryEffects,
  checkoutOrderEffects,
  deliverIntegrationEffect,
  disputeEffects,
  effectIdempotencyKey,
  enqueueIntegrationEffects,
  runIntegrationEffectsWorker,
  subscriptionActivationEffects,
  toIntegrationEffectRows,
} from '../functions/_lib/integration-effects.js';
import { createIntegrationEffectsWorkerHandler } from '../functions/api/admin/integration-effects.js';
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
    async rpc(name, args) {
      if (name === 'ingest_provider_event') {
        calls.push(['effects.ingest', args.p_effects, args]);
        return { data: 'integration-event-1', error: null };
      }
      throw new Error(`unexpected effect capture RPC: ${name}`);
    },
    from(table) {
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
          parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1' } },
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

// The Stripe webhook endpoint pins no API version, so live events use the account default
// (2026-05-27.dahlia), where an Invoice names its subscription only under parent. These two
// tests send that shape; before the fix both branches silently skipped the subscription.
function subscriptionTableSpy(writes, current = { status: 'past_due', company_id: 'company-1', tier: 'Gold' }) {
  return () => {
    const query = {
      select() { return query; },
      eq(column, value) { writes.push(['eq', column, value]); return query; },
      update(patch) { writes.push(['update', patch]); return query; },
      async maybeSingle() { return { data: current, error: null }; },
      then(resolve, reject) { return Promise.resolve({ data: null, error: null }).then(resolve, reject); },
    };
    return query;
  };
}

const dahliaSubscriptionInvoice = {
  id: 'in_dahlia',
  livemode: true,
  currency: 'usd',
  total: 4900,
  amount_paid: 4900,
  amount_due: 4900,
  attempt_count: 1,
  next_payment_attempt: null,
  total_taxes: [],
  parent: {
    type: 'subscription_details',
    subscription_details: { subscription: 'sub_1', metadata: { company_id: 'company-1' } },
  },
};

test('invoice.paid with a basil-or-later payload clears delinquency and queues the QBO invoice', async () => {
  const calls = [];
  const subscriptionWrites = [];
  const qboRows = [];
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({ id: 'evt_invoice_paid_dahlia', type: 'invoice.paid', data: { object: dahliaSubscriptionInvoice } }),
    adminClient: () => effectCaptureDb(calls, {
      program_subscriptions: subscriptionTableSpy(subscriptionWrites),
      qbo_subscription_invoices: () => ({
        async upsert(row) { qboRows.push(row); return { error: null }; },
      }),
    }),
  });
  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(result, { status: 200, body: { received: true } });
  assert.equal(qboRows.length, 1, 'the paid subscription invoice is queued for QuickBooks');
  assert.equal(qboRows[0].stripe_subscription_id, 'sub_1');
  assert.deepEqual(subscriptionWrites.filter(([op]) => op === 'eq').map(([, column, value]) => [column, value]),
    [['stripe_subscription_id', 'sub_1'], ['stripe_subscription_id', 'sub_1']]);
  assert.deepEqual(subscriptionWrites.find(([op]) => op === 'update'), ['update', { status: 'active' }]);
  assert.deepEqual(calls[0][1].map((row) => row.effect_key), ['billing-recovery-email', 'company-billing-recovered']);
});

test('invoice.payment_failed with a basil-or-later payload marks the subscription past_due', async () => {
  const calls = [];
  const subscriptionWrites = [];
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({ id: 'evt_invoice_failed_dahlia', type: 'invoice.payment_failed', data: { object: dahliaSubscriptionInvoice } }),
    adminClient: () => effectCaptureDb(calls, { program_subscriptions: subscriptionTableSpy(subscriptionWrites) }),
  });
  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(result, { status: 200, body: { received: true } });
  assert.deepEqual(subscriptionWrites, [['update', { status: 'past_due' }], ['eq', 'stripe_subscription_id', 'sub_1']]);
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
  const rows = toIntegrationEffectRows(checkoutOrderEffects({
    orderId: 'order-1',
    companyId: 'company-1',
    stage: 'card',
    currency: 'USD',
    total: 25,
  }));
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.max_attempts === 8));
  assert.ok(rows.every((row) => !('raw' in row.payload)));
  assert.ok(rows.every((row) => !('provider_payload' in row.payload)));
  assert.throws(
    () => toIntegrationEffectRows([{
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
  const stripeEvent = {
    id: 'evt_123',
    type: 'checkout.session.completed',
    livemode: false,
    created: 1784505600,
    data: { object: { id: 'cs_123' } },
  };
  const sb = {
    async rpc(name, args) {
      assert.equal(name, 'ingest_provider_event');
      calls.push(args);
      return { data: 'integration-event-1', error: null };
    },
  };
  const effects = achFailedEffects({ orderId: 'order-1', companyId: 'company-1' });
  assert.deepEqual(await enqueueIntegrationEffects(sb, stripeEvent, '{}', effects), { error: null });
  assert.deepEqual(calls[0].p_effects, toIntegrationEffectRows(effects));
  assert.deepEqual({
    provider: calls[0].p_provider,
    environment: calls[0].p_environment_or_tenant,
    eventId: calls[0].p_provider_event_id,
    eventType: calls[0].p_event_type,
    objectId: calls[0].p_provider_object_id,
  }, {
    provider: 'stripe',
    environment: 'test',
    eventId: 'evt_123',
    eventType: 'checkout.session.completed',
    objectId: 'cs_123',
  });

  const failed = {
    async rpc() {
      return { data: null, error: { code: 'db_down' } };
    },
  };
  assert.deepEqual(await enqueueIntegrationEffects(failed, stripeEvent, '{}', effects), {
    error: { code: 'db_down' },
  });
});

test('provider idempotency key is stable per Stripe event and effect', () => {
  const effect = { provider: 'stripe', provider_event_id: 'evt_123', effect_key: 'buyer-confirmation' };
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
    const result = await deliverIntegrationEffect({
      env: {},
      sb,
      effect: {
        id: `effect-${status}`,
        provider: 'stripe',
        provider_event_id: `evt-${status}`,
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
    assert.deepEqual(result, {
      providerRecorded: false,
      providerResult: { skipped: 'order_terminal' },
      skipped: true,
    });
    assert.equal(sends, 0);
  }
});

test('buyer confirmation labels account credit separately and restores original subtotal', async () => {
  let email;
  const sb = {
    from(table) {
      if (table === 'orders') {
        return resolvedQuery({
          data: {
            id: 'order-1',
            order_number: 'MST-00000123',
            user_id: null,
            status: 'paid',
            customer_email: 'buyer@example.com',
            subtotal: 39.99,
            shipping: 0,
            tax: 0,
            total: 37.99,
            currency: 'usd',
            purchase_order_number: null,
            ship_address: null,
          },
          error: null,
        });
      }
      if (table === 'order_items') {
        return resolvedQuery({
          data: [{ sku: 'SKU-1', name: 'Product', qty: 2, unit_price: 25, backordered: false }],
          error: null,
        });
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const result = await deliverIntegrationEffect({
    env: {},
    sb,
    effect: {
      id: 'effect-credit-confirmation',
      provider: 'stripe',
      provider_event_id: 'evt-credit-confirmation',
      effect_key: 'buyer-confirmation',
      effect_type: 'order_confirmation',
      payload: { order_id: 'order-1', pending: false, discount: 2, store_credit: 10.01 },
      lease_owner: 'worker-1',
    },
  }, {
    sendEmail: async (_env, input) => { email = input; return true; },
  });

  assert.equal(result.skipped, false);
  assert.match(email.subject, /Order MST-00000123 confirmed/);
  assert.match(email.html, /https:\/\/media\.masest\.co\/site\/img\/masest-logo\.png/);
  assert.match(email.html, /Required order notice/);
  assert.match(email.text, /ORDER SUMMARY/);
  assert.doesNotMatch(email.html, /Unsubscribe|Advertisement/i);
  assert.match(email.html, /Subtotal<\/td><td[^>]*>USD 50\.00/);
  assert.match(email.html, /Account credit<\/td><td[^>]*>&minus;USD 10\.01/);
  assert.match(email.html, /Discount<\/td><td[^>]*>&minus;USD 2\.00/);
  assert.match(email.html, /Total<\/td><td[^>]*>USD 37\.99/);
  assert.match(email.html, /contact\.html\?message=Question%20about%20order%20MST-00000123/);
  assert.match(email.html, />Get order help<\/a>/);
  assert.doesNotMatch(email.html, /dashboard\.html#orders/);
});

test('account buyer confirmation keeps the authenticated order CTA', async () => {
  let email;
  const sb = {
    from(table) {
      if (table === 'orders') {
        return resolvedQuery({
          data: {
            id: 'order-2',
            order_number: 'MST-00000124',
            user_id: 'user-1',
            status: 'paid',
            customer_email: 'account@example.com',
            subtotal: 25,
            shipping: 0,
            tax: 0,
            total: 25,
            currency: 'usd',
            purchase_order_number: null,
            ship_address: null,
          },
          error: null,
        });
      }
      if (table === 'order_items') {
        return resolvedQuery({
          data: [{ sku: 'SKU-2', name: 'Product', qty: 1, unit_price: 25, backordered: false }],
          error: null,
        });
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  await deliverIntegrationEffect({
    env: {},
    sb,
    effect: {
      id: 'effect-account-confirmation',
      provider: 'stripe',
      provider_event_id: 'evt-account-confirmation',
      effect_key: 'buyer-confirmation',
      effect_type: 'order_confirmation',
      payload: { order_id: 'order-2', pending: false, discount: 0 },
      lease_owner: 'worker-1',
    },
  }, {
    sendEmail: async (_env, input) => { email = input; return true; },
  });

  assert.match(email.html, /dashboard\.html#orders/);
  assert.match(email.html, />View your order<\/a>/);
  assert.doesNotMatch(email.html, />Get order help<\/a>/);
});

test('worker records provider success before completion and skips provider after response-loss retry', async () => {
  const calls = [];
  const fresh = {
    id: 'effect-1',
    event_id: 'integration-event-1',
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
      if (name === 'claim_integration_effects') {
        return { data: claimCount++ === 0 ? [fresh] : [], error: null };
      }
      return { data: true, error: null };
    },
  };
  let deliveries = 0;
  const first = await runIntegrationEffectsWorker({
    env: {},
    sb,
    workerId: 'worker-1',
    limit: 4,
  }, {
    loadEvent: async () => ({ provider: 'stripe', provider_event_id: 'evt_123' }),
    deliverEffect: async () => {
      deliveries += 1;
      return { providerRecorded: false };
    },
  });
  assert.deepEqual(first, {
    claimed: 1,
    completed: 1,
    retried: 0,
    dead: 0,
    skipped: 0,
    providerAcknowledged: 1,
    providerCallSkipped: 0,
  });
  assert.equal(deliveries, 1);
  assert.deepEqual(calls.map(([name]) => name), [
    'claim_integration_effects',
    'record_integration_effect_success',
    'complete_integration_effect',
    'claim_integration_effects',
  ]);

  calls.length = 0;
  claimCount = 0;
  sb.rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === 'claim_integration_effects') {
      return {
        data: claimCount++ === 0
          ? [{ ...fresh, provider_succeeded_at: '2026-07-19T00:00:00Z' }]
          : [],
        error: null,
      };
    }
    return { data: true, error: null };
  };
  const replay = await runIntegrationEffectsWorker({
    env: {},
    sb,
    workerId: 'worker-1',
    limit: 4,
  }, {
    loadEvent: async () => ({ provider: 'stripe', provider_event_id: 'evt_123' }),
    deliverEffect: async () => {
      throw new Error('provider must not run after success marker');
    },
  });
  assert.deepEqual(replay, {
    claimed: 1,
    completed: 1,
    retried: 0,
    dead: 0,
    skipped: 0,
    providerAcknowledged: 0,
    providerCallSkipped: 1,
  });
  assert.deepEqual(calls.map(([name]) => name), [
    'claim_integration_effects',
    'complete_integration_effect',
    'claim_integration_effects',
  ]);
});

test('worker preserves skipped provider result and reports skip separately from acknowledgement', async () => {
  const calls = [];
  let claimed = false;
  const sb = {
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'claim_integration_effects') {
        if (claimed) return { data: [], error: null };
        claimed = true;
        return {
          data: [{
            id: 'effect-skip',
            event_id: 'event-skip',
            effect_key: 'buyer-confirmation',
            effect_type: 'order_confirmation',
            payload: { order_id: 'order-1', pending: false, discount: 0 },
            lease_owner: 'worker-skip',
            provider_succeeded_at: null,
          }],
          error: null,
        };
      }
      return { data: true, error: null };
    },
  };
  const result = await runIntegrationEffectsWorker({
    env: {}, sb, workerId: 'worker-skip', limit: 2,
  }, {
    loadEvent: async () => ({ provider: 'stripe', provider_event_id: 'evt_skip' }),
    deliverEffect: async () => ({
      providerRecorded: false,
      providerResult: { skipped: 'order_terminal' },
      skipped: true,
    }),
  });
  assert.deepEqual(result, {
    claimed: 1,
    completed: 1,
    retried: 0,
    dead: 0,
    skipped: 1,
    providerAcknowledged: 0,
    providerCallSkipped: 0,
  });
  assert.deepEqual(
    calls.find(([name]) => name === 'record_integration_effect_success')[1].p_result,
    { skipped: 'order_terminal' },
  );
});

test('worker retries failures and reports a terminal dead-letter transition', async () => {
  const calls = [];
  const sb = {
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'claim_integration_effects') {
        return {
          data: [{
            id: 'effect-1',
            event_id: 'integration-event-1',
            effect_key: 'dispute-alert',
            effect_type: 'dispute_alert',
            payload: {},
            lease_owner: 'worker-1',
            provider_succeeded_at: null,
          }],
          error: null,
        };
      }
      if (name === 'fail_integration_effect') return { data: 'dead', error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const result = await runIntegrationEffectsWorker({
    env: {},
    sb,
    workerId: 'worker-1',
    limit: 1,
  }, {
    loadEvent: async () => ({ provider: 'stripe', provider_event_id: 'evt_123' }),
    deliverEffect: async () => {
      const error = new Error('provider body must not persist');
      error.code = 'provider_failed';
      throw error;
    },
  });
  assert.deepEqual(result, {
    claimed: 1,
    completed: 0,
    retried: 0,
    dead: 1,
    skipped: 0,
    providerAcknowledged: 0,
    providerCallSkipped: 0,
  });
  const retry = calls.find(([name]) => name === 'fail_integration_effect');
  assert.equal(retry[1].p_error_code, 'provider_failed');
  assert.doesNotMatch(JSON.stringify(retry[1]), /provider body must not persist/);
});

test('worker endpoint fails closed on missing or invalid secret and bounds batch size', async () => {
  let runs = 0;
  const handler = createIntegrationEffectsWorkerHandler({
    runWorker: async ({ limit }) => {
      runs += 1;
      assert.equal(limit, 25);
      return { claimed: 0, completed: 0, retried: 0, dead: 0 };
    },
    workerId: () => 'worker-test',
  });

  let response = await handler({
    request: new Request('https://masest.test/api/admin/integration-effects?limit=999', { method: 'POST' }),
    env: {},
  });
  assert.equal(response.status, 503);

  response = await handler({
    request: new Request('https://masest.test/api/admin/integration-effects?limit=999', {
      method: 'POST',
      headers: { 'x-integration-effects-secret': 'wrong' },
    }),
    env: { STRIPE_EFFECTS_WORKER_SECRET: 'correct' },
  });
  assert.equal(response.status, 401);
  assert.equal(runs, 0);

  response = await handler({
    request: new Request('https://masest.test/api/admin/integration-effects?limit=999', {
      method: 'POST',
      headers: { 'x-integration-effects-secret': 'correct' },
    }),
    env: { STRIPE_EFFECTS_WORKER_SECRET: 'correct' },
  });
  assert.equal(response.status, 200);
  assert.equal(runs, 1);
});

test('worker cron template schedules bounded effect processing with dedicated secret', () => {
  const sql = read('supabase/integration-effects-cron.example.sql');
  assert.match(sql, /create extension if not exists pg_cron/i);
  assert.match(sql, /create extension if not exists pg_net/i);
  assert.match(sql, /cron\.unschedule\('stripe-effects'\)/);
  assert.match(sql, /cron\.schedule\(\s*'integration-effects',\s*'\*\/1 \* \* \* \*'/);
  assert.match(sql, /https:\/\/masest\.co\/api\/admin\/integration-effects\?limit=25/);
  assert.match(sql, /'x-integration-effects-secret', '<STRIPE_EFFECTS_WORKER_SECRET>'/);
  assert.doesNotMatch(sql, /QBO_SYNC_SECRET|QUOTE_CRM_SECRET/);
});

test('schema supplies unique rows, bounded lease claims, reclaim, backoff, dead-letter, and least privilege', () => {
  const sql = read('supabase/schema-integration-events.sql');
  const handlers = read('supabase/schema-integration-effect-handlers.sql');
  assert.match(sql, /unique\s*\(\s*event_id\s*,\s*effect_key\s*\)/i);
  assert.match(sql, /status\s*=\s*'processing'[\s\S]*lease_expires_at\s*<=\s*now\(\)/i);
  assert.match(sql, /for\s+update\s+skip\s+locked/i);
  assert.match(sql, /least\s*\(\s*greatest\s*\(\s*coalesce\(p_limit/i);
  assert.match(sql, /attempt_count\s*\+\s*1/i);
  assert.match(sql, /power\s*\(\s*2/i);
  assert.match(sql, /status\s*=\s*'dead'/i);
  assert.match(sql, /provider_succeeded_at/i);
  assert.match(handlers, /apply_integration_stock_effect/i);
  assert.match(handlers, /deliver_integration_notification_effect/i);
  assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.integration_effects\s+from\s+anon,\s*authenticated/i);
  assert.match(sql, /grant\s+select\s+on\s+table\s+public\.integration_effects\s+to\s+service_role/i);
  for (const signature of [
    'claim_integration_effects\\(text, integer, integer\\)',
    'record_integration_effect_success\\(uuid, text, jsonb\\)',
    'complete_integration_effect\\(uuid, text\\)',
    'fail_integration_effect\\(uuid, text, text, integer, integer\\)',
  ]) {
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${signature}\\s+from\\s+public`, 'i'));
    assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${signature}\\s+to\\s+service_role`, 'i'));
  }
  for (const signature of [
    'apply_integration_stock_effect\\(uuid, text\\)',
    'deliver_integration_notification_effect\\(uuid, text, jsonb\\)',
  ]) {
    assert.match(handlers, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${signature}\\s+from\\s+public`, 'i'));
    assert.match(handlers, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${signature}\\s+to\\s+service_role`, 'i'));
  }
});

test('schema atomically skips stale stock and order notifications for terminal orders', () => {
  const sql = read('supabase/schema-integration-effect-handlers.sql');
  assert.match(
    sql,
    /apply_integration_stock_effect[\s\S]*v_order_status[\s\S]*in \('cancelled', 'refunded'\)[\s\S]*'skipped', 'order_terminal'/i,
  );
  assert.match(
    sql,
    /deliver_integration_notification_effect[\s\S]*order_received[\s\S]*payment_cleared[\s\S]*in \('cancelled', 'refunded'\)[\s\S]*'skipped', 'order_terminal'/i,
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
