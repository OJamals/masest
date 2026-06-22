// #24 — failed-payment dunning + dispute/refund reconciliation. Pure planners decide
// what the stripe-webhook should persist/notify for each billing event, so the webhook
// stays a thin signature-verifying adapter and the decisions are unit-testable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isDelinquentStatus,
  planFailedPayment,
  planRecoveredPayment,
  planDispute,
  planRefundReconcile,
} from '../functions/_lib/dunning.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('isDelinquentStatus flags only past_due / unpaid', () => {
  assert.equal(isDelinquentStatus('past_due'), true);
  assert.equal(isDelinquentStatus('unpaid'), true);
  assert.equal(isDelinquentStatus('active'), false);
  assert.equal(isDelinquentStatus(undefined), false);
});

test('planFailedPayment extracts dunning details and marks past_due', () => {
  const plan = planFailedPayment({
    subscription: 'sub_1',
    currency: 'usd',
    amount_due: 12900,
    attempt_count: 2,
    next_payment_attempt: 1781049600, // future unix ts
    metadata: { company_id: 'co-1' },
  });
  assert.equal(plan.subscriptionId, 'sub_1');
  assert.equal(plan.companyId, 'co-1');
  assert.equal(plan.amountDue, 129);
  assert.equal(plan.currency, 'USD');
  assert.equal(plan.attempt, 2);
  assert.equal(plan.willRetry, true);
  assert.equal(plan.nextAttemptIso, new Date(1781049600 * 1000).toISOString());
  assert.equal(plan.status, 'past_due');
});

test('planFailedPayment with no further retry has willRetry false and null next attempt', () => {
  const plan = planFailedPayment({ subscription: 'sub_2', amount_due: 5000, next_payment_attempt: null });
  assert.equal(plan.willRetry, false);
  assert.equal(plan.nextAttemptIso, null);
});

test('planFailedPayment reads company_id from subscription_details metadata fallback', () => {
  const plan = planFailedPayment({ subscription: 'sub_3', subscription_details: { metadata: { company_id: 'co-9' } } });
  assert.equal(plan.companyId, 'co-9');
});

test('planRecoveredPayment marks active and carries the paid amount', () => {
  const plan = planRecoveredPayment({ subscription: 'sub_1', currency: 'usd', amount_paid: 12900, metadata: { company_id: 'co-1' } });
  assert.equal(plan.subscriptionId, 'sub_1');
  assert.equal(plan.companyId, 'co-1');
  assert.equal(plan.amountPaid, 129);
  assert.equal(plan.status, 'active');
});

test('planDispute extracts charge/PI and reason for a staff alert', () => {
  const plan = planDispute({ charge: 'ch_1', payment_intent: 'pi_1', amount: 9900, currency: 'usd', reason: 'fraudulent', status: 'needs_response' });
  assert.deepEqual(plan, { chargeId: 'ch_1', paymentIntent: 'pi_1', amount: 99, currency: 'USD', reason: 'fraudulent', status: 'needs_response' });
});

test('planRefundReconcile marks an order fully refunded when the charge covers the total', () => {
  const plan = planRefundReconcile({ payment_intent: 'pi_1', amount_refunded: 10750 }, { total: 107.5, refunded_amount: 0, status: 'paid' });
  assert.equal(plan.paymentIntent, 'pi_1');
  assert.equal(plan.refundedAmount, 107.5);
  assert.equal(plan.fullyRefunded, true);
  assert.equal(plan.status, 'refunded');
});

test('planRefundReconcile keeps status on a partial refund', () => {
  const plan = planRefundReconcile({ amount_refunded: 5000 }, { total: 107.5, refunded_amount: 0, status: 'paid' });
  assert.equal(plan.refundedAmount, 50);
  assert.equal(plan.fullyRefunded, false);
  assert.equal(plan.status, 'paid');
});

test('planRefundReconcile never lowers an already-larger recorded refund (idempotent)', () => {
  const plan = planRefundReconcile({ amount_refunded: 2000 }, { total: 107.5, refunded_amount: 50, status: 'paid' });
  assert.equal(plan.refundedAmount, 50); // keeps the larger prior amount
  assert.equal(plan.fullyRefunded, false);
});

// ---- source-contract: webhook wiring ----
const src = readFileSync(join(root, 'functions/api/stripe-webhook.js'), 'utf8');

test('stripe-webhook handles the four dunning/dispute/refund events', () => {
  assert.match(src, /invoice\.payment_failed/);
  assert.match(src, /invoice\.paid/);
  assert.match(src, /charge\.dispute\.created/);
  assert.match(src, /charge\.refunded/);
  assert.match(src, /from '\.\.\/_lib\/dunning\.js'/);
});

test('recovery email only fires when the subscription was delinquent (no renewal spam)', () => {
  assert.match(src, /isDelinquentStatus/);
});
