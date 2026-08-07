// /api/admin/search - one lookup across every entity staff actually search for.
//
// Each workspace already has its own scoped search box, but nothing answered
// "show me everything about Acme HVAC". This fans out across orders, quotes,
// accounts, contacts, and products in parallel and returns a small, grouped,
// route-ready result set.
import { adminClient, json, requireStaff } from '../../_lib/supabase.js';
import { escapeLike } from '../../_lib/crm.js';

const MIN_QUERY = 2;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

const anyOf = (columns, like) => columns.map((column) => `${column}.ilike.${like}`).join(',');

// A failing group must not take the whole result set down: a missing column on
// an un-migrated deployment should cost that one group, not the search box.
async function group(type, label, run) {
  try {
    const items = await run();
    return items.length ? { type, label, items } : null;
  } catch {
    return null;
  }
}

// Order amounts are stored in major units, matching js/util.js money(). Scaling
// by 100 here would render an $84,000 order as $840 in search results.
const money = (total, currency) => {
  const amount = Number(total);
  if (!Number.isFinite(amount)) return '';
  return `${String(currency || 'usd').toUpperCase()} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export async function onRequestGet({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const params = new URL(request.url).searchParams;
  const q = String(params.get('q') || '').trim();
  if (q.length < MIN_QUERY) return json(200, { q, groups: [], total: 0 });

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get('limit')) || DEFAULT_LIMIT));
  const like = `%${escapeLike(q)}%`;
  const sb = adminClient(env);

  const groups = (await Promise.all([
    group('order', 'Orders', async () => {
      const { data } = await sb.from('orders')
        .select('id,order_number,status,total,currency,customer_email,created_at,companies(name)')
        .or(anyOf(['order_number', 'customer_email', 'tracking_number'], like))
        .order('created_at', { ascending: false }).limit(limit);
      return (data || []).map((row) => ({
        id: row.id,
        title: row.order_number || row.id,
        subtitle: [row.companies?.name || row.customer_email, money(row.total, row.currency)].filter(Boolean).join(' · '),
        meta: row.status,
        tab: 'orders',
        // Orders open from the queue's own search box rather than a drawer.
        search: row.order_number || row.id,
      }));
    }),
    group('quote', 'Quotes', async () => {
      const { data } = await sb.from('quotes')
        .select('id,name,email,company,product,status,priority,created_at')
        .or(anyOf(['name', 'email', 'company', 'product', 'location'], like))
        .order('created_at', { ascending: false }).limit(limit);
      return (data || []).map((row) => ({
        id: row.id,
        title: row.company || row.name || `Quote ${row.id}`,
        subtitle: [row.name, row.product].filter(Boolean).join(' · '),
        meta: row.status,
        tab: 'quotes',
        open: row.id,
      }));
    }),
    group('company', 'Accounts', async () => {
      const { data } = await sb.from('companies')
        .select('id,name,status,price_tier,created_at')
        .ilike('name', like)
        .order('created_at', { ascending: false }).limit(limit);
      return (data || []).map((row) => ({
        id: row.id,
        title: row.name,
        subtitle: row.price_tier ? `${row.price_tier} tier` : '',
        meta: row.status,
        tab: 'companies',
        open: row.id,
      }));
    }),
    group('contact', 'People', async () => {
      const { data } = await sb.from('crm_contacts')
        .select('id,name,email,title,company_id')
        .or(anyOf(['name', 'email'], like))
        .limit(limit);
      return (data || []).map((row) => ({
        id: row.id,
        title: row.name || row.email || `Contact ${row.id}`,
        subtitle: [row.title, row.email].filter(Boolean).join(' · '),
        meta: '',
        tab: 'crm',
        open: row.id,
      }));
    }),
    group('product', 'Products', async () => {
      const { data } = await sb.from('products')
        .select('sku,name,mode,active')
        .or(anyOf(['sku', 'name'], like))
        .limit(limit);
      return (data || []).map((row) => ({
        id: row.sku,
        title: row.name || row.sku,
        subtitle: row.sku,
        meta: row.active === false ? 'inactive' : row.mode,
        tab: 'products',
        search: row.sku,
      }));
    }),
  ])).filter(Boolean);

  return json(200, { q, groups, total: groups.reduce((sum, entry) => sum + entry.items.length, 0) });
}
