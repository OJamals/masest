// GET /api/products — public catalog. Returns active products with mode + nested variants.
// Front-end uses `mode`: 'buy' → cart/checkout UI, 'quote' → existing quote form.
//
// Tier pricing: each variant's `price` is the caller's effective tier price
// (price_tiers[tier] ?? variant base price) and `list_price` is the catalog base.
// Guests/anonymous resolve to 'retail' and stay CDN-cacheable; authenticated
// (tier-specific) responses are private + no-store.
import { adminClient, json, tierForRequest, tierPriceMap } from '../_lib/supabase.js';

export async function onRequestGet({ request, env }) {
  const sb = adminClient(env);
  const { data, error } = await sb
    .from('products')
    .select('sku,name,group_key,hmis,mode,hazmat,taxable,price,currency,stock,track_stock,sort,product_variants(vsku,label,gallons,price,currency,active,stock,track_stock,sort)')
    .eq('active', true)
    .order('sort', { ascending: true });
  if (error) return json(500, { error: error.message });

  const hasAuth = (request.headers.get('authorization') || '').startsWith('Bearer ');
  const tier = hasAuth ? (await tierForRequest(request, env)).tier : 'retail';
  const overrides = await tierPriceMap(sb, tier);

  const products = (data || []).map((p) => ({
    ...p,
    tier,
    product_variants: (p.product_variants || []).map((v) => {
      const base = v.price == null ? null : Number(v.price);
      const eff = overrides.has(v.vsku) ? overrides.get(v.vsku) : base;
      return { ...v, list_price: base, price: eff };
    }),
  }));

  const cache = hasAuth
    ? { 'cache-control': 'private, no-store' }
    : { 'cache-control': 's-maxage=300, stale-while-revalidate=600' };
  return json(200, { products, tier }, cache);
}
