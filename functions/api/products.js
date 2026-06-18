// GET /api/products - public catalog. Returns active products with mode,
// media fields, and nested variants.
import { adminClient, json } from '../_lib/supabase.js';

const BASE_SELECT = 'sku,name,group_key,hmis,mode,hazmat,taxable,price,currency,sort,product_variants(vsku,label,gallons,price,currency,active,sort)';
const MEDIA_SELECT = 'sku,name,group_key,hmis,mode,hazmat,taxable,price,currency,sort,image_url,photo_alt,product_variants(vsku,label,gallons,price,currency,active,sort)';

function missingMediaColumn(error) {
  return /image_url|photo_alt|schema cache|column/i.test(error?.message || '');
}

export async function onRequestGet({ env }) {
  const sb = adminClient(env);
  const query = (columns) => sb
    .from('products')
    .select(columns)
    .eq('active', true)
    .order('sort', { ascending: true });

  let { data, error } = await query(MEDIA_SELECT);
  if (error && missingMediaColumn(error)) {
    ({ data, error } = await query(BASE_SELECT));
    if (!error) data = (data || []).map((product) => ({ ...product, image_url: null, photo_alt: null }));
  }

  if (error) return json(500, { error: error.message });
  return json(200, { products: data || [] }, {
    'cache-control': 's-maxage=300, stale-while-revalidate=600',
  });
}
