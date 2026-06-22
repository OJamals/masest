// /api/admin/orders — staff order management.
//   GET ?status=&limit=         → orders across all companies
//   GET ?export=csv             → CSV download of (filtered) orders
//   POST { id, status }         → update status + notify company
//   POST { id, action:'refund' }→ Stripe refund + cancel + notify
import Stripe from 'stripe';
import { adminClient, requireStaff, json, readBody, companyEmails, sendEmail, emailLayout, htmlEscape } from '../../_lib/supabase.js';
import { recordAudit } from '../../_lib/audit.js';

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
  const emails = await companyEmails(sb, companyId);
  await sendEmail(env, {
    to: emails, subject: `Order ${label}`,
    html: emailLayout({
      heading: `Order ${label}`,
      bodyHtml: `<p>${extra || `Your MASEST order status is now <b>${label}</b>.`}</p>`,
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
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const status = params.get('status');
    const isCsv = params.get('export') === 'csv';
    const limit = isCsv ? 5000 : Math.min(200, parseInt(params.get('limit') || '100', 10) || 100);
    let q = sb.from('orders')
      .select('id,status,payment_method,subtotal,tax,total,currency,created_at,qbo_invoice_id,qbo_doc_id,qbo_doc_type,qbo_payment_id,company_id,customer_email,tracking_status,carrier,tracking_number,tracking_url,estimated_delivery_at,shipped_at,companies(name),order_items(sku,name,qty,unit_price,line_total)')
      .neq('status', 'cart').order('created_at', { ascending: false }).limit(limit);
    if (status && ORDER_STATUSES.includes(status)) q = q.eq('status', status);
    const { data, error } = await q;
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
    return json(200, { orders: data || [] });
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    if (!body.id) return json(400, { error: 'order_id_required' });

    if (body.action === 'refund') {
      const { data: ord, error: e1 } = await sb.from('orders')
        .select('id,company_id,status,total,currency,payment_method,stripe_payment_intent').eq('id', body.id).single();
      if (e1) return json(500, { error: e1.message });
      if (!ord) return json(404, { error: 'not_found' });
      if (REFUND_BLOCKING_STATUSES.has(ord.status)) {
        return json(400, { error: 'not_refundable', message: `Order is already ${ord.status}.` });
      }
      if (ord.payment_method !== 'stripe' || !ord.stripe_payment_intent) {
        return json(400, { error: 'not_refundable', message: 'Only Stripe-paid orders can be refunded here. Cancel NET orders by setting status to cancelled.' });
      }
      const secret = env.STRIPE_SECRET_KEY;
      if (!secret) return json(500, { error: 'stripe_not_configured' });
      const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() });
      try {
        await stripe.refunds.create({ payment_intent: ord.stripe_payment_intent });
      } catch (err) {
        return json(502, { error: 'stripe_refund_failed', detail: err?.message || String(err) });
      }
      const { data: updated, error: e2 } = await sb.from('orders').update({ status: 'refunded' })
        .eq('id', body.id).select('id,company_id,status').single();
      if (e2) return json(500, { error: e2.message });
      await notifyCompany(sb, env, request, updated?.company_id, 'refunded', 'Your MASEST order was refunded. The amount will return to your original payment method.');
      await recordAudit(sb, { user, action: 'order.refund', targetType: 'order', targetId: body.id, detail: { company_id: updated?.company_id } });
      return json(200, { ok: true, refunded: true, order: updated });
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

    if (body.action === 'update_tracking') {
      const trackingStatus = String(body.tracking_status || 'processing').trim();
      if (!TRACKING_STATUSES.includes(trackingStatus)) return json(400, { error: 'invalid_tracking_status' });
      const carrier = String(body.carrier || '').trim().slice(0, 80) || null;
      const trackingNumber = String(body.tracking_number || '').trim().slice(0, 120) || null;
      const trackingUrl = String(body.tracking_url || '').trim().slice(0, 500) || null;
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
