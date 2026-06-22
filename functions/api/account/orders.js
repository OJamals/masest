// GET /api/account/orders - recent orders for the authenticated caller's company.
import { adminClient, userFromRequest, companyForUser, json } from '../../_lib/supabase.js';

export async function onRequestGet({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const sb = adminClient(env);
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return json(403, { error: 'no_company' });

  const { data, error } = await sb.from('orders')
    .select('id,status,payment_method,subtotal,tax,total,currency,created_at,tracking_status,carrier,tracking_number,tracking_url,estimated_delivery_at,shipped_at,order_items(sku,product_sku,name,qty,unit_price,line_total)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) return json(500, { error: 'server_error' });
  return json(200, { orders: data || [] }, { 'cache-control': 'no-store' });
}
