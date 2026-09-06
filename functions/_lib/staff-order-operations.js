import { recordAudit } from './audit.js';
import { staffCan, staffCanWrite } from './authz.js';
import { planNetSettlement } from './credit.js';
import { shipmentNotice } from './order-email.js';
import { renderCommerceEmail } from './email-renderers.js';
import { linkOrderProviderObject, orderReference } from './order-integrations.js';
import { settledOrderStatus, shouldPromoteToFulfilled } from './order-lifecycle.js';
import {
  confirmCancellationCommand,
  orderReversalHttpStatus,
  prepareCancellationCommand,
  queueRefundCommand,
  retireCancellationReviewCommand,
} from './order-reversal-commands.js';
import { companyEmails, sendEmail } from './supabase.js';

export const ORDER_STATUSES = [
  'cart',
  'pending_payment',
  'paid',
  'net_open',
  'net_paid',
  'fulfilled',
  'cancelled',
  'refunded',
];

const ACCEPTABLE_STATUSES = new Set(['paid', 'net_open', 'pending_payment']);
const WRITABLE_ORDER_STATUSES = ORDER_STATUSES.filter((status) => status !== 'cart');
const PAYMENT_METHODS = ['stripe', 'net'];
const TRACKING_STATUSES = ['processing', 'packing', 'shipped', 'delivered', 'blocked'];

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function optionalText(value, max = 160) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function amountOr(value, fallback) {
  if (value == null || value === '') return fallback == null ? null : roundAmount(fallback);
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? roundAmount(n) : null;
}

function truthyFlag(value) {
  return value === true || ['1', 'true', 'yes', 'y'].includes(String(value || '').trim().toLowerCase());
}

function normalizeOrderStatus(value, currentStatus = null) {
  const status = String(value || currentStatus || '').trim();
  if (!WRITABLE_ORDER_STATUSES.includes(status)) return { ok: false, error: 'invalid_status' };
  if (status === 'refunded' && currentStatus !== 'refunded') {
    return {
      ok: false,
      error: 'use_refund_action',
      message: 'Use the Refund control — setting the status directly would not move any money.',
    };
  }
  return { ok: true, status };
}

function normalizePaymentMethod(value) {
  const method = String(value || '').trim();
  return PAYMENT_METHODS.includes(method)
    ? { ok: true, method }
    : { ok: false, error: 'invalid_payment_method' };
}

function normalizeOrderItems(items) {
  if (!Array.isArray(items) || !items.length) return { ok: false, error: 'order_items_required' };
  if (items.length > 100) return { ok: false, error: 'too_many_order_items' };
  const out = [];
  for (const raw of items) {
    const sku = optionalText(raw?.sku, 120);
    const productSku = optionalText(raw?.product_sku ?? raw?.productSku, 120);
    const name = optionalText(raw?.name, 220) || sku;
    const qty = Math.floor(Number(raw?.qty));
    const unitPrice = amountOr(raw?.unit_price ?? raw?.unitPrice ?? raw?.price, null);
    if (!sku || !name || !Number.isFinite(qty) || qty <= 0 || unitPrice == null) {
      return { ok: false, error: 'invalid_order_item' };
    }
    out.push({
      sku,
      product_sku: productSku,
      name,
      qty,
      unit_price: unitPrice,
      line_total: roundAmount(qty * unitPrice),
      backordered: truthyFlag(raw?.backordered),
    });
  }
  return {
    ok: true,
    items: out,
    subtotal: roundAmount(out.reduce((sum, item) => sum + item.line_total, 0)),
  };
}

function normalizeOrderWrite(body, currentStatus = null) {
  const status = normalizeOrderStatus(body.status, currentStatus);
  if (!status.ok) return status;
  const payment = normalizePaymentMethod(body.payment_method);
  if (!payment.ok) return payment;
  const lines = normalizeOrderItems(body.items);
  if (!lines.ok) return lines;
  const tax = amountOr(body.tax, 0);
  const shipping = amountOr(body.shipping, 0);
  const subtotal = amountOr(body.subtotal, lines.subtotal);
  const total = amountOr(body.total, subtotal + shipping + tax);
  if (subtotal == null || shipping == null || tax == null || total == null) {
    return { ok: false, error: 'invalid_order_total' };
  }
  if (subtotal !== lines.subtotal || total !== roundAmount(subtotal + shipping + tax)) {
    return { ok: false, error: 'order_total_mismatch' };
  }
  return {
    ok: true,
    items: lines.items,
    patch: {
      company_id: optionalText(body.company_id, 80),
      customer_email: optionalText(body.customer_email, 240),
      status: status.status,
      payment_method: payment.method,
      subtotal,
      shipping,
      tax,
      total,
      currency: (optionalText(body.currency, 8) || 'usd').toLowerCase(),
    },
  };
}

function manualOrderErrorCode(error, fallback) {
  const message = String(error?.message || error?.details || '').toLowerCase();
  for (const code of [
    'invalid_manual_order',
    'invalid_manual_order_items',
    'invalid_manual_order_item',
    'manual_order_subtotal_mismatch',
    'duplicate_manual_order_item',
    'manual_order_stock_unavailable',
    'manual_order_stock_restore_failed',
    'invalid_draft_order_update',
    'invalid_draft_order_delete',
    'settled_order_lines_immutable',
    'order_delete_forbidden',
    'stale_order_revision',
    'stale_order_status',
    'order_cancellation_in_progress',
    'tracking_update_forbidden',
    'tracking_fulfillment_not_settled',
    'tracking_operation_id_conflict',
    'invalid_tracking_update',
    'order_not_found',
    'provider_object_already_claimed',
  ]) {
    if (message.includes(code)) return code;
  }
  if (error?.code === '23503') return 'invalid_manual_order_reference';
  if (error?.code === '23505') return 'provider_object_already_claimed';
  return fallback;
}

function manualOrderHttpStatus(code) {
  if (code === 'order_not_found') return 404;
  if ([
    'manual_order_stock_unavailable',
    'manual_order_stock_restore_failed',
    'settled_order_lines_immutable',
    'order_delete_forbidden',
    'stale_order_revision',
    'stale_order_status',
    'order_cancellation_in_progress',
    'tracking_update_forbidden',
    'tracking_fulfillment_not_settled',
    'tracking_operation_id_conflict',
    'provider_object_already_claimed',
  ].includes(code)) return 409;
  if (code.endsWith('_failed')) return 500;
  return 400;
}

async function notifyCompany(sb, env, request, companyId, label, extra, order = null) {
  if (!companyId) return [];
  const reference = orderReference(order);
  const title = reference ? `Order ${reference} ${label}` : `Order ${label}`;
  await sb.from('notifications').insert({
    company_id: companyId,
    type: 'order',
    title,
    body: extra || `Your order is now "${label}".`,
    link: '/dashboard.html#orders',
  }).then(() => {}, () => {});
  const appUrl = env.APP_URL || new URL(request.url).origin;
  const emails = await companyEmails(sb, companyId, 'orders');
  const rendered = renderCommerceEmail({
    event: 'payment',
    appUrl,
    order: {
      ...(order || {}),
      viewUrl: `${appUrl}/dashboard.html#orders`,
      ctaText: 'View your order',
    },
    payment: {
      label,
      heading: title,
      summary: extra || `Your MASEST order status is now "${label}".`,
      subject: title,
      previewText: extra || title,
    },
  });
  await sendEmail(env, {
    to: emails,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    category: 'order',
  });
  return emails;
}

async function sendTrackingEmail(env, request, order, label, extra, recipients) {
  const unique = [...new Set((recipients || [])
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean))];
  if (!unique.length) return false;

  const appUrl = env.APP_URL || new URL(request.url).origin;
  const reference = orderReference(order);
  const normalizedLabel = String(label || '').toLowerCase();
  const event = normalizedLabel === 'delivered'
    ? 'delivered'
    : normalizedLabel === 'shipped'
      ? 'shipped'
      : 'delivery_update';
  const rendered = renderCommerceEmail({
    event,
    appUrl,
    order,
    fulfillment: {
      label,
      summary: extra,
      carrier: order?.carrier,
      trackingNumber: order?.tracking_number,
      trackingUrl: order?.tracking_url,
      estimatedDelivery: order?.estimated_delivery_at,
    },
  });
  return sendEmail(env, {
    to: unique,
    subject: rendered.subject || `Order ${reference} ${label}`,
    html: rendered.html,
    text: rendered.text,
    category: 'order',
  });
}

async function notifyBuyerTracking(env, request, order, label, extra, exclude = []) {
  const email = String(order?.customer_email || '').trim();
  if (!email) return false;
  const normalized = email.toLowerCase();
  if ((exclude || []).some((item) => String(item || '').trim().toLowerCase() === normalized)) {
    return false;
  }
  return sendTrackingEmail(env, request, order, label, extra, [email]);
}

function response(status, payload) {
  return { status, payload };
}

function nowIso(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

export async function runStaffOrderOperation(
  { body, user, role, sb, env = {}, request = null },
  dependencies = {},
) {
  if (!staffCanWrite(role)) {
    return response(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
  }
  const audit = dependencies.recordAudit || recordAudit;
  const now = dependencies.now || (() => new Date());
  const prepareCancellation = dependencies.prepareCancellationCommand || prepareCancellationCommand;
  const confirmCancellation = dependencies.confirmCancellationCommand || confirmCancellationCommand;
  const queueRefund = dependencies.queueRefundCommand || queueRefundCommand;
  const retireCancellationReview = dependencies.retireCancellationReviewCommand
    || retireCancellationReviewCommand;
  const linkProviderObject = dependencies.linkOrderProviderObject || linkOrderProviderObject;
  const notifyOrderCompany = dependencies.notifyCompany || notifyCompany;
  const notifyOrderBuyer = dependencies.notifyBuyerTracking || notifyBuyerTracking;

  if (body?.action === 'accept_order') {
    if (!staffCan(role, 'order.write')) return response(403, { error: 'forbidden' });
    const { data: order, error: readErr } = await sb.from('orders')
      .select('id,order_number,status,accepted_at,company_id,customer_email')
      .eq('id', body.id).single();
    if (readErr) return response(readErr.code === 'PGRST116' ? 404 : 500, { error: readErr.message });
    if (!ACCEPTABLE_STATUSES.has(order.status)) {
      return response(409, { error: 'not_acceptable', message: `Order is ${order.status}.` });
    }
    if (order.accepted_at) {
      return response(200, { ok: true, already_accepted: true, order });
    }
    const { data: accepted, error } = await sb.from('orders')
      .update({ accepted_at: nowIso(now), accepted_by: user?.id || null })
      .eq('id', body.id)
      .is('accepted_at', null)
      .select('id,order_number,status,accepted_at')
      .maybeSingle();
    if (error) return response(500, { error: error.message });
    if (!accepted) return response(200, { ok: true, already_accepted: true, order });
    await audit(sb, {
      user,
      action: 'order.accept',
      targetType: 'order',
      targetId: body.id,
      detail: { company_id: order.company_id },
    });
    return response(200, { ok: true, order: accepted });
  }

  if (body?.action === 'accept_orders') {
    if (!staffCan(role, 'order.write')) return response(403, { error: 'forbidden' });
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).filter(Boolean))].slice(0, 200);
    if (!ids.length) return response(400, { error: 'ids_required' });
    const { data: rows, error: readErr } = await sb.from('orders')
      .select('id,status,accepted_at').in('id', ids);
    if (readErr) return response(500, { error: readErr.message });
    const eligible = (rows || []).filter((order) => (
      ACCEPTABLE_STATUSES.has(order.status) && !order.accepted_at
    ));
    if (!eligible.length) {
      return response(200, { ok: true, accepted: 0, skipped: ids.length });
    }
    const { data: accepted, error } = await sb.from('orders')
      .update({ accepted_at: nowIso(now), accepted_by: user?.id || null })
      .in('id', eligible.map((order) => order.id))
      .is('accepted_at', null)
      .select('id');
    if (error) return response(500, { error: error.message });
    const acceptedIds = (accepted || []).map((order) => order.id);
    if (acceptedIds.length) {
      await audit(sb, {
        user,
        action: 'order.accept_bulk',
        targetType: 'order',
        targetId: acceptedIds[0],
        detail: { order_ids: acceptedIds, count: acceptedIds.length },
      });
    }
    return response(200, {
      ok: true,
      accepted: acceptedIds.length,
      skipped: ids.length - acceptedIds.length,
    });
  }

  if (body?.action === 'resolve_request') {
    if (!staffCan(role, 'order.write')) return response(403, { error: 'forbidden' });
    const decision = String(body.decision || '').trim();
    if (!['approved', 'declined'].includes(decision)) {
      return response(400, { error: 'invalid_decision' });
    }
    const { data: existing, error: readErr } = await sb.from('order_requests')
      .select('id,order_id,type,status,reason,requested_email')
      .eq('id', body.request_id).single();
    if (readErr) {
      return response(readErr.code === 'PGRST116' ? 404 : 500, { error: readErr.message });
    }
    if (existing.status !== 'open') {
      return response(409, { error: 'request_already_resolved', status: existing.status });
    }
    const { data: resolved, error } = await sb.from('order_requests')
      .update({
        status: decision,
        resolved_by: user?.id || null,
        resolution_note: optionalText(body.note, 1000),
        resolved_at: nowIso(now),
      })
      .eq('id', body.request_id)
      .eq('status', 'open')
      .select('id,order_id,type,status,resolved_at')
      .maybeSingle();
    if (error) return response(500, { error: error.message });
    if (!resolved) return response(409, { error: 'request_already_resolved' });
    await audit(sb, {
      user,
      action: `order.request_${decision}`,
      targetType: 'order',
      targetId: existing.order_id,
      detail: { request_id: existing.id, type: existing.type },
    });
    return response(200, {
      ok: true,
      request: resolved,
      next_action: decision === 'approved'
        ? (existing.type === 'cancel' ? 'cancel_order' : 'return_label')
        : null,
    });
  }

  if (body?.action === 'create_order') {
    if (!staffCan(role, 'order.write')) return response(403, { error: 'forbidden' });
    const normalized = normalizeOrderWrite(body);
    if (!normalized.ok) {
      return response(400, { error: normalized.error, message: normalized.message });
    }
    const orderWrite = {
      ...normalized.patch,
      qbo_invoice_id: optionalText(body.qbo_invoice_id, 80),
      qbo_payment_id: optionalText(body.qbo_payment_id, 80),
    };
    const { data: order, error } = await sb.rpc('create_manual_order_atomic', {
      p_order: orderWrite,
      p_items: normalized.items,
    });
    if (error) {
      const code = manualOrderErrorCode(error, 'manual_order_create_failed');
      return response(manualOrderHttpStatus(code), { error: code });
    }
    await audit(sb, {
      user,
      action: 'order.create',
      targetType: 'order',
      targetId: order.id,
      detail: {
        company_id: order.company_id,
        status: order.status,
        payment_method: order.payment_method,
        item_count: normalized.items.length,
      },
    });
    return response(201, { ok: true, order });
  }

  if (body?.action === 'update_order') {
    if (!body.id) return response(400, { error: 'order_id_required' });
    if (!staffCan(role, 'order.write')) return response(403, { error: 'forbidden' });
    const { data: before, error: beforeErr } = await sb.from('orders')
      .select('id,company_id,customer_email,status,payment_method,reversal_revision')
      .eq('id', body.id).single();
    if (beforeErr) {
      return response(beforeErr.code === 'PGRST116' ? 404 : 500, { error: beforeErr.message });
    }
    if (!['cart', 'pending_payment'].includes(before.status)) {
      return response(409, { error: 'settled_order_lines_immutable' });
    }
    const normalized = normalizeOrderWrite(body, before.status);
    if (!normalized.ok) {
      return response(400, { error: normalized.error, message: normalized.message });
    }
    if (normalized.patch.status !== before.status
      || normalized.patch.payment_method !== before.payment_method) {
      return response(409, { error: 'use_explicit_order_action' });
    }
    const { data: order, error } = await sb.rpc('update_draft_order_atomic', {
      p_order_id: body.id,
      p_expected_revision: before.reversal_revision,
      p_order: normalized.patch,
      p_items: normalized.items,
    });
    if (error) {
      const code = manualOrderErrorCode(error, 'draft_order_update_failed');
      return response(manualOrderHttpStatus(code), { error: code });
    }
    await audit(sb, {
      user,
      action: 'order.update',
      targetType: 'order',
      targetId: body.id,
      detail: {
        company_id: order.company_id,
        status: order.status,
        previous_status: before.status,
        item_count: normalized.items.length,
      },
    });
    return response(200, { ok: true, order });
  }

  if (body?.action === 'delete_order') {
    if (!body.id) return response(400, { error: 'order_id_required' });
    if (!staffCan(role, 'order.delete')) {
      return response(403, { error: 'forbidden', message: 'Only owner staff can remove orders.' });
    }
    const { data: order, error: readErr } = await sb.from('orders')
      .select('id,company_id,customer_email,status,payment_method,total,currency,reversal_revision')
      .eq('id', body.id).single();
    if (readErr) {
      return response(readErr.code === 'PGRST116' ? 404 : 500, { error: readErr.message });
    }
    const { data: deleted, error } = await sb.rpc('delete_draft_order_atomic', {
      p_order_id: body.id,
      p_expected_revision: order.reversal_revision,
    });
    if (error) {
      const code = manualOrderErrorCode(error, 'draft_order_delete_failed');
      return response(manualOrderHttpStatus(code), { error: code });
    }
    await audit(sb, {
      user,
      action: 'order.delete',
      targetType: 'order',
      targetId: body.id,
      detail: deleted,
    });
    return response(200, { ok: true, deleted: true });
  }

  if (body?.action === 'retire_cancellation_review') {
    if (!staffCan(role, 'order.refund')) {
      return response(403, {
        error: 'forbidden',
        message: 'Retiring a blocked cancellation requires finance or owner access.',
      });
    }
    if (!body.id) return response(400, { error: 'order_id_required' });
    try {
      const result = await retireCancellationReview({
        sb,
        orderId: body.id,
        commandId: body.command_id,
        reason: body.reason,
        actor: user,
      });
      return response(200, {
        ok: true,
        retired: true,
        command: result.command,
        fresh_preflight_required: result.fresh_preflight_required,
        message: 'Blocked cancellation retired. Start a fresh cancellation preflight against the current order and accounting state.',
      });
    } catch (error) {
      const code = String(error?.code || error?.message || 'cancellation_review_retirement_failed');
      return response(orderReversalHttpStatus(error), { error: code });
    }
  }

  if (body?.action === 'cancel_order') {
    if (!staffCan(role, 'order.refund')) {
      return response(403, {
        error: 'forbidden',
        message: 'Cancelling a paid order requires finance or owner access.',
      });
    }
    try {
      if (body.confirm === true) {
        const result = await confirmCancellation({
          sb,
          orderId: body.id,
          commandId: body.command_id,
        });
        await audit(sb, {
          user,
          action: 'order.cancel_queued',
          targetType: 'order',
          targetId: body.id,
          detail: { command_id: result.command.id, replay: result.replay },
        });
        return response(202, {
          ok: true,
          cancelling: true,
          replay: result.replay,
          command: result.command,
          message: 'Cancellation queued. Every label, refund, stock, accounting, and notification step is visible on the order timeline.',
        });
      }

      const result = await prepareCancellation({
        sb,
        orderId: body.id,
        requestId: body.request_id,
        reason: body.reason,
        actor: user,
      });
      await audit(sb, {
        user,
        action: 'order.cancel_preflight',
        targetType: 'order',
        targetId: body.id,
        detail: {
          command_id: result.command.id,
          request_id: result.command.request_id,
          plan_hash_bound: true,
        },
      });
      return response(200, {
        ok: true,
        preflight: true,
        replay: result.replay,
        command: result.command,
        plan: result.plan,
      });
    } catch (error) {
      const code = String(error?.code || error?.message || 'cancellation_failed');
      return response(orderReversalHttpStatus(error), {
        error: code,
        message: code === 'accounting_review_required'
          ? 'QuickBooks receivable state needs finance review before this order can be cancelled.'
          : undefined,
      });
    }
  }

  if (body?.action === 'refund') {
    if (!body.id) return response(400, { error: 'order_id_required' });
    if (!staffCan(role, 'order.refund')) {
      return response(403, { error: 'forbidden', message: 'Refunds require finance or owner access.' });
    }
    try {
      const result = await queueRefund({
        sb,
        orderId: body.id,
        requestId: body.request_id,
        amount: body.amount,
        lines: body.lines,
        actor: user,
      });
      await audit(sb, {
        user,
        action: 'order.refund_queued',
        targetType: 'order',
        targetId: body.id,
        detail: {
          command_id: result.command.id,
          request_id: result.command.request_id,
          amount_minor: result.command.amount_minor,
          replay: result.replay,
        },
      });
      return response(202, {
        ok: true,
        refund_queued: true,
        replay: result.replay,
        amount: Number(result.command.amount_minor) / 100,
        command: result.command,
        message: 'Refund queued. Money, stock, accounting, and notification progress is visible on the order timeline.',
      });
    } catch (error) {
      const code = String(error?.code || error?.message || 'refund_command_failed');
      return response(orderReversalHttpStatus(error), { error: code });
    }
  }

  if (!body?.id) return response(400, { error: 'order_id_required' });

  if (body.action === 'record_qbo_invoice') {
    if (!staffCan(role, 'company.credit')) return response(403, { error: 'forbidden' });
    const invoiceId = String(body.qbo_invoice_id || '').trim();
    if (!invoiceId) return response(400, { error: 'qbo_invoice_id_required' });

    const { data: orderBefore, error: readError } = await sb.from('orders')
      .select('id,order_number,company_id,status,payment_method').eq('id', body.id).single();
    if (readError) return response(500, { error: readError.message });
    if (!orderBefore) return response(404, { error: 'not_found' });
    if (orderBefore.payment_method !== 'net') {
      return response(400, {
        error: 'qbo_invoice_not_net',
        message: 'Only NET orders can be linked to QuickBooks invoices.',
      });
    }
    try {
      await linkProviderObject(sb, {
        orderId: orderBefore.id,
        provider: 'quickbooks',
        objectType: 'invoice',
        providerObjectId: invoiceId,
        metadata: { order_number: orderBefore.order_number },
      });
    } catch (linkError) {
      return response(linkError?.code === '23505' ? 409 : 500, {
        error: 'qbo_provider_link_failed',
      });
    }

    const { data: order, error } = await sb.from('orders')
      .update({
        qbo_invoice_id: invoiceId,
        qbo_sync_status: 'synced',
        qbo_doc_id: invoiceId,
        qbo_doc_type: 'invoice',
        qbo_synced_at: nowIso(now),
        qbo_error: null,
      })
      .eq('id', body.id)
      .select('id,order_number,company_id,status,qbo_invoice_id,qbo_sync_status,qbo_doc_id,qbo_doc_type')
      .single();
    if (error) return response(500, { error: error.message });
    await notifyOrderCompany(
      sb,
      env,
      request,
      order?.company_id,
      'invoice ready',
      `QuickBooks invoice ${invoiceId} is linked to your order.`,
      order,
    );
    await audit(sb, {
      user,
      action: 'order.record_qbo_invoice',
      targetType: 'order',
      targetId: body.id,
      detail: { company_id: order?.company_id, qbo_invoice_id: invoiceId },
    });
    return response(200, { ok: true, order });
  }

  if (body.action === 'record_qbo_payment') {
    if (!staffCan(role, 'company.credit')) return response(403, { error: 'forbidden' });
    const paymentId = String(body.qbo_payment_id || '').trim();
    if (!paymentId) return response(400, { error: 'qbo_payment_id_required' });

    const { data: orderBefore, error: readError } = await sb.from('orders')
      .select('id,order_number,company_id,customer_email,status,payment_method,tracking_status,tracking_number')
      .eq('id', body.id).single();
    if (readError) return response(500, { error: readError.message });
    if (!orderBefore) return response(404, { error: 'not_found' });
    if (orderBefore.payment_method !== 'net') {
      return response(400, {
        error: 'qbo_payment_not_net',
        message: 'Only NET orders can record QuickBooks Payments settlement ids.',
      });
    }
    try {
      await linkProviderObject(sb, {
        orderId: orderBefore.id,
        provider: 'quickbooks',
        objectType: 'payment',
        providerObjectId: paymentId,
        metadata: { order_number: orderBefore.order_number },
      });
    } catch (linkError) {
      return response(linkError?.code === '23505' ? 409 : 500, {
        error: 'qbo_provider_link_failed',
      });
    }

    const { data: order, error } = await sb.from('orders')
      .update({
        status: settledOrderStatus(orderBefore),
        qbo_payment_id: paymentId,
        qbo_error: null,
      })
      .eq('id', body.id)
      .select('id,order_number,company_id,customer_email,status,payment_method,total,currency,qbo_invoice_id,qbo_doc_id,qbo_doc_type,qbo_payment_id')
      .single();
    if (error) return response(500, { error: error.message });
    const notifyBody = `QuickBooks payment ${paymentId} is recorded for your order.`;
    const companyRecipients = await notifyOrderCompany(
      sb,
      env,
      request,
      order?.company_id,
      'payment received',
      notifyBody,
      order,
    );
    await notifyOrderBuyer(
      env,
      request,
      order,
      'payment received',
      notifyBody,
      companyRecipients,
    );
    await audit(sb, {
      user,
      action: 'order.record_qbo_payment',
      targetType: 'order',
      targetId: body.id,
      detail: { company_id: order?.company_id, qbo_payment_id: paymentId },
    });
    return response(200, { ok: true, order });
  }

  if (body.action === 'mark_net_paid') {
    if (!staffCan(role, 'company.credit')) return response(403, { error: 'forbidden' });
    const { data: orderBefore, error: readError } = await sb.from('orders')
      .select('id,order_number,company_id,customer_email,status,payment_method,tracking_status,tracking_number')
      .eq('id', body.id).single();
    if (readError) return response(500, { error: readError.message });
    const plan = planNetSettlement(orderBefore, { reference: body.reference });
    if (!plan.ok) return response(400, { error: plan.error });

    const { data: order, error } = await sb.from('orders')
      .update({ ...plan.update, status: settledOrderStatus(orderBefore, plan.update.status) })
      .eq('id', body.id)
      .select('id,order_number,company_id,customer_email,status,payment_method,total,currency')
      .single();
    if (error) return response(500, { error: error.message });
    const notifyBody = plan.reference
      ? `Your NET balance is settled (reference ${plan.reference}). Payment received — thank you.`
      : 'Your NET balance is settled. Payment received — thank you.';
    const companyRecipients = await notifyOrderCompany(
      sb,
      env,
      request,
      order?.company_id,
      'payment received',
      notifyBody,
      order,
    );
    await notifyOrderBuyer(
      env,
      request,
      order,
      'payment received',
      notifyBody,
      companyRecipients,
    );
    await audit(sb, {
      user,
      action: 'order.mark_net_paid',
      targetType: 'order',
      targetId: body.id,
      detail: { company_id: order?.company_id, reference: plan.reference },
    });
    return response(200, { ok: true, order });
  }

  if (body.action === 'update_tracking') {
    const trackingStatus = String(body.tracking_status || 'processing').trim();
    if (!TRACKING_STATUSES.includes(trackingStatus)) {
      return response(400, { error: 'invalid_tracking_status' });
    }
    const { data: current, error: currentError } = await sb.from('orders')
      .select('id,status,payment_method').eq('id', body.id).single();
    if (currentError) {
      return response(currentError.code === 'PGRST116' ? 404 : 500, {
        error: currentError.message,
      });
    }
    const carrier = String(body.carrier || '').trim().slice(0, 80) || null;
    const trackingNumber = String(body.tracking_number || '').trim().slice(0, 120) || null;
    const trackingUrl = String(body.tracking_url || '').trim().slice(0, 500) || null;
    const note = String(body.note || '').trim().slice(0, 280) || null;
    if (trackingUrl && !/^https?:\/\//i.test(trackingUrl)) {
      return response(400, { error: 'invalid_tracking_url' });
    }
    const estimatedDeliveryAt = body.estimated_delivery_at
      ? new Date(body.estimated_delivery_at)
      : null;
    if (estimatedDeliveryAt && Number.isNaN(estimatedDeliveryAt.getTime())) {
      return response(400, { error: 'invalid_estimated_delivery_at' });
    }
    const shippedAt = trackingStatus === 'shipped' || trackingStatus === 'delivered'
      ? (body.shipped_at ? new Date(body.shipped_at) : new Date(now()))
      : (body.shipped_at ? new Date(body.shipped_at) : null);
    if (shippedAt && Number.isNaN(shippedAt.getTime())) {
      return response(400, { error: 'invalid_shipped_at' });
    }

    const fulfilled = shouldPromoteToFulfilled(current, trackingStatus, trackingNumber);
    const update = {
      tracking_status: trackingStatus,
      carrier,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      estimated_delivery_at: estimatedDeliveryAt ? estimatedDeliveryAt.toISOString() : null,
      shipped_at: shippedAt ? shippedAt.toISOString() : null,
    };
    if (fulfilled) update.status = 'fulfilled';

    const operationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.operation_id || ''))
      ? String(body.operation_id)
      : crypto.randomUUID();
    const { data: order, error } = await sb.rpc('update_order_tracking_with_email', {
      p_order_id: body.id,
      p_operation_id: operationId,
      p_expected_status: current.status,
      p_tracking_status: trackingStatus,
      p_carrier: carrier,
      p_tracking_number: trackingNumber,
      p_tracking_url: trackingUrl,
      p_estimated_delivery_at: update.estimated_delivery_at,
      p_shipped_at: update.shipped_at,
      p_promote_fulfilled: fulfilled,
    });
    if (error) {
      const code = manualOrderErrorCode(error, 'tracking_update_failed');
      return response(manualOrderHttpStatus(code), { error: code });
    }
    await sb.from('shipment_events').insert({
      order_id: body.id,
      status: trackingStatus,
      carrier,
      tracking_number: trackingNumber,
      note,
    }).then(() => {}, () => {});
    const noticeStatus = trackingStatus === 'delivered'
      || (trackingStatus === 'shipped' && trackingNumber)
      ? trackingStatus
      : 'tracking';
    const notice = shipmentNotice(noticeStatus, { carrier, trackingNumber });
    if (order?.company_id) {
      await sb.from('notifications').insert({
        company_id: order.company_id,
        type: 'order',
        title: `Order ${orderReference(order)} ${notice.label}`,
        body: notice.body || `Your order is now "${notice.label}".`,
        link: '/dashboard.html#orders',
      }).then(() => {}, () => {});
    }
    await audit(sb, {
      user,
      action: 'order.update_tracking',
      targetType: 'order',
      targetId: body.id,
      detail: { company_id: order?.company_id, update },
    });
    return response(200, { ok: true, order, email_queued: true, operation_id: operationId });
  }

  if (!ORDER_STATUSES.includes(body.status)) return response(400, { error: 'invalid_status' });
  const { data: before, error: beforeError } = await sb.from('orders')
    .select('id,order_number,company_id,customer_email,status,total,currency')
    .eq('id', body.id).single();
  if (beforeError) {
    return response(beforeError.code === 'PGRST116' ? 404 : 500, { error: beforeError.message });
  }
  if (body.status === before.status) {
    return response(200, { ok: true, unchanged: true, order: before });
  }
  return response(409, {
    error: 'use_explicit_order_action',
    message: 'Use the dedicated payment, fulfillment, cancellation, or refund action for this transition.',
  });
}
