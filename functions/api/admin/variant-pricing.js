// Admin tier-pricing matrix.
// GET  /api/admin/variant-pricing → every variant + its price_tiers cells.
// POST /api/admin/variant-pricing { vsku, tier, price } → upsert one cell.
//   price '' or null clears the cell (resolution then falls back to base price).
import { requireStaff, adminClient, json, readBody } from '../../_lib/supabase.js';

const TIERS = ['retail', 'hvac', 'wholesale'];

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
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
    const body = await readBody(request);
    const vsku = String(body.vsku || '').trim().toLowerCase();
    const tier = String(body.tier || '').trim().toLowerCase();
    if (!vsku) return json(400, { error: 'vsku_required' });
    if (!TIERS.includes(tier)) return json(400, { error: 'invalid_tier' });

    if (body.price === '' || body.price == null) {
      const { error } = await sb.from('price_tiers').delete().eq('vsku', vsku).eq('tier', tier);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, vsku, tier, price: null });
    }
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) return json(400, { error: 'invalid_price' });
    const currency = String(body.currency || 'usd').toLowerCase();
    const { error } = await sb.from('price_tiers')
      .upsert({ vsku, tier, price, currency, updated_at: new Date().toISOString() }, { onConflict: 'vsku,tier' });
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, vsku, tier, price });
  }

  return json(405, { error: 'method_not_allowed' });
}
