import { computeLineRefund, computeRefund, qboFullDocumentRefund } from './refund.js';

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function minor(value) {
  return Math.round(money(value) * 100);
}

function hasExplicitAmount(value) {
  return value !== undefined && value !== null && value !== '';
}

function refundRequestIntent({ amount, lines } = {}) {
  if (lines !== undefined) {
    if (!Array.isArray(lines) || !lines.length) return null;
    const seen = new Set();
    const normalized = [];
    for (const line of lines) {
      const sku = clean(line?.sku, 160);
      const qty = Number(line?.qty);
      if (!sku || seen.has(sku) || !Number.isSafeInteger(qty) || qty <= 0) return null;
      seen.add(sku);
      normalized.push({ sku, qty });
    }
    return { type: 'line', lines: normalized.sort((left, right) => left.sku.localeCompare(right.sku)) };
  }
  if (hasExplicitAmount(amount)) {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return { type: 'amount', amount_minor: Math.round(numeric * 100) };
  }
  return { type: 'full' };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function canonicalOrderLines(items = []) {
  const lines = new Map();
  for (const item of items) {
    const sku = clean(item?.sku, 160);
    const qty = Math.floor(Number(item?.qty) || 0);
    if (!sku || qty <= 0) continue;
    const unitPrice = money(item?.unit_price);
    const current = lines.get(sku);
    if (current) {
      if (current.unit_price !== unitPrice) return { ok: false, error: 'refund_lines_invalid' };
      current.qty += qty;
      current.line_total = money(current.unit_price * current.qty);
      if (!item?.backordered) current.restock_qty += qty;
    } else {
      lines.set(sku, {
        sku,
        qty,
        unit_price: unitPrice,
        line_total: money(unitPrice * qty),
        restock_qty: item?.backordered ? 0 : qty,
      });
    }
  }
  return { ok: true, lines: [...lines.values()] };
}

export function normalizeReversalRequestId(value) {
  const requestId = clean(value, 128);
  return REQUEST_ID.test(requestId) ? requestId : null;
}

export function normalizeReversalCommandId(value) {
  const commandId = clean(value, 40);
  return UUID.test(commandId) ? commandId : null;
}

export async function reversalPlanHash(plan) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(plan || {})));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function refundCommandPlan(order, {
  requestId,
  amount,
  lines,
  refundedLines = [],
} = {}) {
  const normalizedRequestId = normalizeReversalRequestId(requestId);
  if (!normalizedRequestId) return { ok: false, error: 'refund_request_id_required' };
  if (!order?.id) return { ok: false, error: 'not_found' };
  if (['cancelled', 'refunded', 'cart'].includes(clean(order.status, 40))) {
    return { ok: false, error: 'not_refundable' };
  }
  if (!['paid', 'fulfilled'].includes(clean(order.status, 40))) {
    return { ok: false, error: 'not_refundable' };
  }
  if (clean(order.payment_method, 20) !== 'stripe' || !clean(order.stripe_payment_intent, 200)) {
    return { ok: false, error: 'not_refundable' };
  }
  if (lines !== undefined && hasExplicitAmount(amount)) {
    return { ok: false, error: 'refund_intent_ambiguous' };
  }

  const requestIntent = refundRequestIntent({ amount, lines });
  if (!requestIntent) return { ok: false, error: 'refund_intent_invalid' };

  let lineRefund = null;
  if (lines !== undefined) {
    lineRefund = computeLineRefund({
      orderItems: order.order_items || [],
      lines,
      refundedLines,
    });
    if (!lineRefund.ok) return lineRefund;
  }
  const refund = computeRefund({
    total: order.total,
    refundedAmount: order.refunded_amount,
    requestedAmount: lineRefund ? lineRefund.amount : amount,
  });
  if (!refund.ok) return refund;

  const selectedLines = [...(lineRefund?.lines || [])]
    .sort((left, right) => left.sku.localeCompare(right.sku));
  const full = refund.fullyRefunded
    ? remainingOrderLines(order.order_items || [], refundedLines)
    : { ok: true, lines: [] };
  if (!full.ok) return full;
  const fullOrderLines = [...full.lines].sort((left, right) => left.sku.localeCompare(right.sku));
  if (lineRefund && refund.fullyRefunded) {
    const selectedCoversAll = selectedLines.length === fullOrderLines.length
      && selectedLines.every((line, index) => (
        line.sku === fullOrderLines[index]?.sku && line.qty === fullOrderLines[index]?.qty
      ));
    if (!selectedCoversAll) {
      return { ok: false, error: 'refund_full_balance_requires_full_command' };
    }
  }
  const allocatedLines = refund.fullyRefunded ? fullOrderLines : selectedLines;
  const restockLines = allocatedLines
    .filter((line) => Number(line.restock_qty) > 0)
    .map((line) => ({ sku: line.sku, qty: Number(line.restock_qty) }));
  const allocationType = refund.fullyRefunded ? 'full' : lineRefund ? 'line' : 'amount';

  return {
    ok: true,
    type: 'refund',
    request_id: normalizedRequestId,
    order_id: order.id,
    expected_revision: Math.max(0, Math.floor(Number(order.reversal_revision) || 0)),
    currency: clean(order.currency, 8).toLowerCase() || 'usd',
    amount: refund.amount,
    amount_minor: refund.amountCents,
    fully_refunded: refund.fullyRefunded,
    provider_idempotency_key: `order-refund:${order.id}:${normalizedRequestId}`,
    lines: allocatedLines.map((line) => ({
      sku: line.sku,
      qty: line.qty,
      unit_price: money(line.unit_price),
      unit_price_minor: minor(line.unit_price),
      line_total: money(line.line_total),
      line_amount_minor: minor(line.line_total),
      restock_qty: Math.max(0, Math.floor(Number(line.restock_qty) || 0)),
    })),
    restock_lines: restockLines,
    snapshot: {
      order_id: order.id,
      order_number: clean(order.order_number, 80) || null,
      status: clean(order.status, 40),
      payment_method: clean(order.payment_method, 20),
      stripe_payment_intent: clean(order.stripe_payment_intent, 200),
      qbo_sync_status: clean(order.qbo_sync_status, 40) || null,
      qbo_doc_id: clean(order.qbo_doc_id || order.qbo_invoice_id, 160) || null,
      qbo_doc_type: clean(order.qbo_doc_type, 40) || null,
      qbo_payment_id: clean(order.qbo_payment_id, 160) || null,
      accounting: cancellationAccountingPlan(order),
      total_minor: minor(order.total),
      refunded_before_minor: minor(order.refunded_amount),
      allocation_type: allocationType,
      request_intent: requestIntent,
      recipient: clean(order.customer_email, 254).toLowerCase() || null,
      company_id: order.company_id || null,
      lines: allocatedLines,
      restock_lines: restockLines,
    },
  };
}

export function refundRequestMatchesCommand(command, input = {}) {
  if (!command || command.type !== 'refund') return false;
  const requested = refundRequestIntent(input);
  const stored = command.snapshot?.request_intent;
  return Boolean(requested && stored && JSON.stringify(requested) === JSON.stringify(stored));
}

export function refundCommandEffects(command) {
  const commandId = normalizeReversalCommandId(command?.id);
  if (!commandId) throw new Error('invalid_reversal_command_id');
  const orderId = command.order_id;
  const row = (effectKey, effectType, dependsOnEffectKey = null) => ({
    effect_key: effectKey,
    effect_type: effectType,
    aggregate_type: 'order',
    aggregate_id: orderId,
    depends_on_effect_key: dependsOnEffectKey,
    payload: { order_id: orderId, command_id: commandId },
    max_attempts: 8,
  });
  return [
    row('stripe-refund', 'order_refund'),
    row('order-restock', 'order_restock', 'stripe-refund'),
    row('accounting-reversal', 'order_accounting_reversal', 'order-restock'),
    row('reversal-complete', 'order_reversal_complete', 'accounting-reversal'),
    row('refund-email', 'order_refund_email', 'reversal-complete'),
  ];
}

export function cancellationAccountingPlan(order) {
  const method = clean(order?.payment_method, 20);
  const sync = clean(order?.qbo_sync_status, 40);
  const documentId = clean(order?.qbo_doc_id || order?.qbo_invoice_id, 160) || null;
  const documentType = clean(order?.qbo_doc_type, 40) || null;
  const paymentId = clean(order?.qbo_payment_id, 160) || null;
  if (sync === 'skipped') return { required: false, action: 'skip', reason: 'qbo_sync_skipped' };
  if (method === 'stripe' && !['paid', 'fulfilled'].includes(clean(order?.status, 40))) {
    if (documentId || paymentId || ['processing', 'synced'].includes(sync)) {
      return { required: true, action: 'review', reason: 'unsettled_stripe_accounting_linked' };
    }
    return { required: false, action: 'skip', reason: 'payment_not_settled' };
  }
  if (method === 'net') {
    if (paymentId) return { required: true, action: 'review', reason: 'qbo_payment_linked' };
    if (documentId && documentType && documentType !== 'invoice') {
      return { required: true, action: 'review', reason: 'qbo_document_type_unsupported' };
    }
    return {
      required: true,
      action: documentId ? 'void_invoice' : 'skip_pending_invoice',
      document_id: documentId,
      document_type: documentType || (documentId ? 'invoice' : null),
      reason: null,
    };
  }
  return {
    required: method === 'stripe' && sync !== 'skipped',
    action: method === 'stripe' && sync !== 'skipped' ? 'credit_memo' : 'skip',
    reason: method === 'stripe' ? null : 'no_accounting_reversal',
  };
}

function remainingOrderLines(orderItems, refundedLines) {
  const canonicalLines = canonicalOrderLines(orderItems);
  if (!canonicalLines.ok) return canonicalLines;
  const claimed = new Map();
  for (const line of Array.isArray(refundedLines) ? refundedLines : []) {
    const sku = clean(line?.sku, 160);
    const qty = Math.max(0, Math.floor(Number(line?.qty) || 0));
    const restockQty = Math.max(0, Math.floor(Number(line?.restock_qty) || 0));
    if (!sku || qty <= 0) continue;
    const current = claimed.get(sku) || { qty: 0, restock_qty: 0 };
    current.qty += qty;
    current.restock_qty += restockQty;
    claimed.set(sku, current);
  }
  const lines = [];
  for (const line of canonicalLines.lines) {
    const prior = claimed.get(line.sku) || { qty: 0, restock_qty: 0 };
    const qty = line.qty - prior.qty;
    const restockQty = line.restock_qty - prior.restock_qty;
    if (qty < 0 || restockQty < 0 || restockQty > qty) {
      return { ok: false, error: 'reversal_line_capacity_exceeded' };
    }
    if (!qty) continue;
    lines.push({
      ...line,
      qty,
      line_total: money(line.unit_price * qty),
      restock_qty: restockQty,
    });
  }
  return { ok: true, lines };
}

export function cancellationCommandPlan(order, {
  requestId,
  reason,
  labels = [],
  refundedLines = [],
  recipients = [],
} = {}) {
  const normalizedRequestId = normalizeReversalRequestId(requestId);
  if (!normalizedRequestId) return { ok: false, error: 'cancellation_request_id_required' };
  if (!order?.id) return { ok: false, error: 'not_found' };
  const normalizedReason = clean(reason, 500);
  if (normalizedReason.length < 8) return { ok: false, error: 'cancel_reason_required' };
  const status = clean(order.status, 40);
  if (['cart', 'cancelled', 'refunded'].includes(status)) {
    return { ok: false, error: status === 'cart' ? 'not_an_order' : `already_${status}` };
  }

  const settled = ['paid', 'net_open', 'net_paid', 'fulfilled'].includes(status);
  const remaining = remainingOrderLines(order.order_items || [], refundedLines);
  if (!remaining.ok) return remaining;
  const isStripe = ['paid', 'fulfilled'].includes(status)
    && clean(order.payment_method, 20) === 'stripe'
    && Boolean(clean(order.stripe_payment_intent, 200));
  const refund = isStripe
    ? computeRefund({ total: order.total, refundedAmount: order.refunded_amount })
    : { ok: false, error: 'not_stripe_paid', amount: 0, amountCents: 0 };
  if (isStripe && !refund.ok) return refund;

  const normalizedLabels = (Array.isArray(labels) ? labels : [])
    .map((label) => ({
      label_id: clean(label?.label_id, 160),
      order_shipment_id: label?.order_shipment_id || null,
      provider_link_id: label?.provider_link_id || null,
      tracking_status: clean(label?.tracking_status, 80) || null,
      effect_key: clean(label?.effect_key, 255) || null,
      will_void: true,
    }))
    .filter((label) => label.label_id)
    .sort((left, right) => left.label_id.localeCompare(right.label_id));
  const movingStatuses = ['shipped', 'in_transit', 'out_for_delivery', 'delivered'];
  const blockers = status === 'fulfilled'
    || movingStatuses.includes(clean(order.tracking_status, 80))
    || normalizedLabels.some((label) => movingStatuses.includes(label.tracking_status))
    ? ['shipment_in_transit'] : [];
  const normalizedRecipients = [...new Set((Array.isArray(recipients) ? recipients : [])
    .map((value) => clean(value, 254).toLowerCase())
    .filter((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)))];
  const accounting = cancellationAccountingPlan(order);
  const currency = clean(order.currency, 8).toLowerCase() || 'usd';
  const lines = remaining.lines.map((line) => ({
    sku: line.sku,
    qty: line.qty,
    unit_price: money(line.unit_price),
    unit_price_minor: minor(line.unit_price),
    line_total: money(line.line_total),
    line_amount_minor: minor(line.line_total),
    restock_qty: settled ? line.restock_qty : 0,
  }));
  const amountMinor = refund.ok ? refund.amountCents : 0;
  const snapshot = {
    order_id: order.id,
    order_number: clean(order.order_number, 80) || null,
    status,
    payment_method: clean(order.payment_method, 20),
    stripe_payment_intent: clean(order.stripe_payment_intent, 200) || null,
    total_minor: minor(order.total),
    refunded_before_minor: minor(order.refunded_amount),
    allocation_type: 'full',
    labels: normalizedLabels,
    lines,
    accounting,
    blockers,
    notification: { recipients: normalizedRecipients },
  };
  return cancellationPlanFromCommand({
    type: 'cancel',
    request_id: normalizedRequestId,
    order_id: order.id,
    expected_revision: Math.max(0, Math.floor(Number(order.reversal_revision) || 0)),
    reason: normalizedReason,
    currency,
    amount_minor: amountMinor,
    provider_idempotency_key: amountMinor > 0
      ? `order-refund:${order.id}:${normalizedRequestId}`
      : null,
    snapshot,
  });
}

export function cancellationRequestMatchesCommand(command, { reason } = {}) {
  return Boolean(command?.type === 'cancel' && clean(reason, 500) === clean(command.reason, 500));
}

export function cancellationPlanFromCommand(command) {
  if (!command || command.type !== 'cancel' || !command.snapshot || typeof command.snapshot !== 'object') {
    return null;
  }
  const snapshot = command.snapshot;
  const labels = Array.isArray(snapshot.labels) ? snapshot.labels : [];
  const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  const blockers = Array.isArray(snapshot.blockers) ? snapshot.blockers : [];
  const recipients = Array.isArray(snapshot.notification?.recipients)
    ? snapshot.notification.recipients
    : [];
  const accounting = snapshot.accounting && typeof snapshot.accounting === 'object'
    ? snapshot.accounting
    : { required: true, action: 'review', reason: 'accounting_snapshot_missing' };
  const amountMinor = Number(command.amount_minor);
  const normalizedAmountMinor = Number.isSafeInteger(amountMinor) && amountMinor >= 0 ? amountMinor : 0;
  const currency = clean(command.currency, 8).toLowerCase() || 'usd';
  const settled = ['paid', 'net_open', 'net_paid', 'fulfilled'].includes(clean(snapshot.status, 40));
  const restockLines = lines.filter((line) => Number(line?.restock_qty) > 0)
    .map((line) => ({ sku: line.sku, qty: Number(line.restock_qty) }));
  return {
    ok: true,
    type: 'cancel',
    request_id: command.request_id,
    order_id: command.order_id || snapshot.order_id,
    order_number: snapshot.order_number || null,
    expected_revision: Math.max(0, Math.floor(Number(command.expected_revision) || 0)),
    reason: clean(command.reason, 500),
    currency,
    amount: normalizedAmountMinor / 100,
    amount_minor: normalizedAmountMinor,
    provider_idempotency_key: command.provider_idempotency_key || null,
    blockers,
    labels,
    label: {
      will_void: labels.length > 0,
      label_id: labels[0]?.label_id || null,
      count: labels.length,
      reason: labels.length ? null : 'no_label',
    },
    refund: {
      will_refund: normalizedAmountMinor > 0,
      amount: normalizedAmountMinor / 100,
      currency,
      reason: normalizedAmountMinor > 0 ? null : 'not_stripe_paid',
    },
    restock: {
      will_restock: settled && restockLines.length > 0,
      lines: restockLines,
      reason: settled ? null : 'stock_never_reserved',
    },
    accounting: {
      ...accounting,
      will_credit_memo: accounting.action === 'credit_memo',
    },
    notification: { recipients, buyer: recipients[0] || null },
    lines,
    snapshot,
  };
}

export function cancellationCommandEffects(plan, command) {
  const commandId = normalizeReversalCommandId(command?.id);
  if (!commandId) throw new Error('invalid_reversal_command_id');
  const orderId = plan.order_id;
  const effects = [];
  let dependency = null;
  for (const [index, label] of (plan.labels || []).entries()) {
    const effectKey = `label-void-${index + 1}`;
    effects.push({
      effect_key: effectKey,
      effect_type: 'order_label_void',
      aggregate_type: 'order',
      aggregate_id: orderId,
      depends_on_effect_key: dependency,
      payload: {
        order_id: orderId,
        command_id: commandId,
        label_id: label.will_void ? label.label_id : null,
        reason: plan.reason || 'Order cancelled by MASEST staff',
      },
      max_attempts: 5,
    });
    dependency = effectKey;
  }
  if (!effects.length) {
    effects.push({
      effect_key: 'label-void-1',
      effect_type: 'order_label_void',
      aggregate_type: 'order',
      aggregate_id: orderId,
      payload: { order_id: orderId, command_id: commandId, label_id: null, reason: plan.reason },
      max_attempts: 5,
    });
    dependency = 'label-void-1';
  }
  const add = (effectKey, effectType, payload = {}) => {
    effects.push({
      effect_key: effectKey,
      effect_type: effectType,
      aggregate_type: 'order',
      aggregate_id: orderId,
      depends_on_effect_key: dependency,
      payload: { order_id: orderId, command_id: commandId, ...payload },
      max_attempts: 8,
    });
    dependency = effectKey;
  };
  add('stripe-refund', 'order_refund');
  add('order-restock', 'order_restock');
  add('accounting-reversal', 'order_accounting_reversal');
  add('order-cancelled', 'order_cancelled', { reason: plan.reason });
  add('cancellation-email', 'order_cancellation_email', { reason: plan.reason });
  add('reversal-complete', 'order_reversal_complete');
  return effects;
}

export function qboFullRefundFromCommand(command) {
  const snapshot = command?.snapshot || {};
  return qboFullDocumentRefund({
    total: Number(snapshot.total_minor || 0) / 100,
    refundedAmount: Number(snapshot.refunded_before_minor || 0) / 100,
    amount: Number(command?.amount_minor || 0) / 100,
  });
}
