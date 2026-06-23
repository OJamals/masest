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
import { stockIncrements } from '../../_lib/order-shape.js';
import { staffCan, staffCanWrite } from '../../_lib/authz.js';
import { planNetSettlement, netAging } from '../../_lib/credit.js';

const ORDER_STATUSES = ['cart', 'pending_payment', 'paid', 'net_open', 'net_paid', 'fulfilled', 'cancelled', 'refunded'];
const REFUND_BLOCKING_STATUSES = new Set(['cancelled', 'refunded']);
const TRACKING_STATUSES = ['processing', 'packing', 'shipped', 'delivered', 'blocked'];

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

async function notifyBuyerTracking(env, request, order, label, extra, exclude = []) {
  const email = String(order?.customer_email || '').trim();
  if (!email) return false;
  const normalized = email.toLowerCase();
  if ((exclude || []).some((item) => String(item || '').trim().toLowerCase() === normalized)) return false;

  const appUrl = env.APP_URL || new URL(request.url).origin;
  const details = [
    order?.carrier ? `<li><strong>Carrier:</strong> ${htmlEscape(order.carrier)}</li>` : '',
    order?.tracking_number ? `<li><strong>Tracking #:</strong> ${htmlEscape(order.tracking_number)}</li>` : '',
    order?.estimated_delivery_at ? `<li><strong>Estimated delivery:</strong> ${htmlEscape(order.estimated_delivery_at)}</li>` : '',
  ].filter(Boolean).join('');

  return sendEmail(env, {
    to: [email],
    subject: `Order ${label}`,
    html: emailLayout({
      heading: `Order ${label}`,
      bodyHtml: `<p>${htmlEscape(extra || `Your order is now "${label}".`)}</p>${details ? `<ul>${details}</ul>` : ''}`,
      ctaText: order?.tracking_url ? 'Track shipment' : 'Visit MASEST',
      ctaUrl: order?.tracking_url || appUrl,
    }),
    category: 'order',
  });
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
        order: { ...order, net_aging: netAging(order, order.companies?.net_terms_days) },
        timeline: timeline || [],
      });
    }

    const status = params.get('status');
    const isCsv = params.get('export') === 'csv';
    const { limit, offset } = parsePage(params, { defaultLimit: 100, maxLimit: 200 });
    let q = sb.from('orders')
      .select('id,status,payment_method,subtotal,tax,total,currency,refunded_amount,created_at,qbo_invoice_id,qbo_doc_id,qbo_doc_type,qbo_payment_id,company_id,customer_email,tracking_status,carrier,tracking_number,tracking_url,estimated_delivery_at,shipped_at,companies(name,net_terms_days),order_items(sku,name,qty,unit_price,line_total,backordered)', isCsv ? undefined : { count: 'exact' })
      .neq('status', 'cart').order('created_at', { ascending: false });
    q = isCsv ? q.limit(5000) : q.range(offset, offset + limit - 1);
    if (status && ORDER_STATUSES.includes(status)) q = q.eq('status', status);
    const { data, error, count } = await q;
    if (error) return json(500, { error: error.message });

    if (isCsv) {
      const rows = [['Order', 'Date', 'Company', 'Customer email', 'Status', 'Payment', 'QBO doc', 'QBO payment', 'Tracking status', 'Carrier', 'Tracking #', 'ETA', 'Subtotal', 'Tax', 'Total', 'Currency', 'Items']];
      for (const o of data || []) {
        const items = (o.order_items || []).map((i) => `${i.qty}x ${i.name || i.sku}`).join('; ');
        rows.push([o.id, o.created_at, o.companies?.name || o.company_id || 'Guest', o.customer_email || '', o.status, o.payment_method || '', `${o.qbo_doc_type || ''} ${o.qbo_doc_id || o.qbo_invoice_id || ''}`.trim(), o.qbo_payment_id || '',
          o.tracking_status || '', o.carrier || '', o.tracking_number || '', o.estimated_delivery_at || '',
          o.subtotal ?? '', o.tax ?? '', o.total ?? '', o.currency || '', items]);
      }
      return new Response(toCsv(rows), {
        status: 200,
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="masest-orders.csv"' },
      });
    }
    const orders = (data || []).map((o) => ({ ...o, net_aging: netAging(o, o.companies?.net_terms_days) }));
    return json(200, { orders, ...pageEnvelope(data, { limit, offset, count }) });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);
    if (!body.id) return json(400, { error: 'order_id_required' });

    if (body.action === 'refund') {
      if (!staffCan(role, 'order.refund')) return json(403, { error: 'forbidden', message: 'Refunds require finance or owner access.' });
      const { data: ord, error: e1 } = await sb.from('orders')
        .select('id,company_id,status,total,currency,refunded_amount,payment_method,stripe_payment_intent,order_items(sku,qty)').eq('id', body.id).single();
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
      await notifyCompany(sb, env, request, updated?.company_id, label, refundMsg);
      await recordAudit(sb, {
        user,
        action: plan.fullyRefunded ? 'order.refund' : 'order.refund_partial',
        targetType: 'order', targetId: body.id,
        detail: { company_id: updated?.company_id, amount: plan.amount, refunded_amount: plan.newRefundedAmount, fully_refunded: plan.fullyRefunded },
      });
      return json(200, { ok: true, refunded: plan.fullyRefunded, partial: !plan.fullyRefunded, amount: plan.amount, order: updated });
    }

    if (body.action === 'record_qbo_invoice') {
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
      const paymentId = String(body.qbo_payment_id || '').trim();
      if (!paymentId) return json(400, { error: 'qbo_payment_id_required' });

      const { data: ord, error: e1 } = await sb.from('orders')
        .select('id,company_id,customer_email,status,payment_method').eq('id', body.id).single();
      if (e1) return json(500, { error: e1.message });
      if (!ord) return json(404, { error: 'not_found' });
      if (ord.payment_method !== 'net') {
        return json(400, { error: 'qbo_payment_not_net', message: 'Only NET orders can record QuickBooks Payments settlement ids.' });
      }

      const { data: order, error } = await sb.from('orders')
        .update({
          status: 'net_paid',
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
        .select('id,company_id,customer_email,status,payment_method').eq('id', body.id).single();
      if (e1) return json(500, { error: e1.message });
      const plan = planNetSettlement(ord, { reference: body.reference });
      if (!plan.ok) return json(400, { error: plan.error });

      const { data: order, error } = await sb.from('orders')
        .update(plan.update)
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

      const fulfilled = ['shipped', 'delivered'].includes(trackingStatus) && trackingNumber;
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
      const notifyLabel = fulfilled ? 'fulfilled' : 'tracking updated';
      const notifyBody = fulfilled
        ? `Your order has shipped. ${carrier || 'Carrier'} ${trackingNumber}`.trim()
        : `${carrier || 'Carrier'} ${trackingNumber || ''}`.trim();
      const companyRecipients = await notifyCompany(sb, env, request, order?.company_id, notifyLabel, notifyBody);
      await notifyBuyerTracking(env, request, order, notifyLabel, notifyBody, companyRecipients);
      await recordAudit(sb, { user, action: 'order.update_tracking', targetType: 'order', targetId: body.id, detail: { company_id: order?.company_id, update } });
      return json(200, { ok: true, order });
    }

    if (!ORDER_STATUSES.includes(body.status)) return json(400, { error: 'invalid_status' });
    const { data: order, error } = await sb.from('orders').update({ status: body.status })
      .eq('id', body.id).select('id,company_id,status,total,currency').single();
    if (error) return json(500, { error: error.message });
    await notifyCompany(sb, env, request, order?.company_id, body.status.replace('_', ' '));
    await recordAudit(sb, { user, action: 'order.set_status', targetType: 'order', targetId: body.id, detail: { company_id: order?.company_id, status: body.status } });
    return json(200, { ok: true, order });
  }

  return json(405, { error: 'method_not_allowed' });
}
