// POST /api/shipping-estimate - non-binding ZIP-only freight estimate for the cart.
//
// Separate from /api/shipping-rates on purpose. That endpoint validates a full address,
// signs a selection token, and persists the carton plan the buyer is entitled to be charged
// for. This one does none of that: it exists so a buyer can see roughly what shipping costs
// before deciding to fill in an address, and nothing it returns is purchasable.
import { adminClient, json } from '../_lib/supabase.js';
import {
  CheckoutShippingError,
  estimateCheckoutRates,
} from '../_lib/checkout-shipping.js';
import { normalizeCartQuantities } from '../_lib/order-shape.js';
import { clientIp, rateLimit } from '../_lib/ratelimit.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../_lib/request-body.js';

const SHIPPING_ESTIMATE_BODY_MAX_BYTES = 32 * 1024;

async function defaultLoadVariants(env, skus) {
  const { data, error } = await adminClient(env)
    .from('product_variants')
    .select('vsku,product_sku,label,price,currency,active,shipping_weight_lb,shipping_length_in,shipping_width_in,shipping_height_in,products(name,mode,active)')
    .in('vsku', skus);
  if (error) throw error;
  return data || [];
}

export async function handleShippingEstimate({ request, env }, dependencies = {}) {
  const checkRateLimit = dependencies.rateLimit || rateLimit;
  const parseBody = dependencies.readBoundedJson || readBoundedJson;
  const loadVariants = dependencies.loadVariants || defaultLoadVariants;
  const estimateRates = dependencies.estimateCheckoutRates || estimateCheckoutRates;
  // Cheaper than a full quote and typed by hand, so it gets a looser ceiling than
  // shipping-rates — still bounded, since every call reaches the carrier API.
  const rl = await checkRateLimit(env, 'shipping-estimate', clientIp(request), { limit: 20, windowSec: 60 });
  if (!rl.ok) return json(429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfter || 60) });

  let body;
  try {
    body = await parseBody(request, SHIPPING_ESTIMATE_BODY_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return json(413, { error: 'request_too_large' });
    return json(400, { error: 'bad_request' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'bad_request' });
  const qtyBySku = normalizeCartQuantities(body.cart);
  if (!qtyBySku || !Object.keys(qtyBySku).length) return json(400, { error: 'shipping_cart_invalid' });
  const cart = Object.entries(qtyBySku).map(([sku, qty]) => ({ sku, qty }));

  try {
    const variants = await loadVariants(env, Object.keys(qtyBySku));
    const result = await estimateRates({
      env,
      cart,
      destination: body.destination,
      variants,
    });
    return json(200, result);
  } catch (error) {
    if (error instanceof CheckoutShippingError) {
      return json(error.status, { error: error.code, ...error.details });
    }
    return json(502, { error: 'shipping_rates_unavailable' });
  }
}

export function createShippingEstimateHandler(dependencies = {}) {
  return (context) => handleShippingEstimate(context, dependencies);
}

export async function onRequestPost(context) {
  return handleShippingEstimate(context);
}
