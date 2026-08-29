// GET /api/products - public catalog. Returns active products with mode,
// media fields, tier-effective prices, and nested variants.
import {
  adminClient,
  CommerceContextError,
  json,
  resolveCommerceContext,
  tierPriceMap,
} from '../_lib/supabase.js';
import { productIsPublished } from '../_lib/product-publication.generated.js';

const BASE_SELECT = 'sku,name,group_key,hmis,mode,hazmat,taxable,price,currency,stock,track_stock,sort,product_variants(vsku,label,gallons,price,currency,active,stock,track_stock,allow_backorder,sort,market,package_kind,marketing_name,units_per_case,unit_vsku,intended_active,activation_blocker,requires_quote,pricing_source_version)';
const MEDIA_SELECT = 'sku,name,group_key,hmis,mode,hazmat,taxable,price,currency,stock,track_stock,sort,image_url,photo_alt,gallery,product_variants(vsku,label,gallons,price,currency,active,stock,track_stock,allow_backorder,sort,market,package_kind,marketing_name,units_per_case,unit_vsku,intended_active,activation_blocker,requires_quote,pricing_source_version)';

function missingMediaColumn(error) {
  return /image_url|photo_alt|schema cache|column/i.test(error?.message || '');
}

export function shapePublicProductVariant(variant, overrides = new Map()) {
  const {
    intended_active: intendedActive,
    activation_blocker: activationBlocker,
    ...publicVariant
  } = variant || {};
  const base = publicVariant.price == null ? null : Number(publicVariant.price);
  const effective = overrides.has(publicVariant.vsku) ? overrides.get(publicVariant.vsku) : base;
  const caseContactAvailable = publicVariant.package_kind === 'case'
    && publicVariant.active === false
    && intendedActive === true
    && activationBlocker === 'shipping_package_profile_missing'
    && Number.isFinite(Number(effective))
    && Number(effective) > 0;
  return {
    ...publicVariant,
    list_price: base,
    price: effective,
    case_contact_available: caseContactAvailable,
  };
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
  const products = (data || [])
    .filter((product) => productIsPublished(product.sku))
    .map((product) => ({
      ...product,
      tier,
      product_variants: (product.product_variants || [])
        .map((variant) => shapePublicProductVariant(variant, overrides)),
    }));

  const cache = hasAuth
    ? { 'cache-control': 'private, no-store' }
    : { 'cache-control': 's-maxage=300, stale-while-revalidate=600' };
  return json(200, { products, tier }, cache);
}
