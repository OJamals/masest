// Pure planners for failed-payment dunning + dispute/refund reconciliation (#24).
// The stripe-webhook stays a thin signature-verifying adapter; these decide what to
// persist and notify for each billing event, so the logic is unit-testable in isolation.
import { centsToAmount } from './order-shape.js';
import { round2 } from './credit.js';

// A subscription Stripe has stopped collecting on (smart-retries failed or exhausted).
export function isDelinquentStatus(status) {
  return status === 'past_due' || status === 'unpaid';
}

function companyIdOf(invoice) {
  return invoice?.metadata?.company_id
    || invoice?.subscription_details?.metadata?.company_id
    || null;
}

// invoice.payment_failed → customer dunning notice. Stripe owns the retry schedule;
// we surface it (next_payment_attempt is a unix ts, or null when no more retries).
export function planFailedPayment(invoice) {
  const next = invoice?.next_payment_attempt || null;
  return {
    subscriptionId: invoice?.subscription || null,
    companyId: companyIdOf(invoice),
    amountDue: centsToAmount(invoice?.amount_due),
    currency: (invoice?.currency || 'usd').toUpperCase(),
    attempt: invoice?.attempt_count || 0,
    willRetry: !!next,
    nextAttemptIso: next ? new Date(next * 1000).toISOString() : null,
    status: 'past_due',
  };
}

// invoice.paid → the subscription is collecting again. Caller only emails a "recovered"
// notice when the prior status was delinquent, so ordinary renewals stay silent.
export function planRecoveredPayment(invoice) {
  return {
    subscriptionId: invoice?.subscription || null,
    companyId: companyIdOf(invoice),
    amountPaid: centsToAmount(invoice?.amount_paid),
    currency: (invoice?.currency || 'usd').toUpperCase(),
    status: 'active',
  };
}

// charge.dispute.created → staff-alert payload + the charge/PI used to locate the order.
export function planDispute(dispute) {
  return {
    chargeId: dispute?.charge || null,
    paymentIntent: dispute?.payment_intent || null,
    amount: centsToAmount(dispute?.amount),
    currency: (dispute?.currency || 'usd').toUpperCase(),
    reason: dispute?.reason || 'unknown',
    status: dispute?.status || 'needs_response',
  };
}

// charge.refunded → reconcile the order's refunded_amount/status to mirror a refund issued
// in the Stripe dashboard (or by another path). Idempotent: never lowers a larger recorded
// refund, and only flips to 'refunded' once the charge covers the full order total.
export function planRefundReconcile(charge, order) {
  const charged = centsToAmount(charge?.amount_refunded);
  const total = Number(order?.total) || 0;
  const refundedAmount = round2(Math.max(charged, Number(order?.refunded_amount) || 0));
  const fullyRefunded = total > 0 && refundedAmount >= total;
  return {
    paymentIntent: charge?.payment_intent || null,
    refundedAmount,
    fullyRefunded,
    status: fullyRefunded ? 'refunded' : (order?.status || null),
  };
}
