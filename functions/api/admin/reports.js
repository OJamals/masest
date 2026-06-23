// GET /api/admin/reports — revenue/tax report over an optional date range (#96).
//   ?from=&to=          → JSON summary (revenue, tax, AOV, counts, by-status/payment)
//   ?from=&to=&export=csv → per-order CSV for the range
// Staff-only. from/to are inclusive dates (YYYY-MM-DD) or ISO timestamps.
import { adminClient, requireStaff, json } from '../../_lib/supabase.js';
import { revenueReport, parseRange, csvResponse } from '../../_lib/reports.js';

export async function onRequestGet({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);
  const params = new URL(request.url).searchParams;
  const { fromIso, toIso } = parseRange(params.get('from'), params.get('to'));

  let q = sb.from('orders')
    .select('id,status,payment_method,subtotal,tax,total,currency,created_at,company_id,companies(name)')
    .neq('status', 'cart');
  if (fromIso) q = q.gte('created_at', fromIso);
  if (toIso) q = q.lte('created_at', toIso);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(5000);
  if (error) return json(500, { error: error.message });
  const orders = data || [];

  if (params.get('export') === 'csv') {
    const rows = [['Order', 'Date', 'Company', 'Status', 'Payment', 'Subtotal', 'Tax', 'Total', 'Currency']];
    for (const o of orders) {
      rows.push([o.id, o.created_at, o.companies?.name || o.company_id || 'Guest', o.status, o.payment_method || '',
        o.subtotal ?? '', o.tax ?? '', o.total ?? '', o.currency || '']);
    }
    return csvResponse(rows, 'masest-revenue');
  }

  return json(200, { range: { from: fromIso, to: toIso }, ...revenueReport(orders) });
}
