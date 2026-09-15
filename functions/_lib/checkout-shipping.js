import { AddressValidationError, validateGoogleAddress } from './address-validation.js';
import {
  assertCheckoutFulfillmentConfigured,
  CheckoutFulfillmentError,
  issueCheckoutFulfillmentContracts,
  normalizeCheckoutFulfillmentCart,
} from './checkout-fulfillment-contract.js';
import { buildRateRequest, shipStationRequest } from './shipstation.js';
import { packagesFromOrderItems } from './shipstation-orders.js';
import { combinePackagesForRates } from './shipping-packages.js';
import { fulfillmentSummary } from './fulfillment-schedule.js';

const QUOTE_TTL_SECONDS = 15 * 60;

// Re-exported for existing importers (tests + fulfillment) now that the implementation
// is shared with shipstation-orders.js.
export { combinePackagesForRates } from './shipping-packages.js';

function clean(value, max = 160) {
  const normalized = String(value ?? '').trim();
  if (normalized.length > max || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new CheckoutFulfillmentError('shipping_address_invalid');
  }
  return normalized;
}

// Provider labels and ids are untrusted response data. A malformed entry is unusable, but
// must not be reflected as a Buyer address error or take down otherwise valid rates.
function providerText(value, max = 160) {
  const normalized = String(value ?? '').trim();
  return normalized.length <= max && !/[\u0000-\u001F\u007F]/.test(normalized)
    ? normalized
    : '';
}

export function normalizeShippingAddress(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CheckoutFulfillmentError('shipping_address_incomplete');
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
    throw new CheckoutFulfillmentError('shipping_address_incomplete');
  }
  if (address.country !== 'US') throw new CheckoutFulfillmentError('shipping_domestic_only');
  return address;
}

// Online orders ship by ground parcel to street addresses in the 48 contiguous states and
// DC, which is exactly what the published shipping policy promises. Alaska, Hawaii, the
// territories, military mail and PO boxes are quoted instead. Billing addresses are never
// gated: a Honolulu card can pay for a Florida delivery.
const SHIPPABLE_STATES = new Set([
  'AL', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA',
  'WA', 'WV', 'WI', 'WY',
]);

// First three ZIP digits that deliver outside the contiguous states whatever state was typed:
// 006-009 Puerto Rico and the Virgin Islands, 090-098 and 340 and 962-966 military mail,
// 967-968 Hawaii and American Samoa, 969 Guam and the Pacific territories, 995-999 Alaska.
function zipOutsideContiguousStates(postalCode) {
  const prefix = Number(String(postalCode).slice(0, 3));
  return (prefix >= 6 && prefix <= 9)
    || (prefix >= 90 && prefix <= 98)
    || prefix === 340
    || (prefix >= 962 && prefix <= 969)
    || prefix >= 995;
}

// Carriers cannot deliver a parcel to a post office box. Requires a box number so street
// names like "Boxwood Ln" or "Pobox Rd" pass; a private mailbox (PMB) is a street address.
const PO_BOX = /\bp\s*\.?\s*o\s*\.?\s*(?:box|b\b\.?)\s*#?\s*\d|\bpost(?:al)?\s+office\s+box\b|^\s*box\s*#?\s*\d/i;

export function assertShippableAddress(address) {
  if (!SHIPPABLE_STATES.has(address?.state) || zipOutsideContiguousStates(address?.postal_code)) {
    throw new CheckoutFulfillmentError('shipping_region_unsupported', 422);
  }
  if ([address.address1, address.address2].some((line) => PO_BOX.test(String(line || '')))) {
    throw new CheckoutFulfillmentError('shipping_po_box_unsupported', 422);
  }
  return address;
}

// `bookable` rates must carry a provider rate_id — that id is what gets signed into the
// selection token and replayed at label purchase. The estimate endpoint returns no rate_id
// (its results are not addressable), so that path passes bookable:false.
function normalizeRate(rate, { bookable = true } = {}) {
  const currency = providerText(rate?.shipping_amount?.currency || rate?.currency, 8).toLowerCase();
  const amount = Number(rate?.shipping_amount?.amount ?? rate?.amount);
  const amountMinor = Math.round(amount * 100);
  if (currency !== 'usd' || !Number.isFinite(amount) || amount < 0) return null;
  const rateId = providerText(rate?.rate_id, 100);
  if (bookable && !rateId) return null;
  return {
    rate_id: rateId,
    carrier_id: providerText(rate?.carrier_id, 100),
    carrier_name: providerText(rate?.carrier_friendly_name || rate?.carrier_name || rate?.carrier_code, 120),
    service_code: providerText(rate?.service_code, 100),
    service_type: providerText(rate?.service_type || rate?.service_code, 120),
    amount_minor: amountMinor,
    currency,
    delivery_days: Number.isFinite(Number(rate?.delivery_days ?? rate?.carrier_delivery_days))
      ? Number(rate?.delivery_days ?? rate?.carrier_delivery_days)
      : null,
    estimated_delivery_date: providerText(rate?.estimated_delivery_date, 80) || null,
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
      throw new CheckoutFulfillmentError('shipping_product_unavailable', 409, { skus: [line.sku] });
    }
    orderItems.push({
      sku: line.sku,
      product_sku: variant.product_sku,
      name: `${variant.marketing_name || product.name} - ${variant.label}`,
      qty: line.qty,
      unit_price: Number(variant.price) || 0,
    });
  }
  if (orderItems.length !== cart.length) throw new CheckoutFulfillmentError('shipping_product_unavailable', 409);
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
  const postalCode = providerText(address.postal_code, 10);
  const countryCode = providerText(address.country_code || address.country || 'US', 2).toUpperCase();
  if (!/^\d{5}(?:-\d{4})?$/.test(postalCode) || !/^[A-Z]{2}$/.test(countryCode)) {
    throw new CheckoutFulfillmentError('shipping_estimate_origin_unavailable', 503);
  }
  return { postalCode, countryCode };
}

export function normalizeEstimateDestination(value) {
  const postalCode = clean(value?.postal_code, 10);
  const countryCode = clean(value?.country || 'US', 2).toUpperCase();
  if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
    throw new CheckoutFulfillmentError('shipping_estimate_postal_invalid');
  }
  if (countryCode !== 'US') throw new CheckoutFulfillmentError('shipping_domestic_only');
  if (zipOutsideContiguousStates(postalCode)) {
    throw new CheckoutFulfillmentError('shipping_region_unsupported', 422);
  }
  return { postalCode, countryCode, residential: value?.residential === true };
}

export async function estimateCheckoutRates(input, dependencies = {}) {
  const { env = {}, variants = [] } = input || {};
  if (!clean(env.SHIPSTATION_API_KEY, 256) || !clean(env.SHIPSTATION_WAREHOUSE_ID, 100)) {
    throw new CheckoutFulfillmentError('shipping_rates_not_configured', 503);
  }
  const now = dependencies.now || Date.now;
  const cart = normalizeCheckoutFulfillmentCart(input.cart);
  const destination = normalizeEstimateDestination(input.destination);
  // Same availability gate and the same packing the bookable quote runs, so an estimate can
  // never describe a cart checkout would refuse, or parcels it would not build.
  const orderItems = checkoutOrderItems({ cart, variants });
  let packages;
  try {
    packages = combinePackagesForRates(packagesFromOrderItems({ order_items: orderItems }, variants, { maxPackages: 250 }));
  } catch (error) {
    if (error?.code === 'too_many_shipping_packages') {
      throw new CheckoutFulfillmentError('shipping_cart_too_large', 409);
    }
    throw new CheckoutFulfillmentError('shipping_package_profile_missing', 409);
  }
  if (packages.length > ESTIMATE_MAX_PACKAGES) {
    throw new CheckoutFulfillmentError('shipping_estimate_unavailable', 409, { package_count: packages.length });
  }
  const [parcel] = packages;
  const fulfillment = (dependencies.fulfillmentSummary || fulfillmentSummary)(new Date(now()));
  const listCarriers = dependencies.listCarriers
    || ((runtimeEnv) => shipStationRequest(runtimeEnv, '/carriers'));
  const loadWarehouse = dependencies.loadWarehouse
    || ((runtimeEnv) => shipStationRequest(runtimeEnv, `/warehouses/${encodeURIComponent(clean(runtimeEnv.SHIPSTATION_WAREHOUSE_ID, 100))}`));
  const estimateRates = dependencies.estimateRates
    || ((runtimeEnv, payload) => shipStationRequest(runtimeEnv, '/rates/estimate', { method: 'POST', body: payload }));
  let carrierPayload;
  let warehousePayload;
  try {
    [carrierPayload, warehousePayload] = await Promise.all([listCarriers(env), loadWarehouse(env)]);
  } catch (error) {
    if (error?.code === 'shipstation_timeout') throw new CheckoutFulfillmentError('shipping_rates_timeout', 503);
    throw error;
  }
  const carriers = Array.isArray(carrierPayload?.carriers) ? carrierPayload.carriers : [];
  const carrierIds = [...new Set(carriers.map((carrier) => providerText(carrier?.carrier_id, 100)).filter(Boolean))];
  if (!carrierIds.length) throw new CheckoutFulfillmentError('shipping_carriers_unavailable', 503);
  const origin = estimateOrigin(warehousePayload?.warehouse || warehousePayload);
  let ratePayload;
  try {
    ratePayload = await estimateRates(env, {
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
    });
  } catch (error) {
    if (error?.code === 'shipstation_timeout') throw new CheckoutFulfillmentError('shipping_rates_timeout', 503);
    throw error;
  }
  const rates = providerRates(ratePayload, { bookable: false });
  if (!rates.length) throw new CheckoutFulfillmentError('shipping_rates_unavailable', 502);
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
    throw new CheckoutFulfillmentError('shipping_rates_not_configured', 503);
  }
  await assertCheckoutFulfillmentConfigured(env);
  const now = dependencies.now || Date.now;
  const cart = normalizeCheckoutFulfillmentCart(input.cart);
  let validation;
  let billingValidation;
  const billingSameAsShipping = input.billing_same_as_shipping !== false;
  try {
    const validateAddress = dependencies.validateAddress || validateGoogleAddress;
    // Gate the typed address before paying for a lookup, and the corrected one after.
    validation = await validateAddress(assertShippableAddress(normalizeShippingAddress(input.address)), env);
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
      throw new CheckoutFulfillmentError(error.code, error.status, error.details);
    }
    throw error;
  }
  const address = assertShippableAddress(normalizeShippingAddress(validation.address));
  const billingAddress = normalizeShippingAddress(billingValidation.address);
  const order = checkoutOrder({ cart, variants, address, email: input.email, now });
  // The carrier prices transit from the day it collects, so tell it which day that is.
  const fulfillment = (dependencies.fulfillmentSummary || fulfillmentSummary)(new Date(now()));
  const listCarriers = dependencies.listCarriers
    || ((runtimeEnv) => shipStationRequest(runtimeEnv, '/carriers'));
  const quoteRates = dependencies.quoteRates
    || ((runtimeEnv, payload) => shipStationRequest(runtimeEnv, '/rates', { method: 'POST', body: payload }));
  let carrierPayload;
  try {
    carrierPayload = await listCarriers(env);
  } catch (error) {
    if (error?.code === 'shipstation_timeout') throw new CheckoutFulfillmentError('shipping_rates_timeout', 503);
    throw error;
  }
  const carriers = Array.isArray(carrierPayload?.carriers) ? carrierPayload.carriers : [];
  const carrierIds = [...new Set(carriers.map((carrier) => providerText(carrier?.carrier_id, 100)).filter(Boolean))];
  if (!carrierIds.length) throw new CheckoutFulfillmentError('shipping_carriers_unavailable', 503);
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
    if (error instanceof CheckoutFulfillmentError) throw error;
    if (error?.code === 'too_many_shipping_packages') {
      throw new CheckoutFulfillmentError('shipping_cart_too_large', 409);
    }
    throw new CheckoutFulfillmentError('shipping_package_profile_missing', 409);
  }
  let ratePayload;
  try {
    ratePayload = await quoteRates(env, request);
  } catch (error) {
    if (error?.code === 'shipstation_timeout') throw new CheckoutFulfillmentError('shipping_rates_timeout', 503);
    // Google's validator accepts streets USPS CASS cannot standardize: "123 Main St,
    // Brooklyn NY 11201" verdicts ACCEPT and comes back without a ZIP+4, and the carrier
    // is the first party to say otherwise, with a 400 "Address not found". Left bare that
    // escapes as a shipstation_http_400, misses the CheckoutFulfillmentError branch in
    // /api/shipping-rates, and reaches the buyer as a 502 reading "no shipping option is
    // available for this address and cart" -- which says "we do not deliver to you" for
    // what is nearly always a typo in the street.
    if (error?.status === 400 && /address/i.test(error?.detail || '')) {
      throw new CheckoutFulfillmentError('shipping_address_unverified', 422);
    }
    throw error;
  }
  const rates = providerRates(ratePayload);
  if (!rates.length) throw new CheckoutFulfillmentError('shipping_rates_unavailable', 502);
  const offered = rates.slice(0, 12);
  const expiresAt = new Date(now() + QUOTE_TTL_SECONDS * 1000).toISOString();
  // Contract module persists every exact carton plan before any signed token can escape.
  const { rates: signedRates } = await issueCheckoutFulfillmentContracts({
    env,
    cart,
    address,
    billingAddress,
    billingSameAsShipping,
    packages,
    rates: offered,
    expiresAt,
  }, {
    persistShippingQuotes: dependencies.persistShippingQuotes,
  });
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
