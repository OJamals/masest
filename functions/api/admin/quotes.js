// /api/admin/quotes — staff view of inbound /api/quote leads.
//   GET → { quotes:[...], new_count } · POST { id, status?, notes? } → update status / notes
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';

const STATUSES = ['new', 'contacted', 'closed', 'spam'];

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);

  if (request.method === 'GET') {
    const { data, error } = await sb.from('quotes')
      .select('id,created_at,type,name,email,company,phone,product,industry,location,message,payload,status,notes,handled_at')
      .order('created_at', { ascending: false }).limit(300);
    if (error) {
      // Table not migrated yet → tell the UI instead of a hard 500 (emails still work).
      if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { quotes: [], new_count: 0, needs_migration: true });
      return json(500, { error: error.message });
    }
    const new_count = (data || []).filter((q) => q.status === 'new').length;
    return json(200, { quotes: data || [], new_count });
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    if (!body.id) return json(400, { error: 'id_required' });

    // Convert a lead into a NET order for an existing account.
    if (body.action === 'convert') {
      const companyId = String(body.company_id || '');
      const items = Array.isArray(body.items) ? body.items : [];
      if (!companyId) return json(400, { error: 'company_id_required' });
      if (!items.length) return json(400, { error: 'items_required' });
      const { data: company } = await sb.from('companies').select('id,status').eq('id', companyId).maybeSingle();
      if (!company) return json(404, { error: 'company_not_found' });
      const clean = [];
      for (const it of items) {
        const qty = Math.max(1, parseInt(it.qty, 10) || 0);
        const price = Number(it.unit_price);
        const sku = String(it.sku || '').trim();
        if (!sku || !Number.isFinite(price) || price < 0 || qty < 1) return json(400, { error: 'invalid_item' });
        clean.push({ sku, product_sku: sku, name: String(it.name || sku).trim(), qty, unit_price: price, line_total: +(price * qty).toFixed(2) });
      }
      const subtotal = +clean.reduce((s, i) => s + i.line_total, 0).toFixed(2);
      const { data: order, error: oErr } = await sb.from('orders').insert({
        company_id: companyId, status: 'net_open', payment_method: 'net', subtotal, total: subtotal, currency: 'usd',
      }).select('id').single();
      if (oErr) return json(500, { error: oErr.message });
      const { error: iErr } = await sb.from('order_items').insert(clean.map((i) => ({ order_id: order.id, ...i })));
      if (iErr) return json(500, { error: iErr.message });
      await sb.from('quotes').update({ status: 'closed', handled_at: new Date().toISOString(), handled_by: user.email || null }).eq('id', body.id).then(() => {}, () => {});
      await sb.from('notifications').insert({ company_id: companyId, type: 'order', title: 'Order created from your quote', body: 'We turned your quote request into an order. See it in your dashboard.', link: '/dashboard.html#orders' }).then(() => {}, () => {});
      return json(200, { ok: true, order_id: order.id });
    }

    const patch = {};
    if (body.status) {
      if (!STATUSES.includes(body.status)) return json(400, { error: 'invalid_status' });
      patch.status = body.status;
      patch.handled_at = body.status === 'new' ? null : new Date().toISOString();
      patch.handled_by = body.status === 'new' ? null : (user.email || null);
    }
    if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 4000);
    if (!Object.keys(patch).length) return json(400, { error: 'nothing_to_update' });
    const { data, error } = await sb.from('quotes').update(patch).eq('id', body.id)
      .select('id,status,notes,handled_at').single();
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, quote: data });
  }

  return json(405, { error: 'method_not_allowed' });
}
