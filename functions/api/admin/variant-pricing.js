// Admin tier-pricing verification matrix.
// GET  /api/admin/variant-pricing → every variant + its price_tiers cells.
// POST is intentionally rejected: the pricing workbook + seed command own writes.
import { requireStaff, adminClient, json } from '../../_lib/supabase.js';
import { staffCanWrite } from '../../_lib/authz.js';

const TIERS = ['retail', 'hvac', 'wholesale'];

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);

  if (request.method === 'GET') {
    const { data: variants, error } = await sb
      .from('product_variants')
      .select('vsku,product_sku,label,price,currency,active,sort,products(name,mode)')
      .order('product_sku', { ascending: true })
      .order('sort', { ascending: true });
    if (error) return json(500, { error: error.message });
    const { data: cells, error: tErr } = await sb.from('price_tiers').select('vsku,tier,price');
    if (tErr) return json(500, { error: tErr.message });

    const byVsku = {};
    for (const c of cells || []) { (byVsku[c.vsku] ||= {})[c.tier] = Number(c.price); }
    const rows = (variants || []).map((v) => ({
      vsku: v.vsku,
      product_sku: v.product_sku,
      product_name: v.products?.name || v.product_sku,
      mode: v.products?.mode || 'quote',
      label: v.label,
      base_price: v.price == null ? null : Number(v.price),
      currency: v.currency || 'usd',
      active: v.active,
      tiers: TIERS.reduce((o, t) => { o[t] = byVsku[v.vsku]?.[t] ?? null; return o; }, {}),
    }));
    return json(200, { tiers: TIERS, rows });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    return json(409, {
      error: 'price_workbook_managed',
      message: 'Prices are managed by VertKleen_Website_Pricing_WebDev.xlsx. Reflect approved workbook changes in the catalog seed data and run npm run seed.',
    });
  }

  return json(405, { error: 'method_not_allowed' });
}
