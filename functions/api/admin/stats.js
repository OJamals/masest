// GET /api/admin/stats - dashboard overview metrics. Staff-only. Degrades gracefully pre-migration.
import { adminClient, requireStaff, json } from '../../_lib/supabase.js';
import { buildCompanySetup, setupStepBreakdown } from '../../_lib/setup.js';

const since = (days) => new Date(Date.now() - days * 86400e3).toISOString();
const action = (priority, label, value, href) => ({ priority, label, value, href });
const sumTotals = (orders) => orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
const withinDays = (iso, days) => iso && new Date(iso).getTime() >= Date.now() - days * 86400e3;
const countStatus = (orders, statuses) => orders.filter((order) => statuses.includes(order.status)).length;

export async function onRequestGet({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);
  const count = async (table, build) => {
    try {
      let q = sb.from(table).select('*', { count: 'exact', head: true });
      if (build) q = build(q);
      const { count: c } = await q;
      return c || 0;
    } catch {
      return 0;
    }
  };

  let revenue = 0;
  let recentOrders = [];
  try {
    const { data } = await sb.from('orders')
      .select('id,status,total,currency,payment_method,created_at,company_id')
      .neq('status', 'cart')
      .order('created_at', { ascending: false })
      .limit(1000);
    recentOrders = data || [];
    revenue = sumTotals(recentOrders.filter((order) => ['paid', 'net_paid', 'fulfilled'].includes(order.status)));
  } catch {
    // pre-migration shape
  }

  let lowStock = 0;
  let inactiveProducts = 0;
  try {
    const { data } = await sb.from('products').select('sku,active,track_stock,stock');
    const products = data || [];
    lowStock = products.filter((product) => product.track_stock && Number(product.stock ?? 0) <= 10).length;
    inactiveProducts = products.filter((product) => product.active === false).length;
  } catch {
    lowStock = 0;
    inactiveProducts = 0;
  }

  let setup_followups = { companies: 0, open_steps: [] };
  try {
    const { data } = await sb.from('companies')
      .select('id,name,status,tax_exempt,resale_cert_url,stripe_customer_id,net_terms_days,profiles(full_name,phone,role)');
    const open = (data || []).map((company) => ({ company, setup: buildCompanySetup(company) }))
      .filter((row) => row.setup.done < row.setup.total);
    const open_steps = {};
    for (const row of open) {
      for (const step of row.setup.open_steps) open_steps[step] = (open_steps[step] || 0) + 1;
    }
    setup_followups = { companies: open.length, open_steps: setupStepBreakdown(open_steps) };
  } catch {
    setup_followups = { companies: 0, open_steps: [] };
  }

  const nowIso = new Date().toISOString();
  const [
    pendingCompanies,
    approvedCompanies,
    suspendedCompanies,
    unreadMessages,
    views7d,
    uniqueVisitors7d,
    quoteSubmits7d,
    checkoutStarts7d,
    orderConfirms7d,
    buyCount,
    quoteCount,
    overdueQuoteFollowups,
    newQuotes,
    urgentQuotes,
  ] = await Promise.all([
    count('companies', (q) => q.eq('status', 'pending')),
    count('companies', (q) => q.eq('status', 'approved')),
    count('companies', (q) => q.eq('status', 'suspended')),
    count('messages', (q) => q.eq('sender_role', 'buyer').eq('read_by_staff', false)),
    count('page_views', (q) => q.gte('created_at', since(7))),
    count('page_views', (q) => q.gte('created_at', since(7)).not('visitor', 'is', null)),
    count('page_views', (q) => q.eq('event', 'quote_submit').gte('created_at', since(7))),
    count('page_views', (q) => q.eq('event', 'checkout_start').gte('created_at', since(7))),
    count('page_views', (q) => q.eq('event', 'order_confirmed').gte('created_at', since(7))),
    count('products', (q) => q.eq('mode', 'buy').eq('active', true)),
    count('products', (q) => q.eq('mode', 'quote').eq('active', true)),
    count('quotes', (q) => q.lte('due_at', nowIso).neq('status', 'closed').neq('status', 'spam')),
    count('quotes', (q) => q.eq('status', 'new')),
    count('quotes', (q) => q.eq('priority', 'urgent').neq('status', 'closed').neq('status', 'spam')),
  ]);

  const byStatus = recentOrders.reduce((m, order) => {
    m[order.status] = (m[order.status] || 0) + 1;
    return m;
  }, {});
  const paidOrders = recentOrders.filter((order) => ['paid', 'net_paid', 'fulfilled'].includes(order.status));
  const revenue7d = sumTotals(paidOrders.filter((order) => withinDays(order.created_at, 7)));
  const revenue30d = sumTotals(paidOrders.filter((order) => withinDays(order.created_at, 30)));
  const netOpenOrders = recentOrders.filter((order) => order.status === 'net_open');
  const commerce = {
    revenue_7d: revenue7d,
    revenue_30d: revenue30d,
    revenue_total_sample: revenue,
    average_order_value: paidOrders.length ? Math.round(revenue / paidOrders.length) : 0,
    orders_7d: recentOrders.filter((order) => withinDays(order.created_at, 7)).length,
    fulfillment_queue: countStatus(recentOrders, ['paid', 'net_open']),
    net_orders_open: netOpenOrders.length,
    net_exposure: sumTotals(netOpenOrders),
    by_status: byStatus,
  };
  const crm = {
    unread_messages: unreadMessages,
    quotes_new: newQuotes,
    quotes_urgent: urgentQuotes,
    quotes_overdue: overdueQuoteFollowups,
    setup_followups: setup_followups.companies,
  };
  const accounts = {
    pending: pendingCompanies,
    approved: approvedCompanies,
    suspended: suspendedCompanies,
    setup_steps: setup_followups.open_steps,
  };
  const catalog_health = {
    buy: buyCount,
    quote: quoteCount,
    low_stock: lowStock,
    inactive: inactiveProducts,
  };
  const analytics = {
    views_7d: views7d,
    unique_visitors_7d: uniqueVisitors7d,
    quote_submits_7d: quoteSubmits7d,
    checkout_starts_7d: checkoutStarts7d,
    order_confirms_7d: orderConfirms7d,
    quote_conversion_rate: views7d ? Number((quoteSubmits7d / views7d).toFixed(4)) : 0,
    checkout_conversion_rate: views7d ? Number((checkoutStarts7d / views7d).toFixed(4)) : 0,
  };
  const actions = [
    pendingCompanies ? action(1, 'Approve pending accounts', pendingCompanies, '#companies') : null,
    overdueQuoteFollowups ? action(2, 'Follow up overdue quotes', overdueQuoteFollowups, '#quotes') : null,
    unreadMessages ? action(3, 'Reply to unread buyer messages', unreadMessages, '#messages') : null,
    commerce.fulfillment_queue ? action(4, 'Move paid / NET orders through fulfillment', commerce.fulfillment_queue, '#orders') : null,
    lowStock ? action(5, 'Review low-stock products', lowStock, '#products') : null,
    setup_followups.companies ? action(6, 'Close account setup gaps', setup_followups.companies, '#companies') : null,
  ].filter(Boolean);

  return json(200, {
    revenue,
    orders: { total: recentOrders.length, byStatus },
    companies: { pending: pendingCompanies, approved: approvedCompanies, suspended: suspendedCompanies },
    messages: { unread: unreadMessages },
    setup_followups,
    quotes_due: { overdue: overdueQuoteFollowups },
    quotes: { new: newQuotes, urgent: urgentQuotes },
    catalog: { buy: buyCount, quote: quoteCount },
    inventory: { low_stock: lowStock },
    traffic: { views_7d: views7d },
    commerce: commerce,
    crm: crm,
    accounts: accounts,
    catalog_health: catalog_health,
    analytics: analytics,
    actions: actions,
  });
}
