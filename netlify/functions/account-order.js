// GET /api/account/order?id=<uuid> — single order detail + status, scoped to caller's company.
import { adminClient, userFromRequest, companyForUser, json } from '../lib/supabase.js';

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const { user } = await userFromRequest(req);
  if (!user) return json(401, { error: 'unauthenticated' });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return json(400, { error: 'order_id_required' });

  const sb = adminClient();
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return json(404, { error: 'not_found' });

  const { data, error } = await sb
    .from('orders')
    .select('id,status,payment_method,subtotal,tax,total,currency,created_at,qbo_invoice_id,ship_address,order_items(sku,name,qty,unit_price,line_total)')
    .eq('id', id)
    .eq('company_id', companyId)   // ownership check — cannot read another company's order
    .maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!data) return json(404, { error: 'not_found' });

  return json(200, { order: data });
};

export const config = { path: '/api/account/order' };
