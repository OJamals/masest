// /api/admin/orders — staff order management.
//   GET ?status=&limit= → orders across all companies · POST { id, status } → update + notify company
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';

const ORDER_STATUSES = ['cart', 'pending_payment', 'paid', 'net_open', 'net_paid', 'fulfilled', 'cancelled'];

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const status = params.get('status');
    const limit = Math.min(200, parseInt(params.get('limit') || '100', 10) || 100);
    let q = sb.from('orders')
      .select('id,status,payment_method,subtotal,tax,total,currency,created_at,qbo_invoice_id,company_id,companies(name),order_items(sku,name,qty,unit_price,line_total)')
      .neq('status', 'cart').order('created_at', { ascending: false }).limit(limit);
    if (status && ORDER_STATUSES.includes(status)) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return json(500, { error: error.message });
    return json(200, { orders: data || [] });
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    if (!body.id) return json(400, { error: 'order_id_required' });
    if (!ORDER_STATUSES.includes(body.status)) return json(400, { error: 'invalid_status' });
    const { data: order, error } = await sb.from('orders').update({ status: body.status })
      .eq('id', body.id).select('id,company_id,status,total,currency').single();
    if (error) return json(500, { error: error.message });
    if (order?.company_id) {
      await sb.from('notifications').insert({
        company_id: order.company_id, type: 'order',
        title: `Order ${body.status.replace('_', ' ')}`,
        body: `Your order is now "${body.status.replace('_', ' ')}".`,
        link: '/dashboard.html#orders',
      }).then(() => {}, () => {});
    }
    return json(200, { ok: true, order });
  }

  return json(405, { error: 'method_not_allowed' });
}
