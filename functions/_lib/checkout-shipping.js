import { normalizeCartQuantities } from './order-shape.js';
import { AddressValidationError, validateGoogleAddress } from './address-validation.js';
import { buildRateRequest, shipStationRequest } from './shipstation.js';
import { packagesFromOrderItems } from './shipstation-orders.js';

const QUOTE_TTL_SECONDS = 15 * 60;
const MAX_CHECKOUT_CARTON_WEIGHT_LB = 50;
const encoder = new TextEncoder();

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

function roundMeasure(value) {
  return Math.round(value * 100) / 100;
}

function packedDimensions(items) {
  let best;
  for (let rowCount = 1; rowCount <= items.length; rowCount += 1) {
    const rows = Array.from({ length: rowCount }, () => ({ length: 0, width: 0 }));
    for (const item of items) {
      const length = Math.max(item.length, item.width);
      const width = Math.min(item.length, item.width);
      const row = rows.reduce((shortest, candidate) => (
        candidate.length < shortest.length ? candidate : shortest
      ));
      row.length += length;
      row.width = Math.max(row.width, width);
    }
    const footprint = {
      length: Math.max(...rows.map((row) => row.length)),
      width: rows.reduce((sum, row) => sum + row.width, 0),
    };
    const candidate = {
      length: Math.max(footprint.length, footprint.width),
      width: Math.min(footprint.length, footprint.width),
      height: Math.max(...items.map((item) => item.height)),
    };
    const lengthAndGirth = candidate.length + 2 * (candidate.width + candidate.height);
    if (!best || lengthAndGirth < best.lengthAndGirth) best = { ...candidate, lengthAndGirth };
  }
  return {
    length: roundMeasure(best.length),
    width: roundMeasure(best.width),
    height: roundMeasure(best.height),
    unit: 'inch',
  };
}

export function combinePackagesForRates(packages, maxWeightLb = MAX_CHECKOUT_CARTON_WEIGHT_LB) {
  const units = packages.map((pkg) => ({
    weight: Number(pkg?.weight?.value ?? pkg?.weight),
    length: Number(pkg?.dimensions?.length ?? pkg?.length),
    width: Number(pkg?.dimensions?.width ?? pkg?.width),
    height: Number(pkg?.dimensions?.height ?? pkg?.height),
  }));
  if (units.some((unit) => ![unit.weight, unit.length, unit.width, unit.height]
    .every((value) => Number.isFinite(value) && value > 0))) {
    throw new CheckoutShippingError('shipping_package_profile_missing', 409);
  }
  units.sort((a, b) => b.weight - a.weight
    || (b.length * b.width * b.height) - (a.length * a.width * a.height));
  const cartons = [];
  for (const unit of units) {
    let carton = cartons.find((candidate) => candidate.weight + unit.weight <= maxWeightLb);
    if (!carton) {
      carton = { weight: 0, items: [] };
      cartons.push(carton);
    }
    carton.weight += unit.weight;
    carton.items.push(unit);
  }
  return cartons.map((carton) => ({
    package_code: 'package',
    weight: { value: roundMeasure(carton.weight), unit: 'pound' },
    dimensions: packedDimensions(carton.items),
  }));
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
  let packages;
  try {
    const units = packagesFromOrderItems(order, variants, { maxPackages: 250 });
    packages = combinePackagesForRates(units);
  } catch (error) {
    if (error?.code === 'too_many_shipping_packages') {
      throw new CheckoutShippingError('shipping_cart_too_large', 409);
    }
    throw new CheckoutShippingError('shipping_package_profile_missing', 409);
  }
  const listCarriers = dependencies.listCarriers
    || ((runtimeEnv) => shipStationRequest(runtimeEnv, '/carriers'));
  const quoteRates = dependencies.quoteRates
    || ((runtimeEnv, payload) => shipStationRequest(runtimeEnv, '/rates', { method: 'POST', body: payload }));
  const carrierPayload = await listCarriers(env);
  const carriers = Array.isArray(carrierPayload?.carriers) ? carrierPayload.carriers : [];
  const carrierIds = [...new Set(carriers.map((carrier) => clean(carrier?.carrier_id, 100)).filter(Boolean))];
  if (!carrierIds.length) throw new CheckoutShippingError('shipping_carriers_unavailable', 503);
  const request = buildRateRequest({
    order,
    packages,
    warehouseId: env.SHIPSTATION_WAREHOUSE_ID,
    carrierIds,
    phone: address.phone,
    residential: address.residential ? 'yes' : 'no',
  });
  const rates = providerRates(await quoteRates(env, request));
  if (!rates.length) throw new CheckoutShippingError('shipping_rates_unavailable', 502);
  const signedRates = await Promise.all(rates.slice(0, 12).map(async (rate) => ({
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
