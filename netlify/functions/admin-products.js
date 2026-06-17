// /api/admin/products — staff catalog + stock management.
//   GET                      → { products: [...] } (all, incl. inactive)
//   POST { product }         → upsert by sku (price, mode, stock, active, name, flags…)
//   DELETE { sku }           → deactivate (soft). { sku, hard:true } → hard delete (fails if referenced)
import { adminClient, requireStaff, json, readBody } from '../lib/supabase.js';

// Columns staff may set. `sku` is the key. Unknown keys are ignored (cannot inject arbitrary columns).
const WRITABLE = ['name', 'mode', 'price', 'currency', 'hazmat', 'taxable', 'active', 'sort',
  'group_key', 'hmis', 'stripe_price_id', 'stock', 'track_stock'];

export default async (req) => {
  const { user, staff } = await requireStaff(req);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient();

  if (req.method === 'GET') {
    const { data, error } = await sb
      .from('products')
      .select('sku,name,group_key,hmis,mode,hazmat,taxable,price,currency,stock,track_stock,stripe_price_id,active,sort')
      .order('sort', { ascending: true });
    if (error) return json(500, { error: error.message });
    return json(200, { products: data || [] });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const p = body.product || body || {};
    const sku = String(p.sku || '').trim().toLowerCase();
    if (!sku) return json(400, { error: 'sku_required' });

    const row = { sku };
    for (const k of WRITABLE) if (p[k] !== undefined) row[k] = p[k];
    if (row.mode && !['buy', 'quote'].includes(row.mode)) return json(400, { error: 'invalid_mode' });
    if (row.price != null && row.price !== '') {
      const n = Number(row.price);
      if (!Number.isFinite(n) || n < 0) return json(400, { error: 'invalid_price' });
      row.price = n;
    } else if (row.price === '') {
      row.price = null;   // explicit clear → back to unpriced (self-gates the Buy button)
    }

    const { error } = await sb.from('products').upsert(row, { onConflict: 'sku' });
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, sku });
  }

  if (req.method === 'DELETE') {
    const body = await readBody(req);
    const sku = String(body.sku || new URL(req.url).searchParams.get('sku') || '').trim().toLowerCase();
    if (!sku) return json(400, { error: 'sku_required' });

    if (body.hard) {
      const { error } = await sb.from('products').delete().eq('sku', sku);
      if (error) return json(409, { error: 'delete_blocked', detail: error.message,
        hint: 'Product is referenced (e.g. by orders). Deactivate instead.' });
      return json(200, { ok: true, deleted: sku });
    }
    // Soft delete: hide from catalog, keep history intact.
    const { error } = await sb.from('products').update({ active: false }).eq('sku', sku);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, deactivated: sku });
  }

  return json(405, { error: 'method_not_allowed' });
};

export const config = { path: '/api/admin/products' };
