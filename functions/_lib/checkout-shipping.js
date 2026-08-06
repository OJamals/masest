import { normalizeCartQuantities } from './order-shape.js';
import { AddressValidationError, validateGoogleAddress } from './address-validation.js';
import { buildRateRequest, shipStationRequest } from './shipstation.js';
import { packagesFromOrderItems } from './shipstation-orders.js';
import { adminClient } from './supabase.js';
import { combinePackagesForRates } from './shipping-packages.js';

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

function normalizeRate(rate) {
  const currency = clean(rate?.shipping_amount?.currency || rate?.currency, 8).toLowerCase();
  const amount = Number(rate?.shipping_amount?.amount ?? rate?.amount);
  const amountMinor = Math.round(amount * 100);
  if (!clean(rate?.rate_id, 100) || currency !== 'usd' || !Number.isFinite(amount) || amount < 0) return null;
  return {
    rate_id: clean(rate.rate_id, 100),
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

function providerRates(payload) {
  const source = payload?.rate_response?.rates || payload?.rates || [];
  const rates = (Array.isArray(source) ? source : [])
    .map(normalizeRate)
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

function checkoutOrder({ cart, variants, address, email, now }) {
  const bySku = new Map(variants.map((variant) => [clean(variant?.vsku, 160), variant]));
  const orderItems = [];
  for (const line of cart) {
    const variant = bySku.get(line.sku);
    const product = variant?.products;
    if (!variant || variant.active === false || product?.active === false || product?.mode !== 'buy') {
      throw new CheckoutShippingError('shipping_product_unavailable', 409);
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
    rates: signedRates,
  };
}
