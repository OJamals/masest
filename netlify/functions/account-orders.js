// GET /api/account/orders — recent orders for the signed-in account's company, with line items.
// Referenced by site/js/auth.js orders(). Service-role read, scoped to the caller's company.
import { adminClient, userFromRequest, companyForUser, json } from '../lib/supabase.js';

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const { user } = await userFromRequest(req);
  if (!user) return json(401, { error: 'unauthenticated' });

  const sb = adminClient();
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return json(200, { orders: [] });

  const { data, error } = await sb
    .from('orders')
    .select('id,status,payment_method,subtotal,tax,total,currency,created_at,qbo_invoice_id,order_items(sku,name,qty,unit_price,line_total)')
    .eq('company_id', companyId)
    .neq('status', 'cart')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return json(500, { error: error.message });

  return json(200, { orders: data || [] });
};

export const config = { path: '/api/account/orders' };
