// Cancelling a paid order is a five-provider transaction: void the ShipEngine label, refund
// at Stripe, return stock, reverse the QBO document, tell the buyer. Run inline, a failure
// halfway through leaves an order that is refunded but not cancelled, or cancelled with a
// live label still out for pickup — and the staff member has no way to know which.
//
// So cancellation is planned first (a preflight the operator confirms) and then executed as
// dependent effect rows on the integration ledger. Each step is idempotent and retried on
// its own; the per-order timeline shows exactly how far the chain got.
import { computeRefund, qboFullDocumentRefund } from './refund.js';
import { orderReference } from './order-integrations.js';

// Tracking states where the parcel is already moving. Voiding a label the carrier has
// scanned does not stop the shipment, it just loses the postage refund.
const IN_FLIGHT_TRACKING = new Set(['shipped', 'in_transit', 'out_for_delivery', 'delivered']);
const VOIDED_LABEL_STATES = new Set(['label_voided', 'voided']);

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

export function labelIsVoidable(order) {
  const labelId = text(order?.shipstation_label_id, 100);
  if (!labelId) return { voidable: false, reason: 'no_label' };
  if (VOIDED_LABEL_STATES.has(text(order?.shipstation_label_status, 80))) {
    return { voidable: false, reason: 'already_voided' };
  }
  if (IN_FLIGHT_TRACKING.has(text(order?.tracking_status, 40))) {
    return { voidable: false, reason: 'shipment_in_transit' };
  }
  return { voidable: true, labelId };
}

// What a cancellation would actually do, computed before anything moves. This is what the
// confirmation dialog renders — staff approve a specific set of consequences, not a verb.
export function planOrderCancellation(order, { reason = null } = {}) {
  const status = text(order?.status, 40);
  const blockers = [];
  if (status === 'cancelled') blockers.push('already_cancelled');
  if (status === 'refunded') blockers.push('already_refunded');
  if (status === 'cart') blockers.push('not_an_order');
  if (IN_FLIGHT_TRACKING.has(text(order?.tracking_status, 40))) {
    // Not a hard stop: staff cancel delivered orders during disputes. It is a warning the
    // dialog must show, because the parcel is gone and the postage is not coming back.
    blockers.push('shipment_in_transit');
  }

  const label = labelIsVoidable(order);
  const isStripe = text(order?.payment_method, 20) === 'stripe'
    && Boolean(text(order?.stripe_payment_intent, 200));
  const refundPlan = isStripe
    ? computeRefund({ total: order?.total, refundedAmount: order?.refunded_amount })
    : { ok: false, error: 'not_stripe_paid' };

  const restockLines = (order?.order_items || [])
    .filter((item) => !item?.backordered && text(item?.sku, 160))
    .map((item) => ({ sku: text(item.sku, 160), qty: Number(item.qty) || 0 }))
    .filter((item) => item.qty > 0);

  const settled = ['paid', 'net_open', 'net_paid', 'fulfilled'].includes(status);

  return {
    order_id: order?.id || null,
    order_number: orderReference(order) || null,
    reason: text(reason, 500) || null,
    blockers,
    // `net_open` is an open receivable, not money MASEST holds. Cancelling it voids the
    // invoice; there is nothing to refund at Stripe.
    payment_method: text(order?.payment_method, 20) || null,
    label: {
      will_void: label.voidable,
      label_id: label.voidable ? label.labelId : text(order?.shipstation_label_id, 100) || null,
      reason: label.voidable ? null : label.reason,
      postage_at_risk: label.voidable ? money(order?.shipstation_cost) : 0,
    },
    refund: {
      will_refund: Boolean(refundPlan.ok),
      amount: refundPlan.ok ? refundPlan.amount : 0,
      currency: text(order?.currency, 8) || 'usd',
      reason: refundPlan.ok ? null : refundPlan.error,
    },
    restock: {
      will_restock: settled && restockLines.length > 0,
      lines: settled ? restockLines : [],
      reason: settled ? null : 'stock_never_reserved',
    },
    accounting: {
      will_credit_memo: Boolean(refundPlan.ok) && text(order?.qbo_sync_status, 40) !== 'skipped',
      fully_refunded: refundPlan.ok
        ? qboFullDocumentRefund({
          total: order?.total,
          refundedAmount: order?.refunded_amount,
          amount: refundPlan.amount,
        })
        : false,
    },
    notification: {
      buyer: text(order?.customer_email, 254) || null,
      company_id: order?.company_id || null,
    },
  };
}

// Effect rows for the plan. Dependencies encode the only safe order: reverse the shipment
// before the money, the money before the books, and tell the buyer last — after everything
// that could still fail has succeeded.
export function orderCancellationEffects(plan) {
  const orderId = plan.order_id;
  const effects = [{
    effect_key: 'label-void',
    effect_type: 'order_label_void',
    aggregate_type: 'order',
    aggregate_id: orderId,
    payload: {
      order_id: orderId,
      label_id: plan.label.will_void ? plan.label.label_id : null,
      reason: plan.reason || 'Order cancelled by MASEST staff',
    },
    max_attempts: 5,
  }];

  effects.push({
    effect_key: 'stripe-refund',
    effect_type: 'order_refund',
    aggregate_type: 'order',
    aggregate_id: orderId,
    depends_on_effect_key: 'label-void',
    payload: {
      order_id: orderId,
      amount: plan.refund.will_refund ? plan.refund.amount : 0,
    },
    max_attempts: 8,
  });

  effects.push({
    effect_key: 'order-restock',
    effect_type: 'order_restock',
    aggregate_type: 'order',
    aggregate_id: orderId,
    depends_on_effect_key: 'stripe-refund',
    payload: { order_id: orderId },
    max_attempts: 5,
  });

  effects.push({
    effect_key: 'qbo-credit-memo',
    effect_type: 'order_credit_memo',
    aggregate_type: 'order',
    aggregate_id: orderId,
    depends_on_effect_key: 'stripe-refund',
    payload: { order_id: orderId },
    max_attempts: 5,
  });

  effects.push({
    effect_key: 'order-cancelled',
    effect_type: 'order_cancelled',
    aggregate_type: 'order',
    aggregate_id: orderId,
    depends_on_effect_key: 'order-restock',
    payload: { order_id: orderId, reason: plan.reason },
    max_attempts: 5,
  });

  effects.push({
    effect_key: 'cancellation-email',
    effect_type: 'order_cancellation_email',
    aggregate_type: 'order',
    aggregate_id: orderId,
    depends_on_effect_key: 'order-cancelled',
    payload: { order_id: orderId, reason: plan.reason },
    max_attempts: 5,
  });

  return effects;
}

// Deterministic event id: replaying the same cancellation is a no-op at the ledger rather
// than a second refund. `attempt` lets staff deliberately re-run a chain that dead-lettered.
export function cancellationEventId(orderId, attempt = 1) {
  return `cancel:${orderId}:${Math.max(1, Math.floor(Number(attempt) || 1))}`;
}
