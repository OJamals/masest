// GET /api/account/orders - recent orders for the authenticated caller's company.
import { requireCompany, json } from '../../_lib/supabase.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';
import { decorateOrderLifecycle } from '../../_lib/order-lifecycle.js';

export async function onRequestGet({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, sb } = ctx;

  const searchParams = new URL(request.url).searchParams;
  const { limit, offset } = parsePage(searchParams, { defaultLimit: 25, maxLimit: 100 });
  const wantsSummary = searchParams.get('summary') === '1';
  const ordersQuery = sb.from('orders')
    .select('id,status,payment_method,subtotal,shipping,tax,total,currency,purchase_order_number,created_at,qbo_invoice_id,qbo_sync_status,tracking_status,carrier,tracking_number,tracking_url,estimated_delivery_at,shipped_at,order_items(sku,product_sku,name,qty,unit_price,line_total),shipment_events(status,note,created_at)', { count: 'exact' })
    .eq('company_id', companyId)
    .neq('status', 'cart')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  const activeQuery = wantsSummary
    ? sb.from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .not('status', 'in', '(cart,cancelled,refunded)')
      .or('tracking_status.is.null,tracking_status.neq.delivered,status.not.in.(paid,net_paid,fulfilled)')
    : Promise.resolve({ count: 0, error: null });
  const [{ data, error, count }, { count: activeTotal, error: summaryError }] = await Promise.all([ordersQuery, activeQuery]);
  if (error || summaryError) return json(500, { error: 'server_error' });
  const orders = (data || []).map(decorateOrderLifecycle);
  return json(200, {
    orders,
    ...pageEnvelope(data, { limit, offset, count }),
    ...(wantsSummary ? { active_total: activeTotal || 0 } : {}),
  }, { 'cache-control': 'no-store' });
}
