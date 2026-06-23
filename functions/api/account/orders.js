// GET /api/account/orders - recent orders for the authenticated caller's company.
import { requireCompany, json } from '../../_lib/supabase.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';

export async function onRequestGet({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, sb } = ctx;

  const { limit, offset } = parsePage(new URL(request.url).searchParams, { defaultLimit: 25, maxLimit: 100 });
  const { data, error, count } = await sb.from('orders')
    .select('id,status,payment_method,subtotal,tax,total,currency,created_at,tracking_status,carrier,tracking_number,tracking_url,estimated_delivery_at,shipped_at,order_items(sku,product_sku,name,qty,unit_price,line_total),shipment_events(status,note,created_at)', { count: 'exact' })
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return json(500, { error: 'server_error' });
  return json(200, { orders: data || [], ...pageEnvelope(data, { limit, offset, count }) }, { 'cache-control': 'no-store' });
}
