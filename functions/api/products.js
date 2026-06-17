// GET /api/products — public catalog. Returns active products with mode + nested variants.
// Front-end uses `mode`: 'buy' → cart/checkout UI, 'quote' → existing quote form.
import { adminClient, json } from '../_lib/supabase.js';

export async function onRequestGet({ env }) {
  const sb = adminClient(env);
  const { data, error } = await sb
    .from('products')
    .select('sku,name,group_key,hmis,mode,hazmat,taxable,price,currency,sort,product_variants(vsku,label,gallons,price,currency,active,sort)')
    .eq('active', true)
    .order('sort', { ascending: true });
  if (error) return json(500, { error: error.message });
  return json(200, { products: data }, { 'cache-control': 's-maxage=300, stale-while-revalidate=600' });
}
