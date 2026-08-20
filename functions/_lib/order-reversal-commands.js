import { computeLineRefund, computeRefund } from './refund.js';
import { companyEmails } from './supabase.js';
import { requiredOutboundLabelVoids } from './shipment-label-ownership.js';
import { toIntegrationEffectRows } from './integration-effects.js';

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

function normalizeReversalRequestId(value) {
  const requestId = clean(value, 128);
  return REQUEST_ID.test(requestId) ? requestId : null;
}

function normalizeReversalCommandId(value) {
  const commandId = clean(value, 40);
  return UUID.test(commandId) ? commandId : null;
}

async function reversalPlanHash(plan) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(plan || {})));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function refundCommandPlan(order, {
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

function refundRequestMatchesCommand(command, input = {}) {
  if (!command || command.type !== 'refund') return false;
  const requested = refundRequestIntent(input);
  const stored = command.snapshot?.request_intent;
  return Boolean(requested && stored && JSON.stringify(requested) === JSON.stringify(stored));
}

function refundCommandEffects(command) {
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

function cancellationAccountingPlan(order) {
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

function cancellationCommandPlan(order, {
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

function cancellationRequestMatchesCommand(command, { reason } = {}) {
  return Boolean(command?.type === 'cancel' && clean(reason, 500) === clean(command.reason, 500));
}

function cancellationPlanFromCommand(command) {
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

function cancellationCommandEffects(plan, command) {
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


const ACTIVE_LINE_STATUSES = ['queued', 'provider_succeeded', 'review_required', 'completed', 'failed'];
const LOADED_COMMAND_STATUSES = ['planned', ...ACTIVE_LINE_STATUSES];

function serviceError(code, detail = null) {
  const error = new Error(code);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function dbErrorCode(error, fallback) {
  const message = String(error?.message || error?.details || '').toLowerCase();
  for (const code of [
    'stale_order_revision',
    'refund_capacity_exceeded',
    'reversal_line_capacity_exceeded',
    'order_reversal_in_progress',
    'cancellation_label_set_stale',
    'accounting_review_required',
    'order_not_refundable',
    'order_not_cancellable',
    'reversal_request_identity_collision',
    'cancellation_review_not_retirable',
    'cancellation_review_has_side_effects',
  ]) {
    if (message.includes(code)) return code;
  }
  return fallback;
}

function rpcResult(result, fallback) {
  if (result?.error) throw serviceError(dbErrorCode(result.error, fallback));
  if (!result?.data || typeof result.data !== 'object') throw serviceError(fallback);
  return result.data;
}

function commandView(command) {
  return {
    id: command.id,
    order_id: command.order_id,
    type: command.type,
    request_id: command.request_id,
    status: command.status,
    amount_minor: Number(command.amount_minor) || 0,
    currency: command.currency,
    provider_object_id: command.provider_object_id || null,
    accounting_result: command.accounting_result || null,
    integration_event_id: command.integration_event_id || null,
    retirement_reason: command.retirement_reason || null,
    retired_by_user_id: command.retired_by_user_id || null,
    retired_by_email: command.retired_by_email || null,
    retired_at: command.retired_at || null,
    created_at: command.created_at || null,
    completed_at: command.completed_at || null,
  };
}

function rpcLines(lines = []) {
  return lines.map((line) => ({
    sku: line.sku,
    qty: line.qty,
    unit_price_minor: line.unit_price_minor,
    line_amount_minor: line.line_amount_minor,
    restock_qty: line.restock_qty,
  }));
}

async function defaultLoadOrder(sb, orderId) {
  const { data, error } = await sb.from('orders')
    .select('id,order_number,status,reversal_revision,company_id,customer_email,payment_method,total,currency,refunded_amount,stripe_payment_intent,qbo_sync_status,qbo_doc_id,qbo_doc_type,qbo_invoice_id,qbo_payment_id,tracking_status,tracking_number,order_items(sku,qty,unit_price,line_total,backordered),order_shipments(id,split_key,generation,revision,provider_shipment_id,status,item_allocations),order_provider_links(id,provider,object_type,provider_object_id,metadata),order_financial_entries(source,entry_type,provider_object_id,amount,currency,recognition_state,metadata,created_at)')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw serviceError('order_reversal_read_failed');
  if (!data) throw serviceError('not_found');
  return data;
}

async function defaultLoadCommands(sb, orderId) {
  const { data, error } = await sb.from('order_reversal_commands')
    .select('id,order_id,type,request_id,status,expected_revision,amount_minor,currency,reason,provider_idempotency_key,snapshot,provider_object_id,accounting_result,integration_event_id,created_at,completed_at,order_reversal_lines(sku,qty,restock_qty)')
    .eq('order_id', orderId)
    .in('status', LOADED_COMMAND_STATUSES);
  if (error) throw serviceError('order_reversal_history_failed');
  return data || [];
}

function claimedLines(commands) {
  return (commands || [])
    .filter((command) => ACTIVE_LINE_STATUSES.includes(command.status))
    .flatMap((command) => command.order_reversal_lines || []);
}

export async function queueRefundCommand({
  sb,
  orderId,
  requestId,
  amount,
  lines,
  actor,
}, dependencies = {}) {
  const normalizedRequestId = normalizeReversalRequestId(requestId);
  if (!normalizedRequestId) throw serviceError('refund_request_id_required');
  const loadOrder = dependencies.loadOrder || defaultLoadOrder;
  const loadCommands = dependencies.loadCommands || defaultLoadCommands;
  const commands = await loadCommands(sb, orderId);
  const existing = commands.find((command) => command.request_id === normalizedRequestId);
  if (existing) {
    if (!refundRequestMatchesCommand(existing, { amount, lines })) {
      throw serviceError('reversal_request_identity_collision');
    }
    return { replay: true, command: commandView(existing) };
  }

  const order = await loadOrder(sb, orderId);
  const plan = refundCommandPlan(order, {
    requestId: normalizedRequestId,
    amount,
    lines,
    refundedLines: claimedLines(commands),
  });
  if (!plan.ok) throw serviceError(plan.error);
  const planHash = await reversalPlanHash(plan);
  const commandId = dependencies.randomUUID ? dependencies.randomUUID() : crypto.randomUUID();
  const effects = toIntegrationEffectRows(refundCommandEffects({ id: commandId, order_id: order.id }));
  const command = rpcResult(await sb.rpc('claim_order_refund_command', {
    p_command_id: commandId,
    p_order_id: order.id,
    p_request_id: plan.request_id,
    p_expected_revision: plan.expected_revision,
    p_amount_minor: plan.amount_minor,
    p_currency: plan.currency,
    p_plan_hash: planHash,
    p_snapshot: plan.snapshot,
    p_lines: rpcLines(plan.lines),
    p_actor_user_id: actor?.id || null,
    p_actor_email: actor?.email || null,
    p_effects: effects,
  }), 'refund_command_claim_failed');
  return { replay: command.id !== commandId, plan, command: commandView(command) };
}

export async function prepareCancellationCommand({
  sb,
  orderId,
  requestId,
  reason,
  actor,
}, dependencies = {}) {
  const normalizedRequestId = normalizeReversalRequestId(requestId);
  if (!normalizedRequestId) throw serviceError('cancellation_request_id_required');
  const loadOrder = dependencies.loadOrder || defaultLoadOrder;
  const loadCommands = dependencies.loadCommands || defaultLoadCommands;
  const commands = await loadCommands(sb, orderId);
  const existing = commands.find((command) => command.request_id === normalizedRequestId);
  if (existing) {
    if (!cancellationRequestMatchesCommand(existing, { reason })) {
      throw serviceError('reversal_request_identity_collision');
    }
    const plan = cancellationPlanFromCommand(existing);
    if (!plan) throw serviceError('cancellation_snapshot_invalid');
    return { replay: true, plan, command: commandView(existing) };
  }

  const order = await loadOrder(sb, orderId);
  const labels = (dependencies.requiredOutboundLabelVoids || requiredOutboundLabelVoids)(order);
  const companyRecipients = order.company_id
    ? await (dependencies.companyEmails || companyEmails)(sb, order.company_id, 'orders')
    : [];
  const plan = cancellationCommandPlan(order, {
    requestId: normalizedRequestId,
    reason,
    labels,
    refundedLines: claimedLines(commands),
    recipients: [order.customer_email, ...companyRecipients],
  });
  if (!plan.ok) throw serviceError(plan.error);
  const planHash = await reversalPlanHash(plan);
  const commandId = dependencies.randomUUID ? dependencies.randomUUID() : crypto.randomUUID();
  const command = rpcResult(await sb.rpc('create_order_cancellation_plan', {
    p_command_id: commandId,
    p_order_id: order.id,
    p_request_id: plan.request_id,
    p_expected_revision: plan.expected_revision,
    p_amount_minor: plan.amount_minor,
    p_currency: plan.currency,
    p_plan_hash: planHash,
    p_snapshot: plan.snapshot,
    p_lines: rpcLines(plan.lines),
    p_reason: plan.reason,
    p_actor_user_id: actor?.id || null,
    p_actor_email: actor?.email || null,
  }), 'cancellation_plan_persist_failed');
  return { replay: command.id !== commandId, plan, command: commandView(command) };
}

export async function confirmCancellationCommand({
  sb,
  orderId,
  commandId,
}, dependencies = {}) {
  const normalizedCommandId = normalizeReversalCommandId(commandId);
  if (!normalizedCommandId) throw serviceError('cancellation_command_id_required');
  const { data: command, error } = await sb.from('order_reversal_commands')
    .select('id,order_id,type,request_id,status,amount_minor,currency,reason,snapshot,integration_event_id,created_at,completed_at')
    .eq('id', normalizedCommandId)
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw serviceError('cancellation_command_read_failed');
  if (!command || command.type !== 'cancel') throw serviceError('cancellation_command_not_found');
  const blockers = Array.isArray(command.snapshot?.blockers) ? command.snapshot.blockers : [];
  if (blockers.includes('shipment_in_transit')) {
    throw serviceError('shipment_in_transit');
  }
  const effects = toIntegrationEffectRows(cancellationCommandEffects({
    ...command.snapshot,
    order_id: command.order_id,
    reason: command.reason,
    labels: command.snapshot?.labels || [],
  }, command));
  const confirmed = rpcResult(await sb.rpc('confirm_order_cancellation_command', {
    p_command_id: command.id,
    p_effects: effects,
  }), 'cancellation_confirm_failed');
  if (confirmed.error === 'accounting_review_required') {
    throw serviceError('accounting_review_required');
  }
  return { replay: command.status !== 'planned', command: commandView(confirmed) };
}

export async function retireCancellationReviewCommand({
  sb,
  orderId,
  commandId,
  reason,
  actor,
}) {
  const normalizedOrderId = normalizeReversalCommandId(orderId);
  const normalizedCommandId = normalizeReversalCommandId(commandId);
  const normalizedActorId = normalizeReversalCommandId(actor?.id);
  const normalizedReason = String(reason || '').trim();
  if (!normalizedOrderId) throw serviceError('order_id_required');
  if (!normalizedCommandId) throw serviceError('cancellation_command_id_required');
  if (!normalizedActorId) throw serviceError('cancellation_retirement_actor_required');
  if (normalizedReason.length < 8 || normalizedReason.length > 500) {
    throw serviceError('cancellation_retirement_reason_invalid');
  }
  const command = rpcResult(await sb.rpc('retire_order_cancellation_review', {
    p_order_id: normalizedOrderId,
    p_command_id: normalizedCommandId,
    p_reason: normalizedReason,
    p_actor_user_id: normalizedActorId,
    p_actor_email: actor?.email || null,
  }), 'cancellation_review_retirement_failed');
  return { command: commandView(command), fresh_preflight_required: true };
}

export function orderReversalHttpStatus(error) {
  const code = String(error?.code || error?.message || 'order_reversal_failed');
  if (code === 'not_found' || code === 'cancellation_command_not_found') return 404;
  if (['stale_order_revision', 'refund_capacity_exceeded', 'reversal_line_capacity_exceeded',
    'order_reversal_in_progress', 'accounting_review_required', 'shipment_in_transit',
    'cancellation_label_set_stale', 'reversal_request_identity_collision',
    'cancellation_review_not_retirable', 'cancellation_review_has_side_effects'].includes(code)) return 409;
  if (code.endsWith('_failed')) return 503;
  return 400;
}

export const orderReversalPlanningForTests = Object.freeze({
  cancellationAccountingPlan,
  cancellationCommandEffects,
  cancellationCommandPlan,
  normalizeReversalRequestId,
  refundCommandEffects,
  refundCommandPlan,
  reversalPlanHash,
});
