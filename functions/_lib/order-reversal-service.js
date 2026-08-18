import { companyEmails } from './supabase.js';
import { requiredOutboundLabelVoids } from './shipment-label-ownership.js';
import { toIntegrationEffectRows } from './integration-effects.js';
import {
  cancellationCommandEffects,
  cancellationCommandPlan,
  cancellationPlanFromCommand,
  cancellationRequestMatchesCommand,
  normalizeReversalCommandId,
  normalizeReversalRequestId,
  refundCommandEffects,
  refundCommandPlan,
  refundRequestMatchesCommand,
  reversalPlanHash,
} from './order-reversal.js';

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
