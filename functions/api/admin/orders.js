// /api/admin/orders — staff order management.
//   GET ?status=&limit=         → orders across all companies
//   GET ?export=csv             → CSV download of (filtered) orders
//   POST explicit action        → guarded Order command; bare status writes rejected
//   POST { id, action:'refund' }→ queue one immutable refund command
import { adminClient, requireStaff, json, readBody, companyEmails, sendEmail, emailLayout, htmlEscape } from '../../_lib/supabase.js';
import { recordAudit } from '../../_lib/audit.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';
import { staffCan, staffCanWrite } from '../../_lib/authz.js';
import { planNetSettlement, netAging } from '../../_lib/credit.js';
import { escapeLike } from '../../_lib/crm.js';
import { decorateOrderLifecycle, settledOrderStatus, shouldPromoteToFulfilled } from '../../_lib/order-lifecycle.js';
import { linkOrderProviderObject, orderReference } from '../../_lib/order-integrations.js';
import { shipmentEmailCta, shipmentEmailHtml, shipmentNotice } from '../../_lib/order-email.js';
import {
  confirmCancellationCommand,
  orderReversalHttpStatus,
  prepareCancellationCommand,
  queueRefundCommand,
  retireCancellationReviewCommand,
} from '../../_lib/order-reversal-service.js';
import { packingSlipHtml } from '../../_lib/packing-slip.js';

// Statuses where an order is a live commitment a human should acknowledge.
const ACCEPTABLE_STATUSES = new Set(['paid', 'net_open', 'pending_payment']);

const ORDER_STATUSES = ['cart', 'pending_payment', 'paid', 'net_open', 'net_paid', 'fulfilled', 'cancelled', 'refunded'];
const WRITABLE_ORDER_STATUSES = ORDER_STATUSES.filter((status) => status !== 'cart');
/* Pseudo-status for the fulfillment queue: a lifecycle view, not a column value. */
const NEEDS_FULFILLMENT = 'needs_fulfillment';
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
    return { ok: false, error: 'use_refund_action', message: 'Use the Refund control — setting the status directly would not move any money.' };
  }
  return { ok: true, status };
}

function normalizePaymentMethod(value) {
  const method = String(value || '').trim();
  return PAYMENT_METHODS.includes(method) ? { ok: true, method } : { ok: false, error: 'invalid_payment_method' };
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
  return { ok: true, items: out, subtotal: roundAmount(out.reduce((sum, item) => sum + item.line_total, 0)) };
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
  if (subtotal == null || shipping == null || tax == null || total == null) return { ok: false, error: 'invalid_order_total' };
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
    'provider_object_already_claimed',
  ].includes(code)) return 409;
  if (code.endsWith('_failed')) return 500;
  return 400;
}

function toCsv(rows) {
  return rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

async function notifyCompany(sb, env, request, companyId, label, extra, order = null) {
  if (!companyId) return [];
  const reference = orderReference(order);
  const title = reference ? `Order ${reference} ${label}` : `Order ${label}`;
  await sb.from('notifications').insert({
    company_id: companyId, type: 'order', title,
    body: extra || `Your order is now "${label}".`, link: '/dashboard.html#orders',
  }).then(() => {}, () => {});
  const appUrl = env.APP_URL || new URL(request.url).origin;
  const emails = await companyEmails(sb, companyId, 'orders');
  await sendEmail(env, {
    to: emails, subject: title,
    html: emailLayout({
      heading: title,
      bodyHtml: `<p>${htmlEscape(extra || `Your MASEST order status is now "${label}".`)}</p>`,
      ctaText: 'View your order', ctaUrl: `${appUrl}/dashboard.html#orders`,
    }),
  });
  return emails;
}

// Rich shipment email (carrier / tracking # / ETA + "Track shipment" CTA) to an explicit
// recipient list. update_tracking sends this to the buyer AND the company's order
// recipients so the clickable tracking link reaches everyone — the generic notifyCompany
// email used to shadow it for company members.
async function sendTrackingEmail(env, request, order, label, extra, recipients) {
  const unique = [...new Set((recipients || [])
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean))];
  if (!unique.length) return false;

  const appUrl = env.APP_URL || new URL(request.url).origin;
  const reference = orderReference(order);
  return sendEmail(env, {
    to: unique,
    subject: `Order ${reference} ${label}`,
    html: emailLayout({
      heading: `Order ${reference} ${label}`,
      bodyHtml: shipmentEmailHtml(order, label, extra),
      ...shipmentEmailCta(order, label, appUrl),
    }),
    category: 'order',
  });
}

async function notifyBuyerTracking(env, request, order, label, extra, exclude = []) {
  const email = String(order?.customer_email || '').trim();
  if (!email) return false;
  const normalized = email.toLowerCase();
  if ((exclude || []).some((item) => String(item || '').trim().toLowerCase() === normalized)) return false;
  return sendTrackingEmail(env, request, order, label, extra, [email]);
}

const INTEGRATION_TIMELINE_SELECT = 'id,event_id,effect_type,status,attempt_count,last_error_code,provider_result,created_at,completed_at,dead_at';

export async function loadOrderIntegrationTimeline(sb, orderId, trackingNumber = null) {
  const queries = [
    sb.from('integration_effects').select(INTEGRATION_TIMELINE_SELECT)
      .contains('payload', { order_id: orderId }).order('created_at', { ascending: false }).limit(50),
    sb.from('integration_effects').select(INTEGRATION_TIMELINE_SELECT)
      .contains('provider_result', { order_id: orderId }).order('created_at', { ascending: false }).limit(50),
  ];
  if (trackingNumber) {
    queries.push(sb.from('integration_effects').select(INTEGRATION_TIMELINE_SELECT)
      .eq('aggregate_type', 'shipment').eq('aggregate_id', trackingNumber)
      .order('created_at', { ascending: false }).limit(50));
  }
  const responses = await Promise.all(queries);
  const failed = responses.find((response) => response.error);
  if (failed?.error) throw failed.error;
  const effects = [...new Map(responses
    .flatMap((response) => response.data || [])
    .map((effect) => [effect.id, effect])).values()]
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))
    .slice(0, 50);
  const eventIds = [...new Set(effects.map((effect) => effect.event_id).filter(Boolean))];
  let events = [];
  if (eventIds.length) {
    const response = await sb.from('integration_events')
      .select('id,provider,provider_event_type,occurred_at,received_at')
      .in('id', eventIds);
    if (response.error) throw response.error;
    events = response.data || [];
  }
  const eventById = new Map(events.map((event) => [event.id, event]));
  return effects.map((effect) => ({
    id: effect.id,
    provider: eventById.get(effect.event_id)?.provider || 'unknown',
    event_type: eventById.get(effect.event_id)?.provider_event_type || null,
    effect_type: effect.effect_type,
    status: effect.status,
    attempt_count: effect.attempt_count,
    last_error_code: effect.last_error_code || null,
    result: effect.provider_result ? {
      applied: effect.provider_result.applied,
      skipped: effect.provider_result.skipped,
    } : null,
    created_at: effect.created_at,
    completed_at: effect.completed_at,
    dead_at: effect.dead_at,
  }));
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;

    // Buyer cancellation/return queue. Open requests are work that has a person waiting on
    // the other end, so they get their own listing rather than a per-order lookup.
    if (params.get('view') === 'requests') {
      const status = params.get('status') || 'open';
      let query = sb.from('order_requests')
        .select('id,order_id,type,status,reason,line_items,requested_email,resolution_note,created_at,resolved_at,orders(order_number,status,tracking_status,customer_email,total,currency,company_id)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (status !== 'all') query = query.eq('status', status);
      const { data, error } = await query;
      if (error) return json(500, { error: error.message });
      return json(200, { requests: data || [] });
    }

    // Printable packing slip for the warehouse. Scoped to one shipment when a split key is
    // given, so a partial shipment is packed against its own document.
    if (params.get('format') === 'packing_slip' && params.get('id')) {
      const { data: order, error } = await sb.from('orders')
        .select('id,order_number,purchase_order_number,ship_address,carrier,tracking_number,order_items(sku,name,qty,backordered),order_shipments(split_key,item_allocations,status)')
        .eq('id', params.get('id')).single();
      if (error) return json(error.code === 'PGRST116' ? 404 : 500, { error: error.message });
      const splitKey = params.get('split_key');
      const shipment = splitKey
        ? (order.order_shipments || []).find((entry) => entry.split_key === splitKey) || null
        : null;
      return new Response(packingSlipHtml(order, {
        shipment,
        generatedAt: new Date().toISOString().slice(0, 10),
      }), {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }

    // Per-order drill-down (#95): full detail + staff-action timeline for one order.
    const detailId = params.get('id');
    if (detailId) {
      const { data: order, error } = await sb.from('orders')
        .select('*,companies(name,net_terms_days,status),order_items(sku,product_sku,name,qty,unit_price,line_total,backordered),shipment_events(status,carrier,tracking_number,note,created_at),order_provider_links(id,provider,object_type,provider_object_id,metadata,created_at),order_financial_entries(source,entry_type,provider_object_id,amount,currency,recognition_state,reason,metadata,created_at),order_shipments(id,split_key,generation,revision,provider_shipment_id,external_shipment_id,package_hash,status,operation,operation_state,selected_rate_id,item_allocations,error_code,updated_at,order_shipment_packages(sequence,package_code,weight_value,weight_unit,length_in,width_in,height_in,package_hash),order_shipment_rates(provider_rate_id,provider_shipment_id,shipment_revision,carrier_id,carrier_code,carrier_name,service_code,service_type,amount_minor,currency,currency_exponent,package_hash,delivery_days,estimated_delivery_at,selected,invalidated_at)),shipstation_operation_attempts(operation_key,operation,order_shipment_id,provider_link_id,parent_provider_link_id,provider_object_id,status,error_code,provider_succeeded_at,lease_expires_at,created_at),order_requests(id,type,status,reason,line_items,requested_email,resolution_note,created_at,resolved_at),order_reversal_commands(id,type,status,request_id,retirement_reason,retired_by_email,retired_at,created_at)')
        .eq('id', detailId).single();
      if (error) return json(error.code === 'PGRST116' ? 404 : 500, { error: error.message });
      const { data: timeline } = await sb.from('audit_log')
        .select('action,actor_email,detail,created_at')
        .eq('target_type', 'order').eq('target_id', detailId)
        .order('created_at', { ascending: false }).limit(50);
      let integrationTimeline;
      try {
        integrationTimeline = await loadOrderIntegrationTimeline(sb, detailId, order.tracking_number);
      } catch {
        return json(503, { error: 'order_integration_timeline_unavailable' });
      }
      const safeOrder = { ...order };
      delete safeOrder.shipstation_label_url;
      safeOrder.cancellation_review = (safeOrder.order_reversal_commands || [])
        .filter((command) => command.type === 'cancel' && command.status === 'review_required')
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
      delete safeOrder.order_reversal_commands;
      return json(200, {
        order: decorateOrderLifecycle({ ...safeOrder, net_aging: netAging(order, order.companies?.net_terms_days) }),
        timeline: timeline || [],
        integration_timeline: integrationTimeline,
      });
    }

    const status = params.get('status');
    const isCsv = params.get('export') === 'csv';
    const { limit, offset } = parsePage(params, { defaultLimit: 100, maxLimit: 200 });
    let q = sb.from('orders')
      .select('id,order_number,status,payment_method,subtotal,shipping,tax,total,currency,purchase_order_number,refunded_amount,created_at,qbo_invoice_id,qbo_doc_id,qbo_doc_type,qbo_payment_id,qbo_intuit_tid,qbo_payment_intuit_tid,company_id,customer_email,ship_address,stripe_payment_intent,tracking_status,carrier,tracking_number,tracking_url,estimated_delivery_at,shipped_at,shipstation_shipment_id,shipstation_order_shipment_id,shipstation_shipment_revision,shipstation_package_hash,shipstation_shipment_state,shipstation_label_id,shipstation_rate_id,shipstation_carrier_id,shipstation_service_code,shipstation_cost,shipstation_label_status,shipstation_error,shipstation_updated_at,shipstation_return_label_id,shipstation_return_label_status,shipstation_return_cost,shipstation_return_currency,shipstation_return_charge_event,shipstation_return_tracking_number,shipstation_return_error,shipstation_return_updated_at,companies(name,net_terms_days),order_items(sku,product_sku,name,qty,unit_price,line_total,backordered),order_provider_links(id,provider,object_type,provider_object_id,metadata),order_financial_entries(source,entry_type,provider_object_id,recognition_state),order_shipments(id,split_key,generation,revision,status,operation_state,provider_shipment_id,external_shipment_id,package_hash,item_allocations,order_shipment_packages(sequence,package_code,weight_value,weight_unit,length_in,width_in,height_in,package_hash),order_shipment_rates(provider_rate_id,provider_shipment_id,shipment_revision,carrier_id,carrier_code,carrier_name,service_code,service_type,amount_minor,currency,currency_exponent,delivery_days,estimated_delivery_at,selected,invalidated_at)),shipstation_operation_attempts(operation_key,operation,order_shipment_id,provider_link_id,parent_provider_link_id,provider_object_id,status,error_code,provider_succeeded_at,lease_expires_at,created_at)', isCsv ? undefined : { count: 'exact' })
      .neq('status', 'cart').order('created_at', { ascending: false });
    q = isCsv ? q.limit(5000) : q.range(offset, offset + limit - 1);
    // "Needs fulfillment" is the queue the Overview counts, so the deep link from
    // that number has to select exactly the same rows: everything still owed a
    // shipment. Mirrors orderLifecycle().requires_fulfillment — open status, not
    // yet delivered — rather than any single status value.
    if (status === NEEDS_FULFILLMENT) {
      q = q.not('status', 'in', '(cart,cancelled,refunded,pending_payment)')
        .or('tracking_status.is.null,tracking_status.neq.delivered');
    } else if (status && ORDER_STATUSES.includes(status)) {
      q = q.eq('status', status);
    }
    // Server-side search so results aren't limited to the loaded page. Commas and
    // parens are stripped — they would break the PostgREST or= filter syntax.
    const search = String(params.get('search') || '').trim().replace(/[,()]/g, ' ').trim();
    if (search) {
      const like = `%${escapeLike(search)}%`;
      const ors = [`order_number.ilike.${like}`, `customer_email.ilike.${like}`, `tracking_number.ilike.${like}`];
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search)) ors.push(`id.eq.${search}`);
      const { data: cos } = await sb.from('companies').select('id').ilike('name', like).limit(50);
      const coIds = (cos || []).map((c) => c.id).filter(Boolean);
      if (coIds.length) ors.push(`company_id.in.(${coIds.join(',')})`);
      q = q.or(ors.join(','));
    }
    const { data, error, count } = await q;
    if (error) return json(500, { error: error.message });

    if (isCsv) {
      const rows = [['Order', 'Date', 'Company', 'Customer email', 'Purchase order', 'Status', 'Lifecycle', 'Next action', 'Payment', 'QBO doc', 'QBO payment', 'QBO TID', 'QBO payment TID', 'Tracking status', 'Carrier', 'Tracking #', 'ETA', 'Subtotal', 'Shipping', 'Tax', 'Total', 'Currency', 'Items']];
      for (const o of data || []) {
        const lifecycle = decorateOrderLifecycle(o).lifecycle;
        const items = (o.order_items || []).map((i) => `${i.qty}x ${i.name || i.sku}`).join('; ');
        rows.push([o.order_number || o.id, o.created_at, o.companies?.name || o.company_id || 'Guest', o.customer_email || '', o.purchase_order_number || '', o.status, lifecycle.label, lifecycle.next_action, o.payment_method || '', `${o.qbo_doc_type || ''} ${o.qbo_doc_id || o.qbo_invoice_id || ''}`.trim(), o.qbo_payment_id || '', o.qbo_intuit_tid || '', o.qbo_payment_intuit_tid || '',
          o.tracking_status || '', o.carrier || '', o.tracking_number || '', o.estimated_delivery_at || '',
          o.subtotal ?? '', o.shipping ?? '', o.tax ?? '', o.total ?? '', o.currency || '', items]);
      }
      return new Response(toCsv(rows), {
        status: 200,
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="masest-orders.csv"' },
      });
    }
    const orders = (data || []).map((o) => decorateOrderLifecycle({ ...o, net_aging: netAging(o, o.companies?.net_terms_days) }));
    return json(200, { orders, ...pageEnvelope(data, { limit, offset, count }) });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);

    // Operational acknowledgement. Separating "we have seen and owned this order" from
    // "a label exists" is what lets the queue show what still needs a human.
    if (body.action === 'accept_order') {
      if (!staffCan(role, 'order.write')) return json(403, { error: 'forbidden' });
      const { data: order, error: readErr } = await sb.from('orders')
        .select('id,order_number,status,accepted_at,company_id,customer_email')
        .eq('id', body.id).single();
      if (readErr) return json(readErr.code === 'PGRST116' ? 404 : 500, { error: readErr.message });
      if (!ACCEPTABLE_STATUSES.has(order.status)) {
        return json(409, { error: 'not_acceptable', message: `Order is ${order.status}.` });
      }
      if (order.accepted_at) {
        return json(200, { ok: true, already_accepted: true, order });
      }
      const { data: accepted, error } = await sb.from('orders')
        .update({ accepted_at: new Date().toISOString(), accepted_by: user?.id || null })
        .eq('id', body.id)
        .is('accepted_at', null)
        .select('id,order_number,status,accepted_at')
        .maybeSingle();
      if (error) return json(500, { error: error.message });
      // Lost the race with a concurrent accept — that is success, not a conflict.
      if (!accepted) return json(200, { ok: true, already_accepted: true, order });
      await recordAudit(sb, {
        user, action: 'order.accept', targetType: 'order', targetId: body.id,
        detail: { company_id: order.company_id },
      });
      return json(200, { ok: true, order: accepted });
    }

    // Batch form of accept_order for the queue's select-all. Accept is the one
    // order action that is safe to apply in bulk: it stamps ownership, is
    // idempotent, and changes no money, stock, or fulfillment state. Status moves
    // stay one-at-a-time because each is guarded by its own transition plan.
    if (body.action === 'accept_orders') {
      if (!staffCan(role, 'order.write')) return json(403, { error: 'forbidden' });
      const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).filter(Boolean))].slice(0, 200);
      if (!ids.length) return json(400, { error: 'ids_required' });
      const { data: rows, error: readErr } = await sb.from('orders')
        .select('id,status,accepted_at').in('id', ids);
      if (readErr) return json(500, { error: readErr.message });
      const eligible = (rows || []).filter((order) => ACCEPTABLE_STATUSES.has(order.status) && !order.accepted_at);
      if (!eligible.length) {
        return json(200, { ok: true, accepted: 0, skipped: ids.length });
      }
      const { data: accepted, error } = await sb.from('orders')
        .update({ accepted_at: new Date().toISOString(), accepted_by: user?.id || null })
        .in('id', eligible.map((order) => order.id))
        .is('accepted_at', null)
        .select('id');
      if (error) return json(500, { error: error.message });
      const acceptedIds = (accepted || []).map((order) => order.id);
      if (acceptedIds.length) {
        await recordAudit(sb, {
          user, action: 'order.accept_bulk', targetType: 'order', targetId: acceptedIds[0],
          detail: { order_ids: acceptedIds, count: acceptedIds.length },
        });
      }
      return json(200, { ok: true, accepted: acceptedIds.length, skipped: ids.length - acceptedIds.length });
    }

    // Preflight persists the exact revision/labels/money/stock/accounting snapshot. Confirm
    // accepts only that command identity; it never recomputes consequences from newer rows.
    if (body.action === 'retire_cancellation_review') {
      if (!staffCan(role, 'order.refund')) {
        return json(403, { error: 'forbidden', message: 'Retiring a blocked cancellation requires finance or owner access.' });
      }
      if (!body.id) return json(400, { error: 'order_id_required' });
      try {
        const result = await retireCancellationReviewCommand({
          sb,
          orderId: body.id,
          commandId: body.command_id,
          reason: body.reason,
          actor: user,
        });
        return json(200, {
          ok: true,
          retired: true,
          command: result.command,
          fresh_preflight_required: result.fresh_preflight_required,
          message: 'Blocked cancellation retired. Start a fresh cancellation preflight against the current order and accounting state.',
        });
      } catch (error) {
        const code = String(error?.code || error?.message || 'cancellation_review_retirement_failed');
        return json(orderReversalHttpStatus(error), { error: code });
      }
    }

    if (body.action === 'cancel_order') {
      if (!staffCan(role, 'order.refund')) {
        return json(403, { error: 'forbidden', message: 'Cancelling a paid order requires finance or owner access.' });
      }
      try {
        if (body.confirm === true) {
          const result = await confirmCancellationCommand({
            sb,
            orderId: body.id,
            commandId: body.command_id,
          });
          await recordAudit(sb, {
            user, action: 'order.cancel_queued', targetType: 'order', targetId: body.id,
            detail: { command_id: result.command.id, replay: result.replay },
          });
          return json(202, {
            ok: true,
            cancelling: true,
            replay: result.replay,
            command: result.command,
            message: 'Cancellation queued. Every label, refund, stock, accounting, and notification step is visible on the order timeline.',
          });
        }

        const result = await prepareCancellationCommand({
          sb,
          orderId: body.id,
          requestId: body.request_id,
          reason: body.reason,
          actor: user,
        });
        await recordAudit(sb, {
          user, action: 'order.cancel_preflight', targetType: 'order', targetId: body.id,
          detail: { command_id: result.command.id, request_id: result.command.request_id, plan_hash_bound: true },
        });
        return json(200, {
          ok: true,
          preflight: true,
          replay: result.replay,
          command: result.command,
          plan: result.plan,
        });
      } catch (error) {
        const code = String(error?.code || error?.message || 'cancellation_failed');
        return json(orderReversalHttpStatus(error), {
          error: code,
          message: code === 'accounting_review_required'
            ? 'QuickBooks receivable state needs finance review before this order can be cancelled.'
            : undefined,
        });
      }
    }

    // Approve or decline a buyer request. Approval does not duplicate the cancel/return
    // logic — it records the decision and points staff at the action that performs it, so
    // there is exactly one audited path that moves money or buys a label.
    if (body.action === 'resolve_request') {
      if (!staffCan(role, 'order.write')) return json(403, { error: 'forbidden' });
      const decision = String(body.decision || '').trim();
      if (!['approved', 'declined'].includes(decision)) return json(400, { error: 'invalid_decision' });
      const { data: existing, error: readErr } = await sb.from('order_requests')
        .select('id,order_id,type,status,reason,requested_email')
        .eq('id', body.request_id).single();
      if (readErr) return json(readErr.code === 'PGRST116' ? 404 : 500, { error: readErr.message });
      if (existing.status !== 'open') {
        return json(409, { error: 'request_already_resolved', status: existing.status });
      }
      const { data: resolved, error } = await sb.from('order_requests')
        .update({
          status: decision,
          resolved_by: user?.id || null,
          resolution_note: optionalText(body.note, 1000),
          resolved_at: new Date().toISOString(),
        })
        .eq('id', body.request_id)
        .eq('status', 'open')
        .select('id,order_id,type,status,resolved_at')
        .maybeSingle();
      if (error) return json(500, { error: error.message });
      if (!resolved) return json(409, { error: 'request_already_resolved' });
      await recordAudit(sb, {
        user, action: `order.request_${decision}`, targetType: 'order', targetId: existing.order_id,
        detail: { request_id: existing.id, type: existing.type },
      });
      return json(200, {
        ok: true,
        request: resolved,
        next_action: decision === 'approved'
          ? (existing.type === 'cancel' ? 'cancel_order' : 'return_label')
          : null,
      });
    }

    if (body.action === 'create_order') {
      if (!staffCan(role, 'order.write')) return json(403, { error: 'forbidden' });
      const normalized = normalizeOrderWrite(body);
      if (!normalized.ok) return json(400, { error: normalized.error, message: normalized.message });
      const invoiceId = optionalText(body.qbo_invoice_id, 80);
      const paymentId = optionalText(body.qbo_payment_id, 80);
      const orderWrite = {
        ...normalized.patch,
        qbo_invoice_id: invoiceId,
        qbo_payment_id: paymentId,
      };
      const { data: order, error } = await sb.rpc('create_manual_order_atomic', {
        p_order: orderWrite,
        p_items: normalized.items,
      });
      if (error) {
        const code = manualOrderErrorCode(error, 'manual_order_create_failed');
        return json(manualOrderHttpStatus(code), { error: code });
      }
      await recordAudit(sb, { user, action: 'order.create', targetType: 'order', targetId: order.id, detail: { company_id: order.company_id, status: order.status, payment_method: order.payment_method, item_count: normalized.items.length } });
      return json(201, { ok: true, order });
    }

    if (!body.id) return json(400, { error: 'order_id_required' });

    if (body.action === 'update_order') {
      if (!staffCan(role, 'order.write')) return json(403, { error: 'forbidden' });
      const { data: before, error: beforeErr } = await sb.from('orders')
        .select('id,company_id,customer_email,status,payment_method,reversal_revision')
        .eq('id', body.id).single();
      if (beforeErr) return json(beforeErr.code === 'PGRST116' ? 404 : 500, { error: beforeErr.message });
      if (!['cart', 'pending_payment'].includes(before.status)) {
        return json(409, { error: 'settled_order_lines_immutable' });
      }
      const normalized = normalizeOrderWrite(body, before.status);
      if (!normalized.ok) return json(400, { error: normalized.error, message: normalized.message });
      if (normalized.patch.status !== before.status || normalized.patch.payment_method !== before.payment_method) {
        return json(409, { error: 'use_explicit_order_action' });
      }
      const { data: order, error } = await sb.rpc('update_draft_order_atomic', {
        p_order_id: body.id,
        p_expected_revision: before.reversal_revision,
        p_order: normalized.patch,
        p_items: normalized.items,
      });
      if (error) {
        const code = manualOrderErrorCode(error, 'draft_order_update_failed');
        return json(manualOrderHttpStatus(code), { error: code });
      }
      await recordAudit(sb, { user, action: 'order.update', targetType: 'order', targetId: body.id, detail: { company_id: order.company_id, status: order.status, previous_status: before.status, item_count: normalized.items.length } });
      return json(200, { ok: true, order });
    }

    if (body.action === 'delete_order') {
      if (!staffCan(role, 'order.delete')) return json(403, { error: 'forbidden', message: 'Only owner staff can remove orders.' });
      const { data: order, error: readErr } = await sb.from('orders')
        .select('id,company_id,customer_email,status,payment_method,total,currency,reversal_revision')
        .eq('id', body.id).single();
      if (readErr) return json(readErr.code === 'PGRST116' ? 404 : 500, { error: readErr.message });
      const { data: deleted, error } = await sb.rpc('delete_draft_order_atomic', {
        p_order_id: body.id,
        p_expected_revision: order.reversal_revision,
      });
      if (error) {
        const code = manualOrderErrorCode(error, 'draft_order_delete_failed');
        return json(manualOrderHttpStatus(code), { error: code });
      }
      await recordAudit(sb, { user, action: 'order.delete', targetType: 'order', targetId: body.id, detail: deleted });
      return json(200, { ok: true, deleted: true });
    }

    if (body.action === 'refund') {
      if (!staffCan(role, 'order.refund')) return json(403, { error: 'forbidden', message: 'Refunds require finance or owner access.' });
      try {
        const result = await queueRefundCommand({
          sb,
          orderId: body.id,
          requestId: body.request_id,
          amount: body.amount,
          lines: body.lines,
          actor: user,
        });
        await recordAudit(sb, {
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
        return json(202, {
          ok: true,
          refund_queued: true,
          replay: result.replay,
          amount: Number(result.command.amount_minor) / 100,
          command: result.command,
          message: 'Refund queued. Money, stock, accounting, and notification progress is visible on the order timeline.',
        });
      } catch (error) {
        const code = String(error?.code || error?.message || 'refund_command_failed');
        return json(orderReversalHttpStatus(error), { error: code });
      }
    }

    if (body.action === 'record_qbo_invoice') {
      if (!staffCan(role, 'company.credit')) return json(403, { error: 'forbidden' });
      const invoiceId = String(body.qbo_invoice_id || '').trim();
      if (!invoiceId) return json(400, { error: 'qbo_invoice_id_required' });

      const { data: ord, error: e1 } = await sb.from('orders')
        .select('id,order_number,company_id,status,payment_method').eq('id', body.id).single();
      if (e1) return json(500, { error: e1.message });
      if (!ord) return json(404, { error: 'not_found' });
      if (ord.payment_method !== 'net') {
        return json(400, { error: 'qbo_invoice_not_net', message: 'Only NET orders can be linked to QuickBooks invoices.' });
      }
      try {
        await linkOrderProviderObject(sb, {
          orderId: ord.id, provider: 'quickbooks', objectType: 'invoice', providerObjectId: invoiceId,
          metadata: { order_number: ord.order_number },
        });
      } catch (linkError) {
        return json(linkError?.code === '23505' ? 409 : 500, { error: 'qbo_provider_link_failed' });
      }

      const { data: order, error } = await sb.from('orders')
        .update({
          qbo_invoice_id: invoiceId,
          qbo_sync_status: 'synced',
          qbo_doc_id: invoiceId,
          qbo_doc_type: 'invoice',
          qbo_synced_at: new Date().toISOString(),
          qbo_error: null,
        })
        .eq('id', body.id)
        .select('id,order_number,company_id,status,qbo_invoice_id,qbo_sync_status,qbo_doc_id,qbo_doc_type')
        .single();
      if (error) return json(500, { error: error.message });
      await notifyCompany(sb, env, request, order?.company_id, 'invoice ready', `QuickBooks invoice ${invoiceId} is linked to your order.`, order);
      await recordAudit(sb, { user, action: 'order.record_qbo_invoice', targetType: 'order', targetId: body.id, detail: { company_id: order?.company_id, qbo_invoice_id: invoiceId } });
      return json(200, { ok: true, order });
    }

    if (body.action === 'record_qbo_payment') {
      if (!staffCan(role, 'company.credit')) return json(403, { error: 'forbidden' });
      const paymentId = String(body.qbo_payment_id || '').trim();
      if (!paymentId) return json(400, { error: 'qbo_payment_id_required' });

      const { data: ord, error: e1 } = await sb.from('orders')
        .select('id,order_number,company_id,customer_email,status,payment_method,tracking_status,tracking_number').eq('id', body.id).single();
      if (e1) return json(500, { error: e1.message });
      if (!ord) return json(404, { error: 'not_found' });
      if (ord.payment_method !== 'net') {
        return json(400, { error: 'qbo_payment_not_net', message: 'Only NET orders can record QuickBooks Payments settlement ids.' });
      }
      try {
        await linkOrderProviderObject(sb, {
          orderId: ord.id, provider: 'quickbooks', objectType: 'payment', providerObjectId: paymentId,
          metadata: { order_number: ord.order_number },
        });
      } catch (linkError) {
        return json(linkError?.code === '23505' ? 409 : 500, { error: 'qbo_provider_link_failed' });
      }

      const { data: order, error } = await sb.from('orders')
        .update({
          status: settledOrderStatus(ord),
          qbo_payment_id: paymentId,
          qbo_error: null,
        })
        .eq('id', body.id)
        .select('id,order_number,company_id,customer_email,status,payment_method,total,currency,qbo_invoice_id,qbo_doc_id,qbo_doc_type,qbo_payment_id')
        .single();
      if (error) return json(500, { error: error.message });
      const notifyBody = `QuickBooks payment ${paymentId} is recorded for your order.`;
      const companyRecipients = await notifyCompany(sb, env, request, order?.company_id, 'payment received', notifyBody, order);
      await notifyBuyerTracking(env, request, order, 'payment received', notifyBody, companyRecipients);
      await recordAudit(sb, { user, action: 'order.record_qbo_payment', targetType: 'order', targetId: body.id, detail: { company_id: order?.company_id, qbo_payment_id: paymentId } });
      return json(200, { ok: true, order });
    }

    // Manual (non-QBO) NET settlement: mark an open NET balance paid without a
    // QuickBooks payment id. Finance action — adjusts the company's credit state.
    if (body.action === 'mark_net_paid') {
      if (!staffCan(role, 'company.credit')) return json(403, { error: 'forbidden' });
      const { data: ord, error: e1 } = await sb.from('orders')
        .select('id,order_number,company_id,customer_email,status,payment_method,tracking_status,tracking_number').eq('id', body.id).single();
      if (e1) return json(500, { error: e1.message });
      const plan = planNetSettlement(ord, { reference: body.reference });
      if (!plan.ok) return json(400, { error: plan.error });

      const { data: order, error } = await sb.from('orders')
        .update({ ...plan.update, status: settledOrderStatus(ord, plan.update.status) })
        .eq('id', body.id)
        .select('id,order_number,company_id,customer_email,status,payment_method,total,currency')
        .single();
      if (error) return json(500, { error: error.message });
      const notifyBody = plan.reference
        ? `Your NET balance is settled (reference ${plan.reference}). Payment received — thank you.`
        : 'Your NET balance is settled. Payment received — thank you.';
      const companyRecipients = await notifyCompany(sb, env, request, order?.company_id, 'payment received', notifyBody, order);
      await notifyBuyerTracking(env, request, order, 'payment received', notifyBody, companyRecipients);
      await recordAudit(sb, { user, action: 'order.mark_net_paid', targetType: 'order', targetId: body.id, detail: { company_id: order?.company_id, reference: plan.reference } });
      return json(200, { ok: true, order });
    }

    if (body.action === 'update_tracking') {
      const trackingStatus = String(body.tracking_status || 'processing').trim();
      if (!TRACKING_STATUSES.includes(trackingStatus)) return json(400, { error: 'invalid_tracking_status' });
      const { data: current, error: curErr } = await sb.from('orders')
        .select('id,status,payment_method').eq('id', body.id).single();
      if (curErr) return json(curErr.code === 'PGRST116' ? 404 : 500, { error: curErr.message });
      const carrier = String(body.carrier || '').trim().slice(0, 80) || null;
      const trackingNumber = String(body.tracking_number || '').trim().slice(0, 120) || null;
      const trackingUrl = String(body.tracking_url || '').trim().slice(0, 500) || null;
      const note = String(body.note || '').trim().slice(0, 280) || null;
      if (trackingUrl && !/^https?:\/\//i.test(trackingUrl)) return json(400, { error: 'invalid_tracking_url' });
      const estimatedDeliveryAt = body.estimated_delivery_at ? new Date(body.estimated_delivery_at) : null;
      if (estimatedDeliveryAt && Number.isNaN(estimatedDeliveryAt.getTime())) return json(400, { error: 'invalid_estimated_delivery_at' });
      const shippedAt = trackingStatus === 'shipped' || trackingStatus === 'delivered'
        ? (body.shipped_at ? new Date(body.shipped_at) : new Date())
        : (body.shipped_at ? new Date(body.shipped_at) : null);
      if (shippedAt && Number.isNaN(shippedAt.getTime())) return json(400, { error: 'invalid_shipped_at' });

      // Promote to 'fulfilled' only for settled orders. A shipped NET order MUST stay
      // net_open: 'fulfilled' drops it out of the company's outstanding-credit sum
      // (credit.js counts status='net_open' only) and hides "Mark NET paid" — the
      // receivable would silently vanish. Shipping before payment is the normal NET flow.
      // Delivered itself is enough evidence to close a settled order, including local
      // delivery / BOL workflows that do not produce a parcel tracking number.
      const fulfilled = shouldPromoteToFulfilled(current, trackingStatus, trackingNumber);
      const update = {
        tracking_status: trackingStatus,
        carrier,
        tracking_number: trackingNumber,
        tracking_url: trackingUrl,
        estimated_delivery_at: estimatedDeliveryAt ? estimatedDeliveryAt.toISOString() : null,
        shipped_at: shippedAt ? shippedAt.toISOString() : null,
      };
      if (fulfilled) {
        update.status = 'fulfilled';
      }

      const { data: order, error } = await sb.rpc('update_order_tracking_guarded', {
        p_order_id: body.id,
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
        return json(manualOrderHttpStatus(code), { error: code });
      }
      // Append a customer-visible shipment event (history) — best-effort; never fail the update.
      await sb.from('shipment_events').insert({
        order_id: body.id, status: trackingStatus, carrier, tracking_number: trackingNumber, note,
      }).then(() => {}, () => {});
      // Same copy the automatic carrier-scan path sends, so a buyer never gets two
      // differently worded notices for the same shipment. Delivered closes the loop on its
      // own; "shipped" without a parcel number has nothing to track, so it reads as a
      // generic tracking update.
      const noticeStatus = trackingStatus === 'delivered' || (trackingStatus === 'shipped' && trackingNumber)
        ? trackingStatus
        : 'tracking';
      const notice = shipmentNotice(noticeStatus, { carrier, trackingNumber });
      const notifyLabel = notice.label;
      const notifyBody = notice.body;
      // One rich tracking email (carrier/number/ETA + Track-shipment link) to buyer +
      // company order recipients; the in-app notification is inserted directly so
      // notifyCompany's generic email doesn't shadow the tracking link.
      if (order?.company_id) {
        await sb.from('notifications').insert({
          company_id: order.company_id, type: 'order', title: `Order ${orderReference(order)} ${notifyLabel}`,
          body: notifyBody || `Your order is now "${notifyLabel}".`, link: '/dashboard.html#orders',
        }).then(() => {}, () => {});
      }
      const companyRecipients = order?.company_id ? await companyEmails(sb, order.company_id, 'orders') : [];
      await sendTrackingEmail(env, request, order, notifyLabel, notifyBody, [order?.customer_email, ...companyRecipients]);
      await recordAudit(sb, { user, action: 'order.update_tracking', targetType: 'order', targetId: body.id, detail: { company_id: order?.company_id, update } });
      return json(200, { ok: true, order });
    }

    if (!ORDER_STATUSES.includes(body.status)) return json(400, { error: 'invalid_status' });
    const { data: before, error: beforeErr } = await sb.from('orders')
      .select('id,order_number,company_id,customer_email,status,total,currency')
      .eq('id', body.id).single();
    if (beforeErr) return json(beforeErr.code === 'PGRST116' ? 404 : 500, { error: beforeErr.message });
    if (body.status === before.status) return json(200, { ok: true, unchanged: true, order: before });
    return json(409, {
      error: 'use_explicit_order_action',
      message: 'Use the dedicated payment, fulfillment, cancellation, or refund action for this transition.',
    });
  }

  return json(405, { error: 'method_not_allowed' });
}
