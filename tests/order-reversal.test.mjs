import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  deliverIntegrationEffect,
  toIntegrationEffectRows,
} from '../functions/_lib/integration-effects.js';
import {
  confirmCancellationCommand,
  prepareCancellationCommand,
  queueRefundCommand,
  retireCancellationReviewCommand,
} from '../functions/_lib/order-reversal-service.js';
import {
  cancellationAccountingPlan,
  cancellationCommandPlan,
  cancellationCommandEffects,
  normalizeReversalRequestId,
  refundCommandEffects,
  refundCommandPlan,
  reversalPlanHash,
} from '../functions/_lib/order-reversal.js';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const COMMAND_ID = '22222222-2222-4222-8222-222222222222';
const REVERSAL_SQL = readFileSync(new URL('../supabase/schema-order-reversals.sql', import.meta.url), 'utf8');
const LABEL_OWNERSHIP_SQL = readFileSync(new URL('../supabase/schema-shipment-label-ownership.sql', import.meta.url), 'utf8');
const PROVIDER_INBOX_SQL = readFileSync(new URL('../supabase/schema-provider-inbox.sql', import.meta.url), 'utf8');
const ADMIN_ORDERS_API = readFileSync(new URL('../functions/api/admin/orders.js', import.meta.url), 'utf8');
const ADMIN_ORDERS_UI = readFileSync(new URL('../js/admin/orders.js', import.meta.url), 'utf8');
const order = {
  id: ORDER_ID,
  order_number: 'MST-1',
  status: 'paid',
  payment_method: 'stripe',
  stripe_payment_intent: 'pi_1',
  total: 100,
  refunded_amount: 0,
  reversal_revision: 4,
  currency: 'usd',
  qbo_sync_status: 'synced',
  qbo_doc_id: 'inv-1',
  qbo_doc_type: 'invoice_payment',
  order_items: [
    { sku: 'A', qty: 2, unit_price: 25, backordered: false },
    { sku: 'B', qty: 1, unit_price: 50, backordered: true },
  ],
};

test('refund request identity is stable and bounded', () => {
  assert.equal(normalizeReversalRequestId('refund:abc-123'), 'refund:abc-123');
  assert.equal(normalizeReversalRequestId('short'), null);
  assert.equal(normalizeReversalRequestId('bad space id'), null);
});

test('refund command freezes price, lines, restock, revision, and provider identity', () => {
  const plan = refundCommandPlan(order, {
    requestId: 'refund:request-1',
    lines: [{ sku: 'A', qty: 1 }],
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.expected_revision, 4);
  assert.equal(plan.amount_minor, 2500);
  assert.equal(plan.snapshot.allocation_type, 'line');
  assert.equal(plan.snapshot.accounting.action, 'credit_memo');
  assert.equal(plan.provider_idempotency_key, `order-refund:${ORDER_ID}:refund:request-1`);
  assert.deepEqual(plan.lines, [{
    sku: 'A', qty: 1, unit_price: 25, unit_price_minor: 2500,
    line_total: 25, line_amount_minor: 2500, restock_qty: 1,
  }]);
  assert.deepEqual(plan.snapshot.restock_lines, [{ sku: 'A', qty: 1 }]);
});

test('refund refuses unsettled Stripe orders whose stock and money never settled', () => {
  const plan = refundCommandPlan({ ...order, status: 'pending_payment' }, {
    requestId: 'refund:pending-payment',
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.error, 'not_refundable');
});

test('full refund snapshots every sold line but only restocks stock-backed units', () => {
  const plan = refundCommandPlan(order, { requestId: 'refund:request-full' });
  assert.equal(plan.ok, true);
  assert.equal(plan.snapshot.allocation_type, 'full');
  assert.deepEqual(plan.lines.map(({ sku, qty, restock_qty }) => ({ sku, qty, restock_qty })), [
    { sku: 'A', qty: 2, restock_qty: 2 },
    { sku: 'B', qty: 1, restock_qty: 0 },
  ]);
});

test('prior line refunds reduce remaining quantity', () => {
  const plan = refundCommandPlan(order, {
    requestId: 'refund:request-2',
    lines: [{ sku: 'A', qty: 2 }],
    refundedLines: [{ sku: 'A', qty: 1 }],
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.error, 'refund_lines_invalid');
});

test('final balance refund never restocks a previously refunded line twice', () => {
  const plan = refundCommandPlan({ ...order, refunded_amount: 25 }, {
    requestId: 'refund:request-final',
    refundedLines: [{ sku: 'A', qty: 1, restock_qty: 1 }],
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.snapshot.allocation_type, 'full');
  assert.deepEqual(plan.lines.map(({ sku, qty, restock_qty }) => ({ sku, qty, restock_qty })), [
    { sku: 'A', qty: 1, restock_qty: 1 },
    { sku: 'B', qty: 1, restock_qty: 0 },
  ]);
});

test('line refund cannot exhaust money while leaving other refundable inventory stranded', () => {
  const plan = refundCommandPlan({
    ...order,
    refunded_amount: 75,
  }, {
    requestId: 'refund:request-stranded-stock',
    lines: [{ sku: 'A', qty: 1 }],
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.error, 'refund_full_balance_requires_full_command');
});

test('refund rejects conflicting amount and line intents', () => {
  const plan = refundCommandPlan(order, {
    requestId: 'refund:request-ambiguous',
    amount: 25,
    lines: [{ sku: 'A', qty: 1 }],
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.error, 'refund_intent_ambiguous');
});

test('refund effect chain uses one immutable command identity', () => {
  const rows = refundCommandEffects({ id: COMMAND_ID, order_id: ORDER_ID });
  assert.deepEqual(rows.map((row) => row.effect_key), [
    'stripe-refund', 'order-restock', 'accounting-reversal', 'reversal-complete', 'refund-email',
  ]);
  assert.ok(rows.every((row) => row.payload.command_id === COMMAND_ID));
  assert.equal(rows[1].depends_on_effect_key, 'stripe-refund');
  assert.equal(rows[3].depends_on_effect_key, 'accounting-reversal');
  assert.equal(rows[4].depends_on_effect_key, 'reversal-complete');
});

test('cancellation fans every label into the dependency chain', () => {
  const rows = cancellationCommandEffects({
    order_id: ORDER_ID,
    reason: 'Buyer cancelled',
    labels: [
      { label_id: 'se-a', will_void: true },
      { label_id: 'se-b', will_void: true },
    ],
  }, { id: COMMAND_ID });
  assert.deepEqual(rows.slice(0, 3).map((row) => row.effect_key), [
    'label-void-1', 'label-void-2', 'stripe-refund',
  ]);
  assert.equal(rows[1].depends_on_effect_key, 'label-void-1');
  assert.equal(rows[2].depends_on_effect_key, 'label-void-2');
});

test('cancellation command freezes remaining money, inventory, labels, recipients, and books', () => {
  const plan = cancellationCommandPlan({ ...order, refunded_amount: 25 }, {
    requestId: 'cancel:request-1',
    reason: 'Buyer ordered wrong product',
    labels: [{ label_id: 'se-a', order_shipment_id: 'shipment-1', tracking_status: 'label_purchased' }],
    refundedLines: [{ sku: 'A', qty: 1, restock_qty: 1 }],
    recipients: ['BUYER@example.com', 'ops@example.com'],
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.amount_minor, 7500);
  assert.equal(plan.expected_revision, 4);
  assert.equal(plan.snapshot.accounting.action, 'credit_memo');
  assert.deepEqual(plan.snapshot.labels.map(({ label_id }) => label_id), ['se-a']);
  assert.deepEqual(plan.lines.map(({ sku, qty, restock_qty }) => ({ sku, qty, restock_qty })), [
    { sku: 'A', qty: 1, restock_qty: 1 },
    { sku: 'B', qty: 1, restock_qty: 0 },
  ]);
  assert.deepEqual(plan.snapshot.notification.recipients, ['buyer@example.com', 'ops@example.com']);
});

test('fulfilled local-delivery orders remain returns, never cancellable reversals', () => {
  const plan = cancellationCommandPlan({
    ...order,
    status: 'fulfilled',
    tracking_status: 'delivered',
  }, {
    requestId: 'cancel:local-delivery',
    reason: 'Buyer requested cancellation after delivery',
    labels: [],
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.snapshot.blockers, ['shipment_in_transit']);
});

test('pending Stripe cancellation never refunds or restores unclaimed stock', () => {
  const plan = cancellationCommandPlan({
    ...order,
    status: 'pending_payment',
    qbo_sync_status: null,
    qbo_doc_id: null,
    qbo_doc_type: null,
    qbo_payment_id: null,
    stripe_payment_intent: 'pi_processing',
  }, {
    requestId: 'cancel:pending-payment',
    reason: 'Buyer cancelled before payment settled',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.amount_minor, 0);
  assert.equal(plan.refund.will_refund, false);
  assert.equal(plan.restock.will_restock, false);
  assert.equal(plan.snapshot.accounting.action, 'skip');
  assert.ok(plan.lines.every((line) => line.restock_qty === 0));
});

test('NET accounting requires void or review, never a Stripe-dependent credit memo', () => {
  assert.deepEqual(cancellationAccountingPlan({
    payment_method: 'net', qbo_sync_status: 'synced', qbo_doc_id: 'inv-9', qbo_doc_type: 'invoice',
  }), {
    required: true, action: 'void_invoice', document_id: 'inv-9', document_type: 'invoice', reason: null,
  });
  assert.equal(cancellationAccountingPlan({
    payment_method: 'net', qbo_sync_status: 'synced', qbo_doc_id: 'inv-9', qbo_doc_type: 'invoice', qbo_payment_id: 'pay-1',
  }).action, 'review');
});

test('plan hash is deterministic across object key order', async () => {
  assert.equal(await reversalPlanHash({ b: 2, a: { d: 4, c: 3 } }), await reversalPlanHash({ a: { c: 3, d: 4 }, b: 2 }));
});

test('refund delivery uses immutable command amount and stable provider identity', async () => {
  const providerCalls = [];
  const rpcCalls = [];
  const command = {
    id: COMMAND_ID,
    order_id: ORDER_ID,
    type: 'refund',
    status: 'queued',
    amount_minor: 2500,
    currency: 'usd',
    provider_idempotency_key: `order-refund:${ORDER_ID}:refund:request-1`,
    provider_object_id: null,
    snapshot: {
      order_number: 'MST-1',
      stripe_payment_intent: 'pi_1',
      qbo_sync_status: 'synced',
      total_minor: 10000,
      refunded_before_minor: 0,
    },
  };
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: command, error: null }; },
  };
  const sb = {
    from(table) {
      assert.equal(table, 'order_reversal_commands');
      return query;
    },
    async rpc(name, args) {
      rpcCalls.push([name, args]);
      if (name === 'record_order_refund_provider_success') {
        return {
          data: {
            command_id: COMMAND_ID,
            stripe_refund_id: 're_1',
            amount_minor: 2500,
            fully_refunded: false,
          },
          error: null,
        };
      }
      if (name === 'link_order_provider_object') return { data: 'link-1', error: null };
      throw new Error(`unexpected RPC: ${name}`);
    },
  };

  const result = await deliverIntegrationEffect({
    env: {},
    sb,
    effect: {
      id: 'effect-1',
      provider: 'masest',
      effect_type: 'order_refund',
      payload: { order_id: ORDER_ID, command_id: COMMAND_ID },
      lease_owner: 'worker-1',
    },
  }, {
    async createStripeRefund(_env, args) {
      providerCalls.push(args);
      return { id: 're_1' };
    },
  });

  assert.deepEqual(providerCalls, [{
    paymentIntent: 'pi_1',
    amountCents: 2500,
    idempotencyKey: `order-refund:${ORDER_ID}:refund:request-1`,
  }]);
  assert.equal(rpcCalls[0][0], 'record_order_refund_provider_success');
  assert.equal(rpcCalls[0][1].p_command_id, COMMAND_ID);
  assert.deepEqual(result.providerResult, {
    command_id: COMMAND_ID,
    stripe_refund_id: 're_1',
    amount_minor: 2500,
    fully_refunded: false,
  });
});

test('cancellation never advances while a canonical outbound label remains active', async () => {
  const effect = {
    id: 'effect-label-void',
    provider: 'masest',
    effect_type: 'order_label_void',
    payload: {
      order_id: ORDER_ID,
      command_id: COMMAND_ID,
      label_id: 'se-active-label',
      reason: 'Buyer cancelled this order',
    },
    lease_owner: 'worker-1',
  };

  await assert.rejects(
    deliverIntegrationEffect({ env: {}, sb: {}, effect }, {
      async voidOrderLabel() {
        const error = new Error('shipstation_label_void_not_allowed');
        error.code = 'shipstation_label_void_not_allowed';
        throw error;
      },
    }),
    (error) => error.code === 'shipstation_label_void_not_allowed',
  );

  const alreadyInactive = await deliverIntegrationEffect({ env: {}, sb: {}, effect }, {
    async voidOrderLabel() {
      return { already_voided: true, label_id: 'se-active-label', status: 'label_voided' };
    },
  });
  assert.equal(alreadyInactive.skipped, false);
  assert.equal(alreadyInactive.providerResult.voided, true);
});

test('reversal effects carry command identity without mutable money or line payloads', () => {
  const rows = toIntegrationEffectRows(refundCommandEffects({ id: COMMAND_ID, order_id: ORDER_ID }));
  assert.ok(rows.every((row) => row.payload.command_id === COMMAND_ID));
  assert.ok(rows.every((row) => !('amount' in row.payload) && !('lines' in row.payload)));
});

test('reversal migration claims money and lines under one Order lock', () => {
  assert.match(REVERSAL_SQL, /create table if not exists public\.order_reversal_commands/i);
  assert.match(REVERSAL_SQL, /unique \(order_id, request_id\)/i);
  assert.match(REVERSAL_SQL, /amount_minor bigint/i);
  assert.match(REVERSAL_SQL, /create table if not exists public\.order_reversal_lines/i);
  assert.match(REVERSAL_SQL, /unique \(command_id, sku\)/i);
  assert.match(REVERSAL_SQL, /create or replace function public\.claim_order_refund_command/i);
  assert.match(REVERSAL_SQL, /from public\.orders[\s\S]*for update/i);
  assert.match(REVERSAL_SQL, /reversal_revision[\s\S]*expected_revision/i);
  assert.match(REVERSAL_SQL, /sum\(command\.amount_minor\)/i);
  assert.match(REVERSAL_SQL, /sum\(line\.qty\)/i);
  assert.match(REVERSAL_SQL, /ingest_integration_event/i);
  assert.match(REVERSAL_SQL, /record_order_refund_provider_success/i);
  assert.match(REVERSAL_SQL, /apply_order_reversal_restock_effect/i);
  assert.match(REVERSAL_SQL, /apply_order_reversal_complete_effect/i);
  assert.match(REVERSAL_SQL, /reversal_full_allocation_required/i);
  assert.match(REVERSAL_SQL, /refund_full_balance_requires_full_command/i);
  assert.match(REVERSAL_SQL, /revoke all on table public\.order_reversal_commands from public, anon, authenticated/i);
});

test('reversal restock effect fails closed when any stock restoration is missed', () => {
  const restock = REVERSAL_SQL.slice(
    REVERSAL_SQL.indexOf('create or replace function public.apply_order_reversal_restock_effect'),
    REVERSAL_SQL.indexOf('create or replace function public.apply_order_reversal_cancellation_effect'),
  );
  assert.match(
    restock,
    /if not public\.increment_variant_stock\([\s\S]*?raise exception 'order_restock_failed'/i,
  );
});

test('database binds cancellation effects to exact snapshot labels and dependency chain', () => {
  const binder = REVERSAL_SQL.slice(
    REVERSAL_SQL.indexOf('create or replace function public.bind_order_reversal_effects'),
    REVERSAL_SQL.indexOf('create or replace function public.claim_order_refund_command'),
  );
  assert.match(binder, /cancellation_label_effect_mismatch/i);
  assert.match(binder, /reversal_effect_dependency_invalid/i);
  assert.match(binder, /snapshot\s*->\s*'labels'/i);
});

test('refund capacity does not double-count provider-succeeded projections', () => {
  const claim = REVERSAL_SQL.slice(
    REVERSAL_SQL.indexOf('create or replace function public.claim_order_refund_command'),
    REVERSAL_SQL.indexOf('create or replace function public.create_order_cancellation_plan'),
  );
  assert.match(claim, /command\.status in \('queued', 'review_required', 'failed'\)/);
  assert.doesNotMatch(claim, /v_claimed_minor[\s\S]{0,500}'provider_succeeded'/);
});

test('database refuses unsettled refunds and does not double-project webhook-linked refunds', () => {
  const claim = REVERSAL_SQL.slice(
    REVERSAL_SQL.indexOf('create or replace function public.claim_order_refund_command'),
    REVERSAL_SQL.indexOf('create or replace function public.create_order_cancellation_plan'),
  );
  assert.match(claim, /v_order\.status::text\s+not in \('paid', 'fulfilled'\)/i);

  const providerSuccess = REVERSAL_SQL.slice(
    REVERSAL_SQL.indexOf('create or replace function public.record_order_refund_provider_success'),
    REVERSAL_SQL.indexOf('create or replace function public.record_order_accounting_reversal_success'),
  );
  assert.match(providerSuccess, /from public\.order_provider_links/i);
  assert.match(providerSuccess, /object_type\s*=\s*'refund'/i);
  assert.match(providerSuccess, /v_refund_already_projected/i);
});

test('database confirmation blocks local or provider delivery without relying on label rows', () => {
  const confirmation = REVERSAL_SQL.slice(
    REVERSAL_SQL.indexOf('create or replace function public.confirm_order_cancellation_command'),
    REVERSAL_SQL.indexOf('create or replace function public.record_order_refund_provider_success'),
  );
  assert.match(confirmation, /v_order\.status::text\s*=\s*'fulfilled'/i);
  assert.match(confirmation, /v_order\.tracking_status::text[\s\S]{0,40}in\s+\('shipped', 'in_transit', 'out_for_delivery', 'delivered'\)/i);
});

test('database cancellation confirmation rejects a changed refund projection', () => {
  const confirmation = REVERSAL_SQL.slice(
    REVERSAL_SQL.indexOf('create or replace function public.confirm_order_cancellation_command'),
    REVERSAL_SQL.indexOf('create or replace function public.record_order_refund_provider_success'),
  );
  assert.match(confirmation, /refunded_before_minor/i);
  assert.match(confirmation, /cancellation_refund_snapshot_stale/i);
});

test('manual and provider tracking cannot race a confirmed cancellation', () => {
  assert.match(REVERSAL_SQL, /create or replace function public\.update_order_tracking_guarded/i);
  const guarded = REVERSAL_SQL.slice(
    REVERSAL_SQL.indexOf('create or replace function public.update_order_tracking_guarded'),
    REVERSAL_SQL.indexOf('create or replace function public.apply_order_reversal_restock_effect'),
  );
  assert.match(guarded, /order_reversal_commands/i);
  assert.match(guarded, /order_cancellation_in_progress/i);
  assert.match(guarded, /reversal_revision\s*=\s*reversal_revision\s*\+\s*1/i);

  const trigger = REVERSAL_SQL.slice(
    REVERSAL_SQL.indexOf('create or replace function public.guard_order_reversal_fulfillment_projection'),
    REVERSAL_SQL.indexOf('create or replace function public.validate_order_reversal_lines'),
  );
  assert.match(trigger, /returns trigger/i);
  assert.match(trigger, /new\.tracking_status[\s\S]*?in \([\s\S]*?'shipped', 'in_transit', 'out_for_delivery', 'delivered'/i);
  assert.match(trigger, /new\.status::text\s*=\s*'fulfilled'/i);
  assert.match(trigger, /order_reversal_commands/i);
  assert.match(trigger, /order_cancellation_in_progress/i);
  assert.match(trigger, /new\.reversal_revision\s*:=\s*old\.reversal_revision\s*\+\s*1/i);
  assert.match(REVERSAL_SQL, /create trigger orders_reversal_fulfillment_guard[\s\S]*before update[\s\S]*on public\.orders/i);

  const providerProjection = PROVIDER_INBOX_SQL.slice(
    PROVIDER_INBOX_SQL.indexOf('create or replace function public.apply_shipstation_tracking_integration_effect'),
    PROVIDER_INBOX_SQL.indexOf('create or replace function public.apply_resend_delivery_integration_effect'),
  );
  assert.doesNotMatch(providerProjection, /order_reversal_commands/i);
  assert.doesNotMatch(providerProjection, /reversal_revision\s*=/i);
});

test('refund status projection completes before optional notification delivery', () => {
  const binder = REVERSAL_SQL.slice(
    REVERSAL_SQL.indexOf('create or replace function public.bind_order_reversal_effects'),
    REVERSAL_SQL.indexOf('create or replace function public.claim_order_refund_command'),
  );
  assert.match(binder, /when 'order_reversal_complete'[\s\S]*depends_on_effect_key'[\s\S]*'accounting-reversal'/i);
  assert.match(binder, /when 'order_refund_email'[\s\S]*depends_on_effect_key'[\s\S]*'reversal-complete'/i);
});

test('manual create and draft line replacement are one rollback-safe transaction', () => {
  assert.match(REVERSAL_SQL, /create or replace function public\.create_manual_order_atomic/i);
  assert.match(REVERSAL_SQL, /create or replace function public\.update_draft_order_atomic/i);
  assert.match(REVERSAL_SQL, /update_draft_order_atomic[\s\S]*from public\.orders[\s\S]*for update/i);
  assert.match(REVERSAL_SQL, /update_draft_order_atomic[\s\S]*delete from public\.order_items[\s\S]*insert into public\.order_items/i);
  assert.match(REVERSAL_SQL, /manual_order_stock_unavailable/i);
  assert.match(REVERSAL_SQL, /settled_order_lines_immutable/i);
});

test('abandoned cancellation previews do not block a fresh immutable preview', () => {
  assert.match(REVERSAL_SQL, /drop index if exists public\.order_reversal_one_active_cancel_uidx/i);
  assert.match(REVERSAL_SQL, /order_reversal_one_active_cancel_uidx[\s\S]*status in \('queued', 'provider_succeeded', 'review_required', 'failed'\)/i);
  assert.doesNotMatch(REVERSAL_SQL, /order_reversal_one_active_cancel_uidx[\s\S]{0,240}status in \('planned'/i);
});

test('cancellation confirmation fences the canonical active label set and later purchases', () => {
  const confirmation = REVERSAL_SQL.slice(
    REVERSAL_SQL.indexOf('create or replace function public.confirm_order_cancellation_command'),
    REVERSAL_SQL.indexOf('create or replace function public.record_order_refund_provider_success'),
  );
  assert.match(confirmation, /order_shipment_label_ownership/i);
  assert.match(confirmation, /cancellation_label_set_stale/i);
  assert.match(confirmation, /snapshot\s*->\s*'labels'/i);

  const purchaseClaim = LABEL_OWNERSHIP_SQL.slice(
    LABEL_OWNERSHIP_SQL.indexOf('create or replace function public.claim_order_shipment_label_purchase_attempt'),
    LABEL_OWNERSHIP_SQL.indexOf('create or replace function public.claim_shipstation_label_void_attempt'),
  );
  assert.match(purchaseClaim, /order_reversal_commands/i);
  assert.match(purchaseClaim, /order_cancellation_in_progress/i);
  const orderLockAt = purchaseClaim.indexOf('from public.orders where id = p_order_id for update');
  const attemptClaimAt = purchaseClaim.indexOf('claim_shipstation_operation_attempt');
  assert.ok(
    orderLockAt >= 0 && attemptClaimAt >= 0 && orderLockAt < attemptClaimAt,
    'label purchase must lock the Order before claiming an attempt or checking cancellation',
  );
});

test('database cancellation plans enforce the same reason boundary as the service', () => {
  const createPlan = REVERSAL_SQL.slice(
    REVERSAL_SQL.indexOf('create or replace function public.create_order_cancellation_plan'),
    REVERSAL_SQL.indexOf('create or replace function public.confirm_order_cancellation_command'),
  );
  assert.match(createPlan, /char_length\(btrim\(p_reason\)\)\s+between\s+8\s+and\s+500/i);
});

test('review-required cancellation can only be retired through an audited no-side-effect command', async () => {
  const calls = [];
  const sb = {
    async rpc(name, args) {
      calls.push([name, args]);
      return {
        data: {
          id: COMMAND_ID,
          order_id: ORDER_ID,
          type: 'cancel',
          request_id: 'cancel:review-1',
          status: 'retired',
          amount_minor: 10000,
          currency: 'usd',
          retirement_reason: args.p_reason,
          retired_at: '2026-08-17T12:00:00.000Z',
        },
        error: null,
      };
    },
  };
  const result = await retireCancellationReviewCommand({
    sb,
    orderId: ORDER_ID,
    commandId: COMMAND_ID,
    reason: 'Accounting state was reconciled; create a fresh cancellation plan.',
    actor: { id: '33333333-3333-4333-8333-333333333333', email: 'finance@example.com' },
  });
  assert.equal(calls[0][0], 'retire_order_cancellation_review');
  assert.deepEqual(calls[0][1], {
    p_order_id: ORDER_ID,
    p_command_id: COMMAND_ID,
    p_reason: 'Accounting state was reconciled; create a fresh cancellation plan.',
    p_actor_user_id: '33333333-3333-4333-8333-333333333333',
    p_actor_email: 'finance@example.com',
  });
  assert.equal(result.command.status, 'retired');
  assert.equal(result.fresh_preflight_required, true);

  await assert.rejects(
    retireCancellationReviewCommand({
      sb,
      orderId: ORDER_ID,
      commandId: COMMAND_ID,
      reason: 'short',
      actor: { id: '33333333-3333-4333-8333-333333333333' },
    }),
    (error) => error.code === 'cancellation_retirement_reason_invalid',
  );

  const retirement = REVERSAL_SQL.slice(
    REVERSAL_SQL.indexOf('create or replace function public.retire_order_cancellation_review'),
    REVERSAL_SQL.indexOf('create or replace function public.record_order_refund_provider_success'),
  );
  assert.match(REVERSAL_SQL, /status in \([^)]*'retired'/i);
  assert.match(REVERSAL_SQL, /retirement_reason text/i);
  assert.match(REVERSAL_SQL, /status\s*=\s*'retired'[\s\S]{0,160}retirement_reason is not null/i);
  assert.match(REVERSAL_SQL, /new\.retirement_reason is null[\s\S]{0,120}char_length\(btrim\(new\.retirement_reason\)\)/i);
  assert.match(retirement, /v_command\.status\s*<>\s*'review_required'/i);
  assert.match(retirement, /coalesce\(v_command\.snapshot #>> '\{accounting,action\}', ''\)\s+not in/i);
  assert.match(retirement, /integration_event_id is not null/i);
  assert.match(retirement, /provider_object_id is not null/i);
  assert.match(retirement, /provider_result is not null/i);
  assert.match(retirement, /accounting_result is not null/i);
  assert.match(retirement, /confirmed_at is not null/i);
  assert.match(retirement, /status\s*=\s*'retired'/i);
  assert.match(retirement, /reversal_revision\s*=\s*reversal_revision\s*\+\s*1/i);
  assert.match(retirement, /insert into public\.audit_log/i);
  assert.match(retirement, /order\.cancellation_review_retired/i);
  assert.match(REVERSAL_SQL, /grant execute on function public\.retire_order_cancellation_review/i);
  assert.doesNotMatch(
    REVERSAL_SQL.match(/order_reversal_one_active_cancel_uidx[\s\S]*?;/i)?.[0] || '',
    /retired/i,
  );
});

test('admin exposes review-required cancellation retirement and requires a fresh plan', () => {
  assert.match(ADMIN_ORDERS_API, /retireCancellationReviewCommand/);
  assert.match(ADMIN_ORDERS_API, /body\.action\s*===\s*'retire_cancellation_review'/);
  assert.match(ADMIN_ORDERS_API, /staffCan\(role,\s*'order\.refund'\)/);
  assert.match(ADMIN_ORDERS_API, /cancellation_review/);
  assert.match(ADMIN_ORDERS_UI, /data-retire-cancellation-review/);
  assert.match(ADMIN_ORDERS_UI, /fresh cancellation preflight/i);
  assert.match(ADMIN_ORDERS_UI, /action:\s*'retire_cancellation_review'/);
});

test('every reversal RPC that locks an Order and command uses Order-before-command order', () => {
  const functions = [
    ['claim_order_refund_command', 'create_order_cancellation_plan'],
    ['create_order_cancellation_plan', 'confirm_order_cancellation_command'],
    ['confirm_order_cancellation_command', 'retire_order_cancellation_review'],
    ['retire_order_cancellation_review', 'record_order_refund_provider_success'],
    ['record_order_refund_provider_success', 'record_order_accounting_reversal_success'],
    ['record_order_accounting_reversal_success', 'create_manual_order_atomic'],
    ['apply_order_reversal_cancellation_effect', 'apply_order_reversal_complete_effect'],
    ['apply_order_reversal_complete_effect', 'claim_qbo_orders'],
  ];
  for (const [name, nextName] of functions) {
    const body = REVERSAL_SQL.slice(
      REVERSAL_SQL.indexOf(`create or replace function public.${name}`),
      REVERSAL_SQL.indexOf(`create or replace function public.${nextName}`),
    );
    const orderLockAt = body.search(
      /select \* into v_order[\s\S]{0,160}?from public\.orders[\s\S]{0,120}?for update/i,
    );
    const commandLockAt = body.search(
      /select \* into v_command[\s\S]{0,180}?from public\.order_reversal_commands[\s\S]{0,160}?for update/i,
    );
    assert.ok(orderLockAt >= 0, `${name} must lock its Order`);
    assert.ok(commandLockAt >= 0, `${name} must lock its command`);
    assert.ok(
      orderLockAt < commandLockAt,
      `${name} must lock the Order before the command to avoid a replay deadlock`,
    );
  }
});

test('admin cancellation UI confirms the exact persisted command identity', () => {
  const ui = readFileSync(new URL('../js/admin/orders.js', import.meta.url), 'utf8');
  assert.match(ui, /request_id:\s*identity\.requestId/);
  assert.match(ui, /command_id:\s*preflight\.command\.id/);
  assert.match(ui, /reversalRequestIdentity\('cancel'/);
});

test('refund command service atomically submits snapshot, allocations, and effect graph', async () => {
  const calls = [];
  const sb = {
    async rpc(name, args) {
      calls.push([name, args]);
      return {
        data: {
          id: COMMAND_ID,
          order_id: ORDER_ID,
          type: 'refund',
          request_id: 'refund:service-1',
          status: 'queued',
          amount_minor: 2500,
          currency: 'usd',
        },
        error: null,
      };
    },
  };
  const result = await queueRefundCommand({
    sb,
    orderId: ORDER_ID,
    requestId: 'refund:service-1',
    lines: [{ sku: 'A', qty: 1 }],
    actor: { id: '33333333-3333-4333-8333-333333333333', email: 'finance@example.com' },
  }, {
    loadOrder: async () => order,
    loadCommands: async () => [],
    randomUUID: () => COMMAND_ID,
  });
  assert.equal(result.command.id, COMMAND_ID);
  assert.equal(calls[0][0], 'claim_order_refund_command');
  assert.equal(calls[0][1].p_lines[0].unit_price_minor, 2500);
  assert.deepEqual(calls[0][1].p_effects.map((effect) => effect.effect_type), [
    'order_refund', 'order_restock', 'order_accounting_reversal',
    'order_reversal_complete', 'order_refund_email',
  ]);
  assert.ok(calls[0][1].p_effects.every((effect) => !('amount' in effect.payload)));
});

test('same refund request returns existing command without a second claim', async () => {
  const existing = {
    id: COMMAND_ID,
    order_id: ORDER_ID,
    type: 'refund',
    request_id: 'refund:service-replay',
    status: 'provider_succeeded',
    amount_minor: 2500,
    currency: 'usd',
    snapshot: {
      allocation_type: 'line',
      request_intent: { type: 'line', lines: [{ sku: 'A', qty: 1 }] },
      lines: [{ sku: 'A', qty: 1 }],
    },
    order_reversal_lines: [{ sku: 'A', qty: 1, restock_qty: 1 }],
  };
  const result = await queueRefundCommand({
    sb: { rpc: async () => { throw new Error('must not claim again'); } },
    orderId: ORDER_ID,
    requestId: existing.request_id,
    lines: [{ sku: 'A', qty: 1 }],
    actor: {},
  }, {
    loadCommands: async () => [existing],
    loadOrder: async () => { throw new Error('must not re-plan'); },
  });
  assert.equal(result.replay, true);
  assert.equal(result.command.id, COMMAND_ID);
});

test('same refund request identity rejects changed money or line intent', async () => {
  const existing = {
    id: COMMAND_ID,
    order_id: ORDER_ID,
    type: 'refund',
    request_id: 'refund:service-collision',
    status: 'queued',
    amount_minor: 2500,
    currency: 'usd',
    snapshot: {
      allocation_type: 'line',
      request_intent: { type: 'line', lines: [{ sku: 'A', qty: 1 }] },
      lines: [{ sku: 'A', qty: 1 }],
    },
    order_reversal_lines: [{ sku: 'A', qty: 1, restock_qty: 1 }],
  };
  await assert.rejects(
    queueRefundCommand({
      sb: {}, orderId: ORDER_ID, requestId: existing.request_id,
      lines: [{ sku: 'A', qty: 2 }], actor: {},
    }, {
      loadCommands: async () => [existing],
      loadOrder: async () => { throw new Error('must not re-plan an existing identity'); },
    }),
    (error) => error.code === 'reversal_request_identity_collision',
  );
  await assert.rejects(
    queueRefundCommand({
      sb: {}, orderId: ORDER_ID, requestId: existing.request_id,
      amount: 25, actor: {},
    }, {
      loadCommands: async () => [existing],
      loadOrder: async () => { throw new Error('must not re-plan an existing identity'); },
    }),
    (error) => error.code === 'reversal_request_identity_collision',
  );
});

test('cancellation preflight replay preserves preview shape and rejects changed reason', async () => {
  const original = cancellationCommandPlan(order, {
    requestId: 'cancel:service-replay',
    reason: 'Buyer requested cancellation',
    labels: [{ label_id: 'se-owned', order_shipment_id: 'shipment-1' }],
    recipients: ['buyer@example.com'],
  });
  const existing = {
    id: COMMAND_ID,
    order_id: ORDER_ID,
    type: 'cancel',
    request_id: original.request_id,
    status: 'planned',
    expected_revision: original.expected_revision,
    amount_minor: original.amount_minor,
    currency: original.currency,
    reason: original.reason,
    provider_idempotency_key: original.provider_idempotency_key,
    snapshot: original.snapshot,
  };
  const replay = await prepareCancellationCommand({
    sb: {}, orderId: ORDER_ID, requestId: existing.request_id,
    reason: existing.reason, actor: {},
  }, {
    loadCommands: async () => [existing],
    loadOrder: async () => { throw new Error('must not re-plan an existing identity'); },
  });
  assert.equal(replay.replay, true);
  assert.equal(replay.plan.refund.will_refund, true);
  assert.equal(replay.plan.restock.will_restock, true);
  assert.equal(replay.plan.notification.buyer, 'buyer@example.com');
  assert.equal(replay.plan.labels[0].label_id, 'se-owned');

  await assert.rejects(
    prepareCancellationCommand({
      sb: {}, orderId: ORDER_ID, requestId: existing.request_id,
      reason: 'Different cancellation reason', actor: {},
    }, {
      loadCommands: async () => [existing],
      loadOrder: async () => { throw new Error('must not re-plan an existing identity'); },
    }),
    (error) => error.code === 'reversal_request_identity_collision',
  );
});

test('cancellation service persists authoritative labels then confirms same snapshot', async () => {
  const calls = [];
  const cancellationId = '44444444-4444-4444-8444-444444444444';
  let stored;
  const sb = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'create_order_cancellation_plan') {
        stored = {
          id: cancellationId,
          order_id: ORDER_ID,
          type: 'cancel',
          request_id: 'cancel:service-1',
          status: 'planned',
          amount_minor: 10000,
          currency: 'usd',
          reason: 'Buyer requested cancellation',
          snapshot: args.p_snapshot,
        };
        return { data: stored, error: null };
      }
      if (name === 'confirm_order_cancellation_command') {
        return { data: { ...stored, status: 'queued', integration_event_id: 'event-1' }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      assert.equal(table, 'order_reversal_commands');
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: stored, error: null }; },
      };
    },
  };
  const prepared = await prepareCancellationCommand({
    sb,
    orderId: ORDER_ID,
    requestId: 'cancel:service-1',
    reason: 'Buyer requested cancellation',
    actor: { email: 'finance@example.com' },
  }, {
    loadOrder: async () => order,
    loadCommands: async () => [],
    requiredOutboundLabelVoids: () => [{ label_id: 'se-owned', order_shipment_id: 'shipment-1' }],
    companyEmails: async () => ['ops@example.com'],
    randomUUID: () => cancellationId,
  });
  assert.equal(prepared.command.id, cancellationId);
  assert.deepEqual(prepared.plan.labels.map(({ label_id }) => label_id), ['se-owned']);

  const confirmed = await confirmCancellationCommand({
    sb, orderId: ORDER_ID, commandId: cancellationId,
  });
  assert.equal(confirmed.command.status, 'queued');
  const confirmArgs = calls.find(([name]) => name === 'confirm_order_cancellation_command')[1];
  assert.equal(confirmArgs.p_effects[0].payload.label_id, 'se-owned');
  assert.ok(confirmArgs.p_effects.every((effect) => effect.payload.command_id === cancellationId));
});

test('in-transit cancellation is non-confirmable and never creates an impossible effect chain', async () => {
  let rpcCalls = 0;
  const command = {
    id: COMMAND_ID,
    order_id: ORDER_ID,
    type: 'cancel',
    request_id: 'cancel:moving-1',
    status: 'planned',
    amount_minor: 10000,
    currency: 'usd',
    reason: 'Buyer refused moving parcel',
    snapshot: {
      order_id: ORDER_ID,
      blockers: ['shipment_in_transit'],
      labels: [{ label_id: 'se-moving', will_void: true }],
    },
  };
  const sb = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: command, error: null }; },
      };
    },
    async rpc() { rpcCalls += 1; throw new Error('must not queue effects'); },
  };
  await assert.rejects(
    confirmCancellationCommand({
      sb,
      orderId: ORDER_ID,
      commandId: COMMAND_ID,
      acknowledgeInTransit: true,
    }),
    (error) => error.code === 'shipment_in_transit',
  );
  assert.equal(rpcCalls, 0);
  assert.match(REVERSAL_SQL, /snapshot\s*->\s*'blockers'[\s\S]{0,160}shipment_in_transit/i);
  const ui = readFileSync(new URL('../js/admin/orders.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /acknowledge_in_transit/);
});
