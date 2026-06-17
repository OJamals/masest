// GET /api/account/orders — recent orders for the authenticated caller's company (or their own
// orders if not linked to one), newest first, with line items embedded. Auth required.
import { adminClient, userFromRequest, json } from '../../_lib/supabase.js';

export async function onRequestGet({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const sb = adminClient(env);
  const { data: profile } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();

  let q = sb.from('orders')
    .select('id,status,payment_method,subtotal,tax,total,currency,created_at,order_items(sku,product_sku,name,qty,unit_price,line_total)')
    .order('created_at', { ascending: false })
    .limit(25);
  // Company members see all company orders (Stripe orders carry company_id; NET orders carry both).
  // Users without a company fall back to their own user_id.
  q = profile?.company_id ? q.eq('company_id', profile.company_id) : q.eq('user_id', user.id);

  const { data, error } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { orders: data || [] }, { 'cache-control': 'no-store' });
}
