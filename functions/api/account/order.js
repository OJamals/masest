// GET /api/account/order?id=<uuid> — single order detail + status, scoped to caller's company.
import { adminClient, userFromRequest, companyForUser, json } from '../../_lib/supabase.js';

export async function onRequestGet({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json(400, { error: 'order_id_required' });

  const sb = adminClient(env);
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return json(404, { error: 'not_found' });

  const { data, error } = await sb
    .from('orders')
    .select('id,status,payment_method,subtotal,tax,total,currency,created_at,qbo_invoice_id,ship_address,order_items(sku,name,qty,unit_price,line_total)')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) return json(500, { error: 'server_error' });
  if (!data) return json(404, { error: 'not_found' });
  return json(200, { order: data });
}
