// GET /api/products — public catalog. Returns active products with their mode flag.
// Front-end uses `mode`: 'buy' → cart/checkout UI, 'quote' → existing quote form.
import { adminClient, json } from '../lib/supabase.js';

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
  const sb = adminClient();
  const { data, error } = await sb
    .from('products')
    .select('sku,name,group_key,hmis,mode,hazmat,taxable,price,currency,sort,product_variants(vsku,label,gallons,price,currency,active,sort)')
    .eq('active', true)
    .order('sort', { ascending: true });
  if (error) return json(500, { error: error.message });
  return json(200, { products: data }, { 'cache-control': 's-maxage=300, stale-while-revalidate=600' });
};

export const config = { path: '/api/products' };
