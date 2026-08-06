import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cancellationEventId,
  labelIsVoidable,
  orderCancellationEffects,
  planOrderCancellation,
} from '../functions/_lib/order-cancellation.js';
import { toIntegrationEffectRows } from '../functions/_lib/integration-effects.js';
import { computeLineRefund } from '../functions/_lib/refund.js';

const paidOrder = {
  id: '11111111-1111-4111-8111-111111111111',
  order_number: 'MA-1042',
  status: 'paid',
  payment_method: 'stripe',
  stripe_payment_intent: 'pi_123',
  total: 240.5,
  refunded_amount: 0,
  currency: 'usd',
  company_id: 'c1',
  customer_email: 'buyer@example.com',
  qbo_sync_status: 'pending',
  tracking_status: 'packing',
  shipstation_label_id: 'se-label-1',
  shipstation_label_status: 'label_purchased',
  shipstation_cost: 18.4,
  order_items: [
    { sku: 'VK-CR-2.5G', qty: 2, unit_price: 100, backordered: false },
    { sku: 'VK-HCR-1G', qty: 1, unit_price: 40.5, backordered: true },
  ],
};

test('preflight states every consequence before anything moves', () => {
  const plan = planOrderCancellation(paidOrder, { reason: 'Buyer ordered the wrong size' });
  assert.equal(plan.order_number, 'MA-1042');
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.label.will_void, true);
  assert.equal(plan.label.postage_at_risk, 18.4);
  assert.equal(plan.refund.will_refund, true);
  assert.equal(plan.refund.amount, 240.5);
  assert.equal(plan.accounting.will_credit_memo, true);
  assert.equal(plan.accounting.fully_refunded, true);
  // The backordered line never decremented stock, so it must not increment it back.
  assert.deepEqual(plan.restock.lines, [{ sku: 'VK-CR-2.5G', qty: 2 }]);
});

test('a moving parcel is surfaced as a blocker, and its label is not voidable', () => {
  const shipped = { ...paidOrder, tracking_status: 'in_transit' };
  const plan = planOrderCancellation(shipped, { reason: 'Refused at the dock' });
  assert.ok(plan.blockers.includes('shipment_in_transit'));
  assert.equal(plan.label.will_void, false);
  assert.equal(plan.label.reason, 'shipment_in_transit');
  assert.equal(plan.label.postage_at_risk, 0);
  // Money is still recoverable even when the parcel is not.
  assert.equal(plan.refund.will_refund, true);
});

test('an unsettled order restocks nothing and refunds nothing', () => {
  const pending = {
    ...paidOrder,
    status: 'pending_payment',
    payment_method: 'net',
    stripe_payment_intent: null,
  };
  const plan = planOrderCancellation(pending, { reason: 'ACH never cleared' });
  assert.equal(plan.refund.will_refund, false);
  assert.equal(plan.refund.reason, 'not_stripe_paid');
  assert.equal(plan.restock.will_restock, false);
  assert.equal(plan.restock.reason, 'stock_never_reserved');
});

test('already-terminal orders are blocked rather than double-reversed', () => {
  for (const [status, blocker] of [['cancelled', 'already_cancelled'], ['refunded', 'already_refunded']]) {
    const plan = planOrderCancellation({ ...paidOrder, status }, {});
    assert.ok(plan.blockers.includes(blocker), `${status} should block`);
  }
});

test('labels already voided are not voided twice', () => {
  assert.deepEqual(
    labelIsVoidable({ ...paidOrder, shipstation_label_status: 'label_voided' }),
    { voidable: false, reason: 'already_voided' },
  );
  assert.deepEqual(
    labelIsVoidable({ ...paidOrder, shipstation_label_id: null }),
    { voidable: false, reason: 'no_label' },
  );
});

test('effect chain reverses the shipment before the money, and notifies last', () => {
  const plan = planOrderCancellation(paidOrder, { reason: 'Buyer ordered the wrong size' });
  const rows = toIntegrationEffectRows(orderCancellationEffects(plan));
  const order = rows.map((row) => row.effect_key);
  assert.deepEqual(order, [
    'label-void', 'stripe-refund', 'order-restock', 'qbo-credit-memo',
    'order-cancelled', 'cancellation-email',
  ]);
  const dependsOn = Object.fromEntries(rows.map((row) => [row.effect_key, row.depends_on_effect_key]));
  assert.equal(dependsOn['label-void'], null);
  assert.equal(dependsOn['stripe-refund'], 'label-void');
  assert.equal(dependsOn['qbo-credit-memo'], 'stripe-refund');
  assert.equal(dependsOn['order-restock'], 'stripe-refund');
  assert.equal(dependsOn['order-cancelled'], 'order-restock');
  // The buyer is told only after the order is actually closed.
  assert.equal(dependsOn['cancellation-email'], 'order-cancelled');
});

test('a chain with no label and no refund still produces skippable steps, not missing ones', () => {
  const plan = planOrderCancellation(
    { ...paidOrder, shipstation_label_id: null, payment_method: 'net', stripe_payment_intent: null },
    { reason: 'Duplicate purchase order' },
  );
  const rows = toIntegrationEffectRows(orderCancellationEffects(plan));
  assert.equal(rows.length, 6);
  assert.equal(rows.find((row) => row.effect_key === 'label-void').payload.label_id, null);
  assert.equal(rows.find((row) => row.effect_key === 'stripe-refund').payload.amount, 0);
});

test('replaying a cancellation reuses its event id so the ledger dedupes it', () => {
  assert.equal(cancellationEventId(paidOrder.id), `cancel:${paidOrder.id}:1`);
  assert.equal(cancellationEventId(paidOrder.id, 1), cancellationEventId(paidOrder.id));
  // A deliberate re-run after a dead-lettered chain gets a distinct identity.
  assert.notEqual(cancellationEventId(paidOrder.id, 2), cancellationEventId(paidOrder.id, 1));
});

test('line refunds derive their amount from the order, not from the request', () => {
  const refund = computeLineRefund({
    orderItems: paidOrder.order_items,
    lines: [{ sku: 'VK-CR-2.5G', qty: 2 }],
  });
  assert.equal(refund.ok, true);
  assert.equal(refund.amount, 200);
  assert.equal(refund.lines[0].line_total, 200);
});

test('line refunds reject quantities the order never contained', () => {
  for (const lines of [
    [{ sku: 'VK-CR-2.5G', qty: 3 }],
    [{ sku: 'NOT-ON-ORDER', qty: 1 }],
    [{ sku: 'VK-CR-2.5G', qty: 1 }, { sku: 'VK-CR-2.5G', qty: 1 }],
    [{ sku: 'VK-CR-2.5G', qty: 0 }],
  ]) {
    assert.equal(computeLineRefund({ orderItems: paidOrder.order_items, lines }).ok, false);
  }
  assert.equal(computeLineRefund({ orderItems: paidOrder.order_items, lines: [] }).error, 'refund_lines_required');
});
