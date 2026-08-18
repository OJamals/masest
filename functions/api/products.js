// GET /api/products - public catalog. Returns active products with mode,
// media fields, tier-effective prices, and nested variants.
import {
  adminClient,
  CommerceContextError,
  json,
  resolveCommerceContext,
  tierPriceMap,
} from '../_lib/supabase.js';

const BASE_SELECT = 'sku,name,group_key,hmis,mode,hazmat,taxable,price,currency,stock,track_stock,sort,product_variants(vsku,label,gallons,price,currency,active,stock,track_stock,allow_backorder,sort)';
const MEDIA_SELECT = 'sku,name,group_key,hmis,mode,hazmat,taxable,price,currency,stock,track_stock,sort,image_url,photo_alt,gallery,product_variants(vsku,label,gallons,price,currency,active,stock,track_stock,allow_backorder,sort)';

function missingMediaColumn(error) {
  return /image_url|photo_alt|schema cache|column/i.test(error?.message || '');
}

export async function onRequestGet({ request, env }) {
  const sb = adminClient(env);
  const hasAuth = (request.headers.get('authorization') || '').startsWith('Bearer ');
  let tier = 'retail';
  if (hasAuth) {
    try {
      tier = (await resolveCommerceContext(request, env, { adminClient: () => sb })).tier;
    } catch (error) {
      if (error instanceof CommerceContextError || error?.code === 'commerce_context_unavailable') {
        return json(503, { error: 'commerce_context_unavailable', retryable: true });
      }
      return json(503, { error: 'commerce_context_unavailable', retryable: true });
    }
  }
  const query = (columns) => sb
    .from('products')
    .select(columns)
    .eq('active', true)
    .order('sort', { ascending: true });

  let { data, error } = await query(MEDIA_SELECT);
  if (error && missingMediaColumn(error)) {
    ({ data, error } = await query(BASE_SELECT));
    if (!error) data = (data || []).map((product) => ({ ...product, image_url: null, photo_alt: null, gallery: [] }));
  }

  if (error) return json(500, { error: 'server_error' });

  let overrides = new Map();
  if (tier !== 'retail') {
    try {
      overrides = await tierPriceMap(sb, tier);
    } catch {
      return json(503, { error: 'commerce_context_unavailable', retryable: true });
    }
  }
  const products = (data || []).map((product) => ({
    ...product,
    tier,
    product_variants: (product.product_variants || []).map((variant) => {
      const base = variant.price == null ? null : Number(variant.price);
      const effective = overrides.has(variant.vsku) ? overrides.get(variant.vsku) : base;
      return { ...variant, list_price: base, price: effective };
    }),
  }));

  const cache = hasAuth
    ? { 'cache-control': 'private, no-store' }
    : { 'cache-control': 's-maxage=300, stale-while-revalidate=600' };
  return json(200, { products, tier }, cache);
}
