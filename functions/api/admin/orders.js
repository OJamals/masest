// /api/admin/orders — staff order management.
//   GET ?status=&limit=         → orders across all companies
//   GET ?export=csv             → CSV download of (filtered) orders
//   POST { id, status }         → update status + notify company
//   POST { id, action:'refund' }→ Stripe refund + cancel + notify
import Stripe from 'stripe';
import { adminClient, requireStaff, json, readBody, companyEmails, sendEmail, emailLayout } from '../../_lib/supabase.js';

const ORDER_STATUSES = ['cart', 'pending_payment', 'paid', 'net_open', 'net_paid', 'fulfilled', 'cancelled'];

function toCsv(rows) {
  return rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

async function notifyCompany(sb, env, request, companyId, label, extra) {
  if (!companyId) return;
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
      .select('id,status,payment_method,subtotal,tax,total,currency,created_at,qbo_invoice_id,company_id,companies(name),order_items(sku,name,qty,unit_price,line_total)')
      .neq('status', 'cart').order('created_at', { ascending: false }).limit(limit);
    if (status && ORDER_STATUSES.includes(status)) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return json(500, { error: error.message });

    if (isCsv) {
      const rows = [['Order', 'Date', 'Company', 'Status', 'Payment', 'Subtotal', 'Tax', 'Total', 'Currency', 'Items']];
      for (const o of data || []) {
        const items = (o.order_items || []).map((i) => `${i.qty}x ${i.name || i.sku}`).join('; ');
        rows.push([o.id, o.created_at, o.companies?.name || o.company_id || 'Guest', o.status, o.payment_method || '',
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
      const { data: updated, error: e2 } = await sb.from('orders').update({ status: 'cancelled' })
        .eq('id', body.id).select('id,company_id,status').single();
      if (e2) return json(500, { error: e2.message });
      await notifyCompany(sb, env, request, updated?.company_id, 'refunded', 'Your MASEST order was refunded. The amount will return to your original payment method.');
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
      return json(200, { ok: true, order });
    }

    if (!ORDER_STATUSES.includes(body.status)) return json(400, { error: 'invalid_status' });
    const { data: order, error } = await sb.from('orders').update({ status: body.status })
      .eq('id', body.id).select('id,company_id,status,total,currency').single();
    if (error) return json(500, { error: error.message });
    await notifyCompany(sb, env, request, order?.company_id, body.status.replace('_', ' '));
    return json(200, { ok: true, order });
  }

  return json(405, { error: 'method_not_allowed' });
}
