// /api/admin/orders — staff order management.
//   GET ?status=&limit=         → orders across all companies
//   GET ?export=csv             → CSV download of (filtered) orders
//   POST { id, status }         → update status + notify company
//   POST { id, action:'refund' }→ Stripe refund + cancel + notify
import Stripe from 'stripe';
import { adminClient, requireStaff, json, readBody, companyEmails, sendEmail, emailLayout, htmlEscape } from '../../_lib/supabase.js';
import { recordAudit } from '../../_lib/audit.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';
import { computeRefund } from '../../_lib/refund.js';
import { stockDecrements, stockIncrements } from '../../_lib/order-shape.js';
import { staffCan, staffCanWrite } from '../../_lib/authz.js';
import { planNetSettlement, netAging } from '../../_lib/credit.js';
import { escapeLike } from '../../_lib/crm.js';
import { decorateOrderLifecycle, planOrderStatusWrite, settledOrderStatus, shouldPromoteToFulfilled } from '../../_lib/order-lifecycle.js';

const ORDER_STATUSES = ['cart', 'pending_payment', 'paid', 'net_open', 'net_paid', 'fulfilled', 'cancelled', 'refunded'];
const WRITABLE_ORDER_STATUSES = ORDER_STATUSES.filter((status) => status !== 'cart');
const PAYMENT_METHODS = ['stripe', 'net'];
const REFUND_BLOCKING_STATUSES = new Set(['cancelled', 'refunded']);
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
  const subtotal = amountOr(body.subtotal, lines.subtotal);
  const total = amountOr(body.total, subtotal + tax);
  if (subtotal == null || tax == null || total == null) return { ok: false, error: 'invalid_order_total' };
  return {
    ok: true,
    items: lines.items,
    patch: {
      company_id: optionalText(body.company_id, 80),
      customer_email: optionalText(body.customer_email, 240),
      status: status.status,
      payment_method: payment.method,
      subtotal,
      tax,
      total,
      currency: (optionalText(body.currency, 8) || 'usd').toLowerCase(),
    },
  };
}

async function decrementOrderStock(sb, items) {
  for (const args of stockDecrements(items)) {
    await sb.rpc('decrement_variant_stock', args).then(() => {}, () => {});
  }
}

function toCsv(rows) {
  return rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

async function notifyCompany(sb, env, request, companyId, label, extra) {
  if (!companyId) return [];
  await sb.from('notifications').insert({
    company_id: companyId, type: 'order', title: `Order ${label}`,
    body: extra || `Your order is now "${label}".`, link: '/dashboard.html#orders',
  }).then(() => {}, () => {});
  const appUrl = env.APP_URL || new URL(request.url).origin;
  const emails = await companyEmails(sb, companyId, 'orders');
  await sendEmail(env, {
    to: emails, subject: `Order ${label}`,
    html: emailLayout({
      heading: `Order ${label}`,
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
  const details = [
    order?.carrier ? `<li><strong>Carrier:</strong> ${htmlEscape(order.carrier)}</li>` : '',
    order?.tracking_number ? `<li><strong>Tracking #:</strong> ${htmlEscape(order.tracking_number)}</li>` : '',
    order?.estimated_delivery_at ? `<li><strong>Estimated delivery:</strong> ${htmlEscape(order.estimated_delivery_at)}</li>` : '',
  ].filter(Boolean).join('');

  return sendEmail(env, {
    to: unique,
    subject: `Order ${label}`,
    html: emailLayout({
      heading: `Order ${label}`,
      bodyHtml: `<p>${htmlEscape(extra || `Your order is now "${label}".`)}</p>${details ? `<ul>${details}</ul>` : ''}`,
      // Delivered points at the dashboard (reorder + order history); in-transit
      // states keep the carrier tracking link front and center.
      ctaText: label === 'delivered' ? 'View order & reorder'
        : order?.tracking_url ? 'Track shipment' : 'Visit MASEST',
      ctaUrl: label === 'delivered' ? `${appUrl}/dashboard.html#orders`
        : order?.tracking_url || appUrl,
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

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;

    // Per-order drill-down (#95): full detail + staff-action timeline for one order.
    const detailId = params.get('id');
    if (detailId) {
      const { data: order, error } = await sb.from('orders')
        .select('*,companies(name,net_terms_days,status),order_items(sku,product_sku,name,qty,unit_price,line_total,backordered),shipment_events(status,carrier,tracking_number,note,created_at)')
        .eq('id', detailId).single();
      if (error) return json(error.code === 'PGRST116' ? 404 : 500, { error: error.message });
      const { data: timeline } = await sb.from('audit_log')
        .select('action,actor_email,detail,created_at')
        .eq('target_type', 'order').eq('target_id', detailId)
        .order('created_at', { ascending: false }).limit(50);
      return json(200, {
        order: decorateOrderLifecycle({ ...order, net_aging: netAging(order, order.companies?.net_terms_days) }),
        timeline: timeline || [],
      });
    }

    const status = params.get('status');
    const isCsv = params.get('export') === 'csv';
    const { limit, offset } = parsePage(params, { defaultLimit: 100, maxLimit: 200 });
    let q = sb.from('orders')
      .select('id,status,payment_method,subtotal,tax,total,currency,refunded_amount,created_at,qbo_invoice_id,qbo_doc_id,qbo_doc_type,qbo_payment_id,company_id,customer_email,stripe_payment_intent,tracking_status,carrier,tracking_number,tracking_url,estimated_delivery_at,shipped_at,companies(name,net_terms_days),order_items(sku,product_sku,name,qty,unit_price,line_total,backordered)', isCsv ? undefined : { count: 'exact' })
      .neq('status', 'cart').order('created_at', { ascending: false });
    q = isCsv ? q.limit(5000) : q.range(offset, offset + limit - 1);
    if (status && ORDER_STATUSES.includes(status)) q = q.eq('status', status);
    // Server-side search so results aren't limited to the loaded page. Commas and
    // parens are stripped — they would break the PostgREST or= filter syntax.
    const search = String(params.get('search') || '').trim().replace(/[,()]/g, ' ').trim();
    if (search) {
      const like = `%${escapeLike(search)}%`;
      const ors = [`customer_email.ilike.${like}`, `tracking_number.ilike.${like}`];
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search)) ors.push(`id.eq.${search}`);
      const { data: cos } = await sb.from('companies').select('id').ilike('name', like).limit(50);
      const coIds = (cos || []).map((c) => c.id).filter(Boolean);
      if (coIds.length) ors.push(`company_id.in.(${coIds.join(',')})`);
      q = q.or(ors.join(','));
    }
    const { data, error, count } = await q;
    if (error) return json(500, { error: error.message });

    if (isCsv) {
      const rows = [['Order', 'Date', 'Company', 'Customer email', 'Status', 'Lifecycle', 'Next action', 'Payment', 'QBO doc', 'QBO payment', 'Tracking status', 'Carrier', 'Tracking #', 'ETA', 'Subtotal', 'Tax', 'Total', 'Currency', 'Items']];
      for (const o of data || []) {
        const lifecycle = decorateOrderLifecycle(o).lifecycle;
        const items = (o.order_items || []).map((i) => `${i.qty}x ${i.name || i.sku}`).join('; ');
        rows.push([o.id, o.created_at, o.companies?.name || o.company_id || 'Guest', o.customer_email || '', o.status, lifecycle.label, lifecycle.next_action, o.payment_method || '', `${o.qbo_doc_type || ''} ${o.qbo_doc_id || o.qbo_invoice_id || ''}`.trim(), o.qbo_payment_id || '',
          o.tracking_status || '', o.carrier || '', o.tracking_number || '', o.estimated_delivery_at || '',
          o.subtotal ?? '', o.tax ?? '', o.total ?? '', o.currency || '', items]);
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

    if (body.action === 'create_order') {
      if (!staffCan(role, 'order.write')) return json(403, { error: 'forbidden' });
      const normalized = normalizeOrderWrite(body);
      if (!normalized.ok) return json(400, { error: normalized.error, message: normalized.message });
      const invoiceId = optionalText(body.qbo_invoice_id, 80);
      const paymentId = optionalText(body.qbo_payment_id, 80);
      const qboLinked = Boolean(invoiceId || paymentId);
      const orderInsert = {
        ...normalized.patch,
        qbo_invoice_id: invoiceId,
        qbo_doc_id: invoiceId,
        qbo_doc_type: invoiceId ? 'invoice' : null,
        qbo_payment_id: paymentId,
        qbo_sync_status: qboLinked ? 'synced' : 'pending',
        qbo_synced_at: qboLinked ? new Date().toISOString() : null,
      };
      const { data: order, error } = await sb.from('orders')
        .insert(orderInsert)
        .select('id,company_id,customer_email,status,payment_method,total,currency,qbo_invoice_id,qbo_doc_id,qbo_doc_type,qbo_payment_id')
        .single();
      if (error) return json(500, { error: error.message });
      const orderItems = normalized.items.map((item) => ({ ...item, order_id: order.id }));
      const { error: itemsError } = await sb.from('order_items').insert(orderItems);
      if (itemsError) {
        await sb.from('orders').delete().eq('id', order.id).then(() => {}, () => {});
        return json(500, { error: itemsError.message });
      }
      await decrementOrderStock(sb, normalized.items);
      await recordAudit(sb, { user, action: 'order.create', targetType: 'order', targetId: order.id, detail: { company_id: order.company_id, status: order.status, payment_method: order.payment_method, item_count: normalized.items.length } });
      return json(201, { ok: true, order });
    }

    if (!body.id) return json(400, { error: 'order_id_required' });

    if (body.action === 'update_order') {
      if (!staffCan(role, 'order.write')) return json(403, { error: 'forbidden' });
      const { data: before, error: beforeErr } = await sb.from('orders')
        .select('id,company_id,customer_email,status,payment_method,order_items(sku,qty,backordered)')
        .eq('id', body.id).single();
      if (beforeErr) return json(beforeErr.code === 'PGRST116' ? 404 : 500, { error: beforeErr.message });
      const normalized = normalizeOrderWrite(body, before.status);
      if (!normalized.ok) return json(400, { error: normalized.error, message: normalized.message });
      const statusPlan = planOrderStatusWrite(before, normalized.patch.status);
      if (!statusPlan.ok) return json(400, { error: statusPlan.error });

      const { data: order, error } = await sb.from('orders')
        .update(normalized.patch)
        .eq('id', body.id)
        .select('id,company_id,customer_email,status,payment_method,total,currency,qbo_invoice_id,qbo_doc_id,qbo_doc_type,qbo_payment_id')
        .single();
      if (error) return json(500, { error: error.message });

      const { error: deleteItemsError } = await sb.from('order_items').delete().eq('order_id', body.id);
      if (deleteItemsError) return json(500, { error: deleteItemsError.message });
      const { error: insertItemsError } = await sb.from('order_items').insert(normalized.items.map((item) => ({ ...item, order_id: body.id })));
      if (insertItemsError) return json(500, { error: insertItemsError.message });

      if (order.status === 'cancelled' && before.status === 'net_open' && before.payment_method === 'net') {
        for (const args of stockIncrements(before.order_items)) {
          await sb.rpc('increment_variant_stock', args).then(() => {}, () => {});
        }
      }
      if (order.status !== before.status) {
        const statusLabel = order.status.replace('_', ' ');
        const recipients = await notifyCompany(sb, env, request, order.company_id, statusLabel);
        await notifyBuyerTracking(env, request, order, statusLabel, null, recipients);
      }
      await recordAudit(sb, { user, action: 'order.update', targetType: 'order', targetId: body.id, detail: { company_id: order.company_id, status: order.status, previous_status: before.status, item_count: normalized.items.length } });
      return json(200, { ok: true, order });
    }

    if (body.action === 'delete_order') {
      if (!staffCan(role, 'order.delete')) return json(403, { error: 'forbidden', message: 'Only owner staff can remove orders.' });
      const { data: order, error: readErr } = await sb.from('orders')
        .select('id,company_id,customer_email,status,payment_method,total,currency')
        .eq('id', body.id).single();
      if (readErr) return json(readErr.code === 'PGRST116' ? 404 : 500, { error: readErr.message });
      const { error } = await sb.from('orders').delete().eq('id', body.id);
      if (error) return json(500, { error: error.message });
      await recordAudit(sb, { user, action: 'order.delete', targetType: 'order', targetId: body.id, detail: order });
      return json(200, { ok: true, deleted: true });
    }

    if (body.action === 'refund') {
      if (!staffCan(role, 'order.refund')) return json(403, { error: 'forbidden', message: 'Refunds require finance or owner access.' });
      const { data: ord, error: e1 } = await sb.from('orders')
        .select('id,company_id,customer_email,status,total,currency,refunded_amount,payment_method,stripe_payment_intent,order_items(sku,qty,backordered)').eq('id', body.id).single();
      if (e1) return json(500, { error: e1.message });
      if (!ord) return json(404, { error: 'not_found' });
      if (REFUND_BLOCKING_STATUSES.has(ord.status)) {
        return json(400, { error: 'not_refundable', message: `Order is already ${ord.status}.` });
      }
      if (ord.payment_method !== 'stripe' || !ord.stripe_payment_intent) {
        return json(400, { error: 'not_refundable', message: 'Only Stripe-paid orders can be refunded here. Cancel NET orders by setting status to cancelled.' });
      }
      // amount omitted → refund the whole remaining balance; otherwise a partial refund.
      const plan = computeRefund({ total: ord.total, refundedAmount: ord.refunded_amount, requestedAmount: body.amount });
      if (!plan.ok) return json(400, { error: plan.error });
      const secret = env.STRIPE_SECRET_KEY;
      if (!secret) return json(500, { error: 'stripe_not_configured' });
      const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() });
      try {
        // Deterministic idempotency key so a retried / double-submitted refund settles
        // once at Stripe. Keyed on the order + its pre-refund state + this amount: an
        // identical retry dedupes, while a distinct later partial refund still goes
        // through (different prior refunded_amount → different key).
        const idempotencyKey = `refund:${ord.id}:${ord.refunded_amount || 0}:${plan.amountCents}`;
        await stripe.refunds.create(
          { payment_intent: ord.stripe_payment_intent, amount: plan.amountCents },
          { idempotencyKey },
        );
      } catch (err) {
        return json(502, { error: 'stripe_refund_failed', detail: err?.message || String(err) });
      }
      const update = { refunded_amount: plan.newRefundedAmount };
      if (plan.fullyRefunded) update.status = 'refunded';
      const { data: updated, error: e2 } = await sb.from('orders').update(update)
        .eq('id', body.id).select('id,company_id,status,total,refunded_amount').single();
      if (e2) return json(500, { error: e2.message });
      // Return refunded line items to inventory only on a full refund (a partial
      // amount can't be mapped to specific lines). Best-effort: never fail the refund.
      if (plan.fullyRefunded) {
        for (const args of stockIncrements(ord.order_items)) {
          await sb.rpc('increment_variant_stock', args).then(() => {}, () => {});
        }
      }
      // Queue a reversing QBO credit memo (#22) so the books match the refund. The
      // worker posts it and retries on failure; best-effort here — never fail the
      // refund (the money already moved at Stripe) if the enqueue hiccups.
      await sb.from('qbo_refunds').insert({
        order_id: ord.id,
        amount: plan.amount,
        fully_refunded: plan.fullyRefunded,
      }).then(() => {}, () => {});
      const label = plan.fullyRefunded ? 'refunded' : 'partially refunded';
      const refundMsg = plan.fullyRefunded
        ? 'Your MASEST order was refunded. The amount will return to your original payment method.'
        : `A partial refund of $${plan.amount.toFixed(2)} was issued to your original payment method.`;
      const refundRecipients = await notifyCompany(sb, env, request, updated?.company_id, label, refundMsg);
      // Guest orders have no company — email the buyer directly (excluded if already covered).
      await notifyBuyerTracking(env, request, ord, label, refundMsg, refundRecipients);
      await recordAudit(sb, {
        user,
        action: plan.fullyRefunded ? 'order.refund' : 'order.refund_partial',
        targetType: 'order', targetId: body.id,
        detail: { company_id: updated?.company_id, amount: plan.amount, refunded_amount: plan.newRefundedAmount, fully_refunded: plan.fullyRefunded },
      });
      return json(200, { ok: true, refunded: plan.fullyRefunded, partial: !plan.fullyRefunded, amount: plan.amount, order: updated });
    }

    if (body.action === 'record_qbo_invoice') {
      if (!staffCan(role, 'company.credit')) return json(403, { error: 'forbidden' });
      const invoiceId = String(body.qbo_invoice_id || '').trim();
      if (!invoiceId) return json(400, { error: 'qbo_invoice_id_required' });

      const { data: ord, error: e1 } = await sb.from('orders')
        .select('id,company_id,status,payment_method').eq('id', body.id).single();
      if (e1) return json(500, { error: e1.message });
      if (!ord) return json(404, { error: 'not_found' });
      if (ord.payment_method !== 'net') {
        return json(400, { error: 'qbo_invoice_not_net', message: 'Only NET orders can be linked to QuickBooks invoices.' });
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
        .select('id,company_id,status,qbo_invoice_id,qbo_sync_status,qbo_doc_id,qbo_doc_type')
        .single();
      if (error) return json(500, { error: error.message });
      await notifyCompany(sb, env, request, order?.company_id, 'invoice ready', `QuickBooks invoice ${invoiceId} is linked to your order.`);
      await recordAudit(sb, { user, action: 'order.record_qbo_invoice', targetType: 'order', targetId: body.id, detail: { company_id: order?.company_id, qbo_invoice_id: invoiceId } });
      return json(200, { ok: true, order });
    }

    if (body.action === 'record_qbo_payment') {
      if (!staffCan(role, 'company.credit')) return json(403, { error: 'forbidden' });
      const paymentId = String(body.qbo_payment_id || '').trim();
      if (!paymentId) return json(400, { error: 'qbo_payment_id_required' });

      const { data: ord, error: e1 } = await sb.from('orders')
        .select('id,company_id,customer_email,status,payment_method,tracking_status,tracking_number').eq('id', body.id).single();
      if (e1) return json(500, { error: e1.message });
      if (!ord) return json(404, { error: 'not_found' });
      if (ord.payment_method !== 'net') {
        return json(400, { error: 'qbo_payment_not_net', message: 'Only NET orders can record QuickBooks Payments settlement ids.' });
      }

      const { data: order, error } = await sb.from('orders')
        .update({
          status: settledOrderStatus(ord),
          qbo_payment_id: paymentId,
          qbo_error: null,
        })
        .eq('id', body.id)
        .select('id,company_id,customer_email,status,payment_method,total,currency,qbo_invoice_id,qbo_doc_id,qbo_doc_type,qbo_payment_id')
        .single();
      if (error) return json(500, { error: error.message });
      const notifyBody = `QuickBooks payment ${paymentId} is recorded for your order.`;
      const companyRecipients = await notifyCompany(sb, env, request, order?.company_id, 'payment received', notifyBody);
      await notifyBuyerTracking(env, request, order, 'payment received', notifyBody, companyRecipients);
      await recordAudit(sb, { user, action: 'order.record_qbo_payment', targetType: 'order', targetId: body.id, detail: { company_id: order?.company_id, qbo_payment_id: paymentId } });
      return json(200, { ok: true, order });
    }

    // Manual (non-QBO) NET settlement: mark an open NET balance paid without a
    // QuickBooks payment id. Finance action — adjusts the company's credit state.
    if (body.action === 'mark_net_paid') {
      if (!staffCan(role, 'company.credit')) return json(403, { error: 'forbidden' });
      const { data: ord, error: e1 } = await sb.from('orders')
        .select('id,company_id,customer_email,status,payment_method,tracking_status,tracking_number').eq('id', body.id).single();
      if (e1) return json(500, { error: e1.message });
      const plan = planNetSettlement(ord, { reference: body.reference });
      if (!plan.ok) return json(400, { error: plan.error });

      const { data: order, error } = await sb.from('orders')
        .update({ ...plan.update, status: settledOrderStatus(ord, plan.update.status) })
        .eq('id', body.id)
        .select('id,company_id,customer_email,status,payment_method,total,currency')
        .single();
      if (error) return json(500, { error: error.message });
      const notifyBody = plan.reference
        ? `Your NET balance is settled (reference ${plan.reference}). Payment received — thank you.`
        : 'Your NET balance is settled. Payment received — thank you.';
      const companyRecipients = await notifyCompany(sb, env, request, order?.company_id, 'payment received', notifyBody);
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

      const { data: order, error } = await sb.from('orders').update(update)
        .eq('id', body.id)
        .select('id,company_id,customer_email,status,tracking_status,carrier,tracking_number,tracking_url,estimated_delivery_at,shipped_at')
        .single();
      if (error) return json(500, { error: error.message });
      // Append a customer-visible shipment event (history) — best-effort; never fail the update.
      await sb.from('shipment_events').insert({
        order_id: body.id, status: trackingStatus, carrier, tracking_number: trackingNumber, note,
      }).then(() => {}, () => {});
      const shipped = ['shipped', 'delivered'].includes(trackingStatus) && trackingNumber;
      // Delivered gets its own close-the-loop message (it used to reuse "shipped",
      // and delivered-without-a-tracking-number fell to "tracking updated").
      const delivered = trackingStatus === 'delivered';
      const notifyLabel = delivered ? 'delivered' : shipped ? 'shipped' : 'tracking updated';
      const notifyBody = delivered
        ? 'Your order was delivered. Reorder anytime from your dashboard, and reply to this email if anything arrived short or damaged.'
        : shipped
          ? `Your order has shipped. ${carrier || 'Carrier'} ${trackingNumber}`.trim()
          : `${carrier || 'Carrier'} ${trackingNumber || ''}`.trim();
      // One rich tracking email (carrier/number/ETA + Track-shipment link) to buyer +
      // company order recipients; the in-app notification is inserted directly so
      // notifyCompany's generic email doesn't shadow the tracking link.
      if (order?.company_id) {
        await sb.from('notifications').insert({
          company_id: order.company_id, type: 'order', title: `Order ${notifyLabel}`,
          body: notifyBody || `Your order is now "${notifyLabel}".`, link: '/dashboard.html#orders',
        }).then(() => {}, () => {});
      }
      const companyRecipients = order?.company_id ? await companyEmails(sb, order.company_id, 'orders') : [];
      await sendTrackingEmail(env, request, order, notifyLabel, notifyBody, [order?.customer_email, ...companyRecipients]);
      await recordAudit(sb, { user, action: 'order.update_tracking', targetType: 'order', targetId: body.id, detail: { company_id: order?.company_id, update } });
      return json(200, { ok: true, order });
    }

    if (!ORDER_STATUSES.includes(body.status)) return json(400, { error: 'invalid_status' });
    // Money states must go through their dedicated actions: a bare status write moves no
    // money, returns no stock, and posts no QBO reversal. 'cart' would also hide the
    // order from the admin list (the GET filters it out) with no way back.
    if (body.status === 'refunded') {
      return json(400, { error: 'use_refund_action', message: 'Use the Refund control — setting the status directly would not move any money.' });
    }
    if (body.status === 'cart') return json(400, { error: 'invalid_status' });
    const { data: before, error: beforeErr } = await sb.from('orders')
      .select('id,company_id,customer_email,status,payment_method,order_items(sku,qty,backordered)')
      .eq('id', body.id).single();
    if (beforeErr) return json(beforeErr.code === 'PGRST116' ? 404 : 500, { error: beforeErr.message });
    const statusPlan = planOrderStatusWrite(before, body.status);
    if (!statusPlan.ok) return json(400, { error: statusPlan.error });
    const { data: order, error } = await sb.from('orders').update({ status: statusPlan.status })
      .eq('id', body.id).select('id,company_id,customer_email,status,total,currency').single();
    if (error) return json(500, { error: error.message });
    // Cancelling an open NET order is the sanctioned NET-cancel path (refund action
    // rejects NET). Its stock was decremented at placement — return it exactly once,
    // on the net_open→cancelled edge.
    if (body.status === 'cancelled' && before.status === 'net_open' && before.payment_method === 'net') {
      for (const args of stockIncrements(before.order_items)) {
        await sb.rpc('increment_variant_stock', args).then(() => {}, () => {});
      }
    }
    const statusLabel = body.status.replace('_', ' ');
    const statusRecipients = await notifyCompany(sb, env, request, order?.company_id, statusLabel);
    // Guest orders have no company — email the buyer directly (excluded if already covered).
    await notifyBuyerTracking(env, request, order, statusLabel, null, statusRecipients);
    await recordAudit(sb, { user, action: 'order.set_status', targetType: 'order', targetId: body.id, detail: { company_id: order?.company_id, status: body.status, previous_status: before.status } });
    return json(200, { ok: true, order });
  }

  return json(405, { error: 'method_not_allowed' });
}
