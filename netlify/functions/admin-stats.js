// GET /api/admin/stats — dashboard overview metrics. Staff-only.
// Degrades gracefully: any table not yet migrated contributes 0 rather than failing the whole call.
import { adminClient, requireStaff, json } from '../lib/supabase.js';

const since = (days) => new Date(Date.now() - days * 86400e3).toISOString();

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const { user, staff } = await requireStaff(req);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient();
  const count = async (table, build) => {
    try {
      let q = sb.from(table).select('*', { count: 'exact', head: true });
      if (build) q = build(q);
      const { count: c } = await q;
      return c || 0;
    } catch { return 0; }
  };

  // Revenue = sum of captured/closed order totals (bounded fetch).
  let revenue = 0;
  let recentOrders = [];
  try {
    const { data } = await sb
      .from('orders')
      .select('id,status,total,currency,payment_method,created_at,company_id')
      .neq('status', 'cart')
      .order('created_at', { ascending: false })
      .limit(1000);
    recentOrders = data || [];
    revenue = recentOrders
      .filter((o) => ['paid', 'net_paid', 'fulfilled'].includes(o.status))
      .reduce((s, o) => s + Number(o.total || 0), 0);
  } catch { /* table shape may differ pre-migration */ }

  // Low stock (only meaningful once Phase-5 columns exist).
  let lowStock = 0;
  try {
    const { data } = await sb.from('products').select('sku,track_stock,stock').eq('track_stock', true);
    lowStock = (data || []).filter((p) => Number(p.stock ?? 0) <= 10).length;
  } catch { lowStock = 0; }

  const [pendingCompanies, approvedCompanies, unreadMessages, views7d, buyCount, quoteCount] =
    await Promise.all([
      count('companies', (q) => q.eq('status', 'pending')),
      count('companies', (q) => q.eq('status', 'approved')),
      count('messages', (q) => q.eq('sender_role', 'buyer').eq('read_by_staff', false)),
      count('page_views', (q) => q.gte('created_at', since(7))),
      count('products', (q) => q.eq('mode', 'buy').eq('active', true)),
      count('products', (q) => q.eq('mode', 'quote').eq('active', true)),
    ]);

  const byStatus = recentOrders.reduce((m, o) => { m[o.status] = (m[o.status] || 0) + 1; return m; }, {});

  return json(200, {
    revenue,
    orders: { total: recentOrders.length, byStatus },
    companies: { pending: pendingCompanies, approved: approvedCompanies },
    messages: { unread: unreadMessages },
    catalog: { buy: buyCount, quote: quoteCount },
    inventory: { low_stock: lowStock },
    traffic: { views_7d: views7d },
  });
};

export const config = { path: '/api/admin/stats' };
