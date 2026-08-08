import { normalizeCartQuantities } from './order-shape.js';
import { AddressValidationError, validateGoogleAddress } from './address-validation.js';
import { buildRateRequest, shipStationRequest } from './shipstation.js';
import { packagesFromOrderItems } from './shipstation-orders.js';
import { adminClient } from './supabase.js';
import { combinePackagesForRates } from './shipping-packages.js';
import { fulfillmentSummary } from './fulfillment-schedule.js';

const QUOTE_TTL_SECONDS = 15 * 60;
const encoder = new TextEncoder();

// Re-exported for existing importers (tests + fulfillment) now that the implementation
// is shared with shipstation-orders.js.
export { combinePackagesForRates } from './shipping-packages.js';

export class CheckoutShippingError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.name = 'CheckoutShippingError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function clean(value, max = 160) {
  const normalized = String(value ?? '').trim();
  if (normalized.length > max || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new CheckoutShippingError('shipping_address_invalid');
  }
  return normalized;
}

export function normalizeShippingAddress(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CheckoutShippingError('shipping_address_incomplete');
  }
  const address = {
    name: clean(value.name, 120),
    company: clean(value.company, 120),
    phone: clean(value.phone, 40),
    address1: clean(value.address1, 160),
    address2: clean(value.address2, 160),
    city: clean(value.city, 100),
    state: clean(value.state, 2).toUpperCase(),
    postal_code: clean(value.postal_code, 10),
    country: clean(value.country || 'US', 2).toUpperCase(),
    residential: value.residential === true,
  };
  if (!address.name || !address.phone || !address.address1 || !address.city
    || !/^[A-Z]{2}$/.test(address.state) || !/^\d{5}(?:-\d{4})?$/.test(address.postal_code)) {
    throw new CheckoutShippingError('shipping_address_incomplete');
  }
  if (address.country !== 'US') throw new CheckoutShippingError('shipping_domestic_only');
  return address;
}

function canonicalCart(value) {
  const qtyBySku = normalizeCartQuantities(value);
  if (!qtyBySku || !Object.keys(qtyBySku).length) {
    throw new CheckoutShippingError('shipping_cart_invalid');
  }
  return Object.entries(qtyBySku)
    .map(([sku, qty]) => ({ sku, qty }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

function base64UrlEncode(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret) {
  const normalized = clean(secret, 256);
  if (normalized.length < 32) throw new CheckoutShippingError('shipping_quote_not_configured', 503);
  return crypto.subtle.importKey('raw', encoder.encode(normalized), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function createShippingSelectionToken({ secret, cart, address, billingAddress, billingSameAsShipping, rate, now }) {
  const payload = {
    v: 2,
    exp: Math.floor(now() / 1000) + QUOTE_TTL_SECONDS,
    cart,
    address,
    billing_address: billingAddress,
    billing_same_as_shipping: billingSameAsShipping,
    rate,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(encoded));
  return `${encoded}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyShippingSelectionToken({ secret, token, cart, now = Date.now }) {
  try {
    const [encoded, signature, extra] = String(token || '').split('.');
    if (!encoded || !signature || extra) throw new Error('token_shape');
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      base64UrlDecode(signature),
      encoder.encode(encoded),
    );
    if (!valid) throw new Error('signature');
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
    if (payload?.v !== 2 || !payload?.rate || !payload?.address
      || !payload?.billing_address || !Array.isArray(payload?.cart)) {
      throw new Error('payload');
    }
    if (Number(payload.exp) <= Math.floor(now() / 1000)) {
      throw new CheckoutShippingError('shipping_quote_expired', 409);
    }
    if (JSON.stringify(payload.cart) !== JSON.stringify(canonicalCart(cart))) {
      throw new CheckoutShippingError('shipping_quote_cart_changed', 409);
    }
    return payload;
  } catch (error) {
    if (error instanceof CheckoutShippingError) throw error;
    throw new CheckoutShippingError('shipping_quote_invalid');
  }
}

// `bookable` rates must carry a provider rate_id — that id is what gets signed into the
// selection token and replayed at label purchase. The estimate endpoint returns no rate_id
// (its results are not addressable), so that path passes bookable:false.
function normalizeRate(rate, { bookable = true } = {}) {
  const currency = clean(rate?.shipping_amount?.currency || rate?.currency, 8).toLowerCase();
  const amount = Number(rate?.shipping_amount?.amount ?? rate?.amount);
  const amountMinor = Math.round(amount * 100);
  if (currency !== 'usd' || !Number.isFinite(amount) || amount < 0) return null;
  if (bookable && !clean(rate?.rate_id, 100)) return null;
  return {
    rate_id: clean(rate?.rate_id, 100),
    carrier_id: clean(rate?.carrier_id, 100),
    carrier_name: clean(rate?.carrier_friendly_name || rate?.carrier_name || rate?.carrier_code, 120),
    service_code: clean(rate?.service_code, 100),
    service_type: clean(rate?.service_type || rate?.service_code, 120),
    amount_minor: amountMinor,
    currency,
    delivery_days: Number.isFinite(Number(rate?.delivery_days ?? rate?.carrier_delivery_days))
      ? Number(rate?.delivery_days ?? rate?.carrier_delivery_days)
      : null,
    estimated_delivery_date: clean(rate?.estimated_delivery_date, 80) || null,
  };
}

const INELIGIBLE_CHECKOUT_SERVICE = /(?:media|library)[ _-]?mail/i;

function checkoutEligibleRate(rate) {
  return !INELIGIBLE_CHECKOUT_SERVICE.test(`${rate.service_code} ${rate.service_type}`);
}

// MASEST always ships its own cartons: normalizePackages and combinePackagesForRates both
// hardcode package_code 'package', for rating AND for label purchase. The provider ignores
// that and prices carrier-supplied packaging anyway — a 28.5 lb, 24x12x10 carton comes back
// with a $9.62 USPS flat_rate_envelope as the cheapest option, which is not a parcel that
// can physically hold it. Sorting purely on price then offered the buyer a rate fulfillment
// can never buy, and the difference came out of margin on every order.
//
// A rate is only offerable if it prices the packaging we actually ship. USPS names its
// carrier packaging (flat_rate_*, thick_envelope, ...); UPS and FedEx report null for theirs.
function ownPackagingRate(rate) {
  const packageType = rate?.package_type;
  return packageType == null || String(packageType).toLowerCase() === 'package';
}

function providerRates(payload, options = {}) {
  // /rates answers { rate_response: { rates } }; /rates/estimate answers a bare array.
  const source = Array.isArray(payload)
    ? payload
    : payload?.rate_response?.rates || payload?.rates || [];
  const rates = (Array.isArray(source) ? source : [])
    .filter(ownPackagingRate)
    .map((rate) => normalizeRate(rate, options))
    .filter(Boolean)
    .filter(checkoutEligibleRate)
    .sort((a, b) => a.amount_minor - b.amount_minor
      || (a.delivery_days ?? 999) - (b.delivery_days ?? 999)
      || a.service_type.localeCompare(b.service_type));
  const seen = new Set();
  return rates.filter((rate) => {
    const key = [rate.carrier_name, rate.service_code, rate.service_type, rate.amount_minor,
      rate.delivery_days, rate.estimated_delivery_date].join('|').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Best-effort: the fallback path recomputes cartons with this same module, so a lost row
// costs the exact snapshot, not correctness. Never fail a rate quote on a bookkeeping write.
async function defaultPersistShippingQuotes(env, rows) {
  if (!rows.length) return { ok: false, skipped: 'no_rows' };
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, skipped: 'supabase_not_configured' };
  }
  try {
    const { error } = await adminClient(env)
      .from('checkout_shipping_quotes')
      .upsert(rows, { onConflict: 'rate_id' });
    if (error) {
      console.error('checkout_shipping_quote_persist_failed', error?.code || error?.message || 'unknown');
      return { ok: false, error };
    }
    return { ok: true, count: rows.length };
  } catch (error) {
    console.error('checkout_shipping_quote_persist_failed', error?.message || error);
    return { ok: false, error };
  }
}

// Read back the carton plan the buyer was actually quoted. Called by the Stripe webhook
// with the rate id carried in checkout-session metadata.
export async function loadShippingQuotePlan(env, rateId, dependencies = {}) {
  const id = String(rateId || '').trim();
  if (!id) return null;
  const sb = dependencies.sb || adminClient(env);
  try {
    const { data, error } = await sb
      .from('checkout_shipping_quotes')
      .select('rate_id,carrier_id,service_code,amount_minor,currency,packages,rate')
      .eq('rate_id', id)
      .maybeSingle();
    if (error || !data) return null;
    return Array.isArray(data.packages) && data.packages.length ? data : null;
  } catch {
    return null;
  }
}

// Availability is the same question whether the buyer is buying or only estimating, so both
// paths ask it here. Bulk sizes (55 gal drums, 275 gal totes) are quote-routed by carrying
// active=false, and they also have no shipping dimensions — without this gate the estimate
// path reached the packer first and blamed the missing dimensions, reporting a deliberate
// LTL business rule as if it were a data defect.
function checkoutOrderItems({ cart, variants }) {
  const bySku = new Map(variants.map((variant) => [clean(variant?.vsku, 160), variant]));
  const orderItems = [];
  for (const line of cart) {
    const variant = bySku.get(line.sku);
    const product = variant?.products;
    if (!variant || variant.active === false || product?.active === false || product?.mode !== 'buy') {
      throw new CheckoutShippingError('shipping_product_unavailable', 409, { skus: [line.sku] });
    }
    orderItems.push({
      sku: line.sku,
      product_sku: variant.product_sku,
      name: `${product.name} - ${variant.label}`,
      qty: line.qty,
      unit_price: Number(variant.price) || 0,
    });
  }
  if (orderItems.length !== cart.length) throw new CheckoutShippingError('shipping_product_unavailable', 409);
  return orderItems;
}

function checkoutOrder({ cart, variants, address, email, now }) {
  const orderItems = checkoutOrderItems({ cart, variants });
  return {
    order_number: `checkout-${now()}`,
    currency: 'usd',
    customer_email: clean(email, 254),
    ship_address: {
      name: address.name,
      phone: address.phone,
      address: {
        line1: address.address1,
        line2: address.address2,
        city: address.city,
        state: address.state,
        postal_code: address.postal_code,
        country: address.country,
      },
    },
    order_items: orderItems,
  };
}

// A ZIP-only, non-binding shipping estimate for the cart, so a buyer can see roughly what
// freight costs before committing to a full address form.
//
// Deliberately NOT a quote. It signs no selection token and persists no carton plan, so
// nothing it returns can be presented to /api/checkout as a price to honour —
// quoteCheckoutRates stays the only path that can produce a purchasable rate.
//
// The provider's estimate endpoint does not support multi-package shipments, so this is only
// honest for a cart that consolidates into ONE carton. A multi-carton cart returns
// `estimate_unavailable` rather than a single-parcel number that would understate the real
// cost: carriers price per package and dimensional weight does not sum linearly.
export const ESTIMATE_MAX_PACKAGES = 1;

function estimateOrigin(warehouse) {
  const address = warehouse?.origin_address || warehouse?.address || {};
  const postalCode = clean(address.postal_code, 10);
  const countryCode = clean(address.country_code || address.country || 'US', 2).toUpperCase();
  if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
    throw new CheckoutShippingError('shipping_estimate_origin_unavailable', 503);
  }
  return { postalCode, countryCode };
}

export function normalizeEstimateDestination(value) {
  const postalCode = clean(value?.postal_code, 10);
  const countryCode = clean(value?.country || 'US', 2).toUpperCase();
  if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
    throw new CheckoutShippingError('shipping_estimate_postal_invalid');
  }
  if (countryCode !== 'US') throw new CheckoutShippingError('shipping_domestic_only');
  return { postalCode, countryCode, residential: value?.residential === true };
}

export async function estimateCheckoutRates(input, dependencies = {}) {
  const { env = {}, variants = [] } = input || {};
  if (!clean(env.SHIPSTATION_API_KEY, 256) || !clean(env.SHIPSTATION_WAREHOUSE_ID, 100)) {
    throw new CheckoutShippingError('shipping_rates_not_configured', 503);
  }
  const now = dependencies.now || Date.now;
  const cart = canonicalCart(input.cart);
  const destination = normalizeEstimateDestination(input.destination);
  // Same availability gate and the same packing the bookable quote runs, so an estimate can
  // never describe a cart checkout would refuse, or parcels it would not build.
  const orderItems = checkoutOrderItems({ cart, variants });
  let packages;
  try {
    packages = combinePackagesForRates(packagesFromOrderItems({ order_items: orderItems }, variants, { maxPackages: 250 }));
  } catch (error) {
    if (error?.code === 'too_many_shipping_packages') {
      throw new CheckoutShippingError('shipping_cart_too_large', 409);
    }
    throw new CheckoutShippingError('shipping_package_profile_missing', 409);
  }
  if (packages.length > ESTIMATE_MAX_PACKAGES) {
    throw new CheckoutShippingError('shipping_estimate_unavailable', 409, { package_count: packages.length });
  }
  const [parcel] = packages;
  const fulfillment = (dependencies.fulfillmentSummary || fulfillmentSummary)(new Date(now()));
  const listCarriers = dependencies.listCarriers
    || ((runtimeEnv) => shipStationRequest(runtimeEnv, '/carriers'));
  const loadWarehouse = dependencies.loadWarehouse
    || ((runtimeEnv) => shipStationRequest(runtimeEnv, `/warehouses/${encodeURIComponent(clean(runtimeEnv.SHIPSTATION_WAREHOUSE_ID, 100))}`));
  const estimateRates = dependencies.estimateRates
    || ((runtimeEnv, payload) => shipStationRequest(runtimeEnv, '/rates/estimate', { method: 'POST', body: payload }));
  const [carrierPayload, warehousePayload] = await Promise.all([listCarriers(env), loadWarehouse(env)]);
  const carriers = Array.isArray(carrierPayload?.carriers) ? carrierPayload.carriers : [];
  const carrierIds = [...new Set(carriers.map((carrier) => clean(carrier?.carrier_id, 100)).filter(Boolean))];
  if (!carrierIds.length) throw new CheckoutShippingError('shipping_carriers_unavailable', 503);
  const origin = estimateOrigin(warehousePayload?.warehouse || warehousePayload);
  const rates = providerRates(await estimateRates(env, {
    carrier_ids: carrierIds,
    from_country_code: origin.countryCode,
    from_postal_code: origin.postalCode,
    to_country_code: destination.countryCode,
    to_postal_code: destination.postalCode,
    weight: parcel.weight,
    ...(parcel.dimensions ? { dimensions: parcel.dimensions } : {}),
    confirmation: 'none',
    address_residential_indicator: destination.residential ? 'yes' : 'unknown',
    ...(/^\d{4}-\d{2}-\d{2}$/.test(clean(fulfillment.ship_date, 10)) ? { ship_date: fulfillment.ship_date } : {}),
  }), { bookable: false });
  if (!rates.length) throw new CheckoutShippingError('shipping_rates_unavailable', 502);
  // Drop the (empty) rate_id key entirely: an estimate must not look addressable downstream.
  const offered = rates.slice(0, 6).map(({ rate_id: _rateId, ...rate }) => rate);
  return {
    estimate: true,
    postal_code: destination.postalCode,
    package_count: packages.length,
    fulfillment,
    rates: offered,
  };
}

export async function quoteCheckoutRates(input, dependencies = {}) {
  const { env = {}, variants = [] } = input || {};
  if (!clean(env.SHIPSTATION_API_KEY, 256) || !clean(env.SHIPSTATION_WAREHOUSE_ID, 100)) {
    throw new CheckoutShippingError('shipping_rates_not_configured', 503);
  }
  await hmacKey(env.SHIPPING_QUOTE_SECRET);
  const now = dependencies.now || Date.now;
  const cart = canonicalCart(input.cart);
  let validation;
  let billingValidation;
  const billingSameAsShipping = input.billing_same_as_shipping !== false;
  try {
    const validateAddress = dependencies.validateAddress || validateGoogleAddress;
    validation = await validateAddress(normalizeShippingAddress(input.address), env);
    if (billingSameAsShipping) {
      billingValidation = validation;
    } else {
      const billingInput = {
        ...input.billing_address,
        name: input.billing_address?.name || input.address?.name,
        company: input.billing_address?.company || input.address?.company,
        phone: input.billing_address?.phone || input.address?.phone,
      };
      billingValidation = await validateAddress(normalizeShippingAddress(billingInput), env);
    }
  } catch (error) {
    if (error instanceof AddressValidationError) {
      throw new CheckoutShippingError(error.code, error.status, error.details);
    }
    throw error;
  }
  const address = normalizeShippingAddress(validation.address);
  const billingAddress = normalizeShippingAddress(billingValidation.address);
  const order = checkoutOrder({ cart, variants, address, email: input.email, now });
  // The carrier prices transit from the day it collects, so tell it which day that is.
  const fulfillment = (dependencies.fulfillmentSummary || fulfillmentSummary)(new Date(now()));
  const listCarriers = dependencies.listCarriers
    || ((runtimeEnv) => shipStationRequest(runtimeEnv, '/carriers'));
  const quoteRates = dependencies.quoteRates
    || ((runtimeEnv, payload) => shipStationRequest(runtimeEnv, '/rates', { method: 'POST', body: payload }));
  const carrierPayload = await listCarriers(env);
  const carriers = Array.isArray(carrierPayload?.carriers) ? carrierPayload.carriers : [];
  const carrierIds = [...new Set(carriers.map((carrier) => clean(carrier?.carrier_id, 100)).filter(Boolean))];
  if (!carrierIds.length) throw new CheckoutShippingError('shipping_carriers_unavailable', 503);
  // buildRateRequest re-validates the carton list and enforces the provider's 20-package
  // ceiling, so it has to sit inside the same mapping as the packing step — otherwise a
  // heavy-but-valid cart escapes as a bare ShipStationError and surfaces as a misleading
  // 502 "no carrier rate available" instead of 409 shipping_cart_too_large.
  let packages;
  let request;
  try {
    const units = packagesFromOrderItems(order, variants, { maxPackages: 250 });
    packages = combinePackagesForRates(units);
    request = buildRateRequest({
      order,
      packages,
      warehouseId: env.SHIPSTATION_WAREHOUSE_ID,
      carrierIds,
      phone: address.phone,
      residential: address.residential ? 'yes' : 'no',
      shipDate: fulfillment.ship_date,
    });
  } catch (error) {
    if (error instanceof CheckoutShippingError) throw error;
    if (error?.code === 'too_many_shipping_packages') {
      throw new CheckoutShippingError('shipping_cart_too_large', 409);
    }
    throw new CheckoutShippingError('shipping_package_profile_missing', 409);
  }
  const rates = providerRates(await quoteRates(env, request));
  if (!rates.length) throw new CheckoutShippingError('shipping_rates_unavailable', 502);
  const offered = rates.slice(0, 12);
  const signedRates = await Promise.all(offered.map(async (rate) => ({
    ...rate,
    token: await createShippingSelectionToken({
      secret: env.SHIPPING_QUOTE_SECRET,
      cart,
      address,
      billingAddress,
      billingSameAsShipping,
      rate,
      now,
    }),
  })));
  // Persist the exact carton plan behind every offered rate. The buyer leaves for Stripe
  // and comes back as a webhook; without this the fulfillment side has to re-guess the
  // packing and can buy a shipment that differs from the one the buyer paid for.
  const persistQuotes = dependencies.persistShippingQuotes || defaultPersistShippingQuotes;
  await persistQuotes(env, offered.map((rate) => ({
    rate_id: rate.rate_id,
    carrier_id: rate.carrier_id || null,
    service_code: rate.service_code || null,
    amount_minor: rate.amount_minor,
    currency: rate.currency,
    cart,
    address,
    billing_address: billingAddress,
    packages,
    rate,
    expires_at: new Date(now() + QUOTE_TTL_SECONDS * 1000).toISOString(),
  })));
  return {
    address,
    billing_address: billingAddress,
    billing_same_as_shipping: billingSameAsShipping,
    address_validation: {
      corrected: validation.corrected === true,
      formatted_address: validation.formatted_address || null,
      possible_next_action: validation.possible_next_action || 'ACCEPT',
    },
    package_count: packages.length,
    // The browser renders its "dates include handling" note from this, so the explanation
    // and the dates can never describe different policies.
    fulfillment,
    rates: signedRates,
  };
}
