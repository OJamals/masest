import { normalizeCartQuantities } from './order-shape.js';
import { adminClient } from './supabase.js';

const CONTRACT_VERSION = 3;
const encoder = new TextEncoder();

export class CheckoutFulfillmentError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.name = 'CheckoutFulfillmentError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function contractText(value, max = 256) {
  const normalized = String(value ?? '').trim();
  if (normalized.length > max || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new CheckoutFulfillmentError('shipping_quote_invalid');
  }
  return normalized;
}

export function normalizeCheckoutFulfillmentCart(value) {
  const qtyBySku = normalizeCartQuantities(value);
  if (!qtyBySku || !Object.keys(qtyBySku).length) {
    throw new CheckoutFulfillmentError('shipping_cart_invalid');
  }
  return Object.entries(qtyBySku)
    .map(([sku, qty]) => ({ sku, qty }))
    .sort((left, right) => left.sku.localeCompare(right.sku));
}

function base64UrlEncode(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalJson(value)));
  return base64UrlEncode(new Uint8Array(digest));
}

async function hmacKey(secret) {
  const normalized = contractText(secret);
  if (normalized.length < 32) {
    throw new CheckoutFulfillmentError('shipping_quote_not_configured', 503);
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(normalized),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function createShippingSelectionToken({ secret, plan }) {
  const payload = {
    v: CONTRACT_VERSION,
    exp: Math.floor(new Date(plan.expires_at).getTime() / 1000),
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    cart_digest: plan.cart_digest,
    address_digest: plan.address_digest,
    cart: plan.cart,
    address: plan.address,
    billing_address: plan.billing_address,
    billing_same_as_shipping: plan.billing_same_as_shipping,
    rate: plan.rate,
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
    if (payload?.v === 2) {
      throw new CheckoutFulfillmentError('shipping_quote_legacy', 409);
    }
    if (payload?.v !== CONTRACT_VERSION || !payload?.rate || !payload?.address
      || !payload?.billing_address || !Array.isArray(payload?.cart)
      || !payload?.plan_id || !payload?.plan_digest
      || !payload?.cart_digest || !payload?.address_digest) {
      throw new Error('payload');
    }
    if (Number(payload.exp) <= Math.floor(now() / 1000)) {
      throw new CheckoutFulfillmentError('shipping_quote_expired', 409);
    }
    const currentCart = normalizeCheckoutFulfillmentCart(cart);
    if (JSON.stringify(payload.cart) !== JSON.stringify(currentCart)) {
      throw new CheckoutFulfillmentError('shipping_quote_cart_changed', 409);
    }
    if (await sha256(currentCart) !== payload.cart_digest) throw new Error('cart_digest');
    if (await sha256({
      address: payload.address,
      billing_address: payload.billing_address,
      billing_same_as_shipping: payload.billing_same_as_shipping,
    }) !== payload.address_digest) throw new Error('address_digest');
    if (payload.plan_id !== payload.rate.rate_id
      || !Number.isInteger(Number(payload.rate.amount_minor))
      || Number(payload.rate.amount_minor) < 0
      || !/^[a-z]{3}$/.test(String(payload.rate.currency || ''))) {
      throw new Error('rate_binding');
    }
    return payload;
  } catch (error) {
    if (error instanceof CheckoutFulfillmentError) throw error;
    throw new CheckoutFulfillmentError('shipping_quote_invalid');
  }
}

async function checkoutFulfillmentPlan({
  cart,
  address,
  billingAddress,
  billingSameAsShipping,
  packages,
  rate,
  expiresAt,
}) {
  const canonical = normalizeCheckoutFulfillmentCart(cart);
  const planId = rate.rate_id;
  const cartDigest = await sha256(canonical);
  const addressDigest = await sha256({
    address,
    billing_address: billingAddress,
    billing_same_as_shipping: billingSameAsShipping,
  });
  const planDigest = await sha256({
    contract_version: CONTRACT_VERSION,
    plan_id: planId,
    rate_id: rate.rate_id,
    amount_minor: rate.amount_minor,
    currency: rate.currency,
    cart_digest: cartDigest,
    address_digest: addressDigest,
    packages,
    rate,
  });
  return {
    contract_version: CONTRACT_VERSION,
    plan_id: planId,
    plan_digest: planDigest,
    cart_digest: cartDigest,
    address_digest: addressDigest,
    rate_id: rate.rate_id,
    carrier_id: rate.carrier_id || null,
    service_code: rate.service_code || null,
    amount_minor: rate.amount_minor,
    currency: rate.currency,
    cart: canonical,
    address,
    billing_address: billingAddress,
    billing_same_as_shipping: billingSameAsShipping,
    packages,
    rate,
    expires_at: expiresAt,
  };
}

export function assertShippingPlanSelection(selection, result, {
  notFoundStatus = 409,
  cart = null,
} = {}) {
  if (result?.outcome !== 'found' || !result.plan) {
    throw new CheckoutFulfillmentError('shipping_plan_not_found', notFoundStatus);
  }
  const plan = result.plan;
  const matches = selection?.v === CONTRACT_VERSION
    && selection.plan_id === plan.plan_id
    && selection.plan_digest === plan.plan_digest
    && selection.cart_digest === plan.cart_digest
    && selection.address_digest === plan.address_digest
    && selection.rate?.rate_id === plan.rate_id
    && Number(selection.rate?.amount_minor) === Number(plan.amount_minor)
    && String(selection.rate?.currency || '').toLowerCase() === String(plan.currency || '').toLowerCase()
    && String(selection.rate?.carrier_id || '') === String(plan.carrier_id || '')
    && String(selection.rate?.service_code || '') === String(plan.service_code || '');
  if (!matches) throw new CheckoutFulfillmentError('shipping_plan_mismatch', 409);
  if (cart) {
    try {
      if (JSON.stringify(normalizeCheckoutFulfillmentCart(cart))
        !== JSON.stringify(normalizeCheckoutFulfillmentCart(plan.cart))) {
        throw new Error('cart_mismatch');
      }
    } catch {
      throw new CheckoutFulfillmentError('shipping_plan_mismatch', 409);
    }
  }
  return plan;
}

export async function assertCheckoutFulfillmentConfigured(env) {
  await hmacKey(env?.SHIPPING_QUOTE_SECRET);
}

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

export async function loadShippingQuotePlan(env, rateId, dependencies = {}) {
  const id = String(rateId || '').trim();
  if (!id) return { outcome: 'not_found', plan: null };
  const sb = dependencies.sb || adminClient(env);
  try {
    const { data, error } = await sb
      .from('checkout_shipping_quotes')
      .select('contract_version,plan_id,plan_digest,cart_digest,address_digest,rate_id,carrier_id,service_code,amount_minor,currency,cart,address,billing_address,billing_same_as_shipping,packages,rate,expires_at')
      .eq('rate_id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { outcome: 'not_found', plan: null };
    if (Number(data.contract_version) !== CONTRACT_VERSION || data.plan_id !== data.rate_id
      || !Array.isArray(data.packages) || !data.packages.length) {
      throw new CheckoutFulfillmentError('shipping_plan_integrity_failed', 503);
    }
    const expected = await checkoutFulfillmentPlan({
      cart: data.cart,
      address: data.address,
      billingAddress: data.billing_address,
      billingSameAsShipping: data.billing_same_as_shipping !== false,
      packages: data.packages,
      rate: data.rate,
      expiresAt: data.expires_at,
    });
    if (expected.plan_id !== data.plan_id
      || expected.plan_digest !== data.plan_digest
      || expected.cart_digest !== data.cart_digest
      || expected.address_digest !== data.address_digest
      || expected.amount_minor !== data.amount_minor
      || expected.currency !== data.currency) {
      throw new CheckoutFulfillmentError('shipping_plan_integrity_failed', 503);
    }
    return { outcome: 'found', plan: data };
  } catch (error) {
    if (error instanceof CheckoutFulfillmentError) throw error;
    console.error('checkout_shipping_quote_load_failed', error?.code || error?.message || 'unknown');
    throw new CheckoutFulfillmentError('shipping_plan_store_unavailable', 503);
  }
}

export async function issueCheckoutFulfillmentContracts({
  env,
  cart,
  address,
  billingAddress,
  billingSameAsShipping,
  packages,
  rates,
  expiresAt,
}, dependencies = {}) {
  const plans = await Promise.all(rates.map((rate) => checkoutFulfillmentPlan({
    cart,
    address,
    billingAddress,
    billingSameAsShipping,
    packages,
    rate,
    expiresAt,
  })));
  const persistShippingQuotes = dependencies.persistShippingQuotes || defaultPersistShippingQuotes;
  let persistence;
  try {
    persistence = await persistShippingQuotes(env, plans);
  } catch (error) {
    console.error('checkout_shipping_quote_persist_failed', error?.code || error?.message || 'unknown');
    throw new CheckoutFulfillmentError('shipping_plan_store_unavailable', 503);
  }
  const persistedCount = persistence?.count == null ? plans.length : Number(persistence.count);
  if (!persistence?.ok || !Number.isFinite(persistedCount) || persistedCount < plans.length) {
    throw new CheckoutFulfillmentError('shipping_plan_store_unavailable', 503);
  }
  const signedRates = await Promise.all(plans.map(async (plan) => ({
    ...plan.rate,
    token: await createShippingSelectionToken({ secret: env.SHIPPING_QUOTE_SECRET, plan }),
  })));
  return { plans, rates: signedRates };
}

export async function resolveCheckoutFulfillmentSelection({
  env,
  token,
  cart,
  sb,
  now = Date.now,
}, dependencies = {}) {
  const verifySelection = dependencies.verifyShippingSelectionToken || verifyShippingSelectionToken;
  const loadPlan = dependencies.loadShippingQuotePlan || loadShippingQuotePlan;
  const selection = await verifySelection({
    secret: env.SHIPPING_QUOTE_SECRET,
    token,
    cart,
    now,
  });
  const result = await loadPlan(env, selection.plan_id, { sb });
  const plan = assertShippingPlanSelection(selection, result);
  return {
    ...selection,
    cart: plan.cart,
    address: plan.address,
    billing_address: plan.billing_address,
    billing_same_as_shipping: plan.billing_same_as_shipping !== false,
    rate: plan.rate,
  };
}

export function checkoutFulfillmentStripeTransport(selection) {
  const selectedAddress = selection?.address || null;
  const selectedBillingAddress = selection?.billing_address || selectedAddress;
  const selectedRate = selection?.rate || null;
  const shippingOption = selectedRate ? {
    shipping_rate_data: {
      type: 'fixed_amount',
      display_name: [selectedRate.carrier_name, selectedRate.service_type]
        .filter(Boolean).join(' — ') || 'Shipping',
      fixed_amount: {
        amount: Math.max(0, Math.round(Number(selectedRate.amount_minor) || 0)),
        currency: selectedRate.currency || 'usd',
      },
      tax_behavior: 'exclusive',
      ...(Number(selectedRate.delivery_days) > 0 ? {
        delivery_estimate: {
          maximum: { unit: 'business_day', value: Math.ceil(Number(selectedRate.delivery_days)) },
        },
      } : {}),
      metadata: {
        provider: 'shipengine',
        provider_rate_id: selectedRate.rate_id || '',
        carrier_id: selectedRate.carrier_id || '',
        service_code: selectedRate.service_code || '',
      },
    },
  } : null;
  return {
    selectedAddress,
    selectedBillingAddress,
    shippingOption,
    metadata: {
      shipping_rate_id: selectedRate?.rate_id || '',
      shipping_carrier_id: selectedRate?.carrier_id || '',
      shipping_service_code: selectedRate?.service_code || '',
      shipping_contract_version: selection?.v === CONTRACT_VERSION
        ? String(CONTRACT_VERSION)
        : selectedRate ? 'legacy_v2' : 'legacy_static',
      shipping_plan_id: selection?.plan_id || '',
      shipping_plan_digest: selection?.plan_digest || '',
      shipping_cart_digest: selection?.cart_digest || '',
      shipping_address_digest: selection?.address_digest || '',
      shipping_amount_minor: selectedRate
        ? String(Math.max(0, Math.round(Number(selectedRate.amount_minor) || 0)))
        : '',
      shipping_currency: selectedRate?.currency || '',
      ship_name: selectedAddress?.name || '',
      ship_company: selectedAddress?.company || '',
      ship_phone: selectedAddress?.phone || '',
      ship_address1: selectedAddress?.address1 || '',
      ship_address2: selectedAddress?.address2 || '',
      ship_city: selectedAddress?.city || '',
      ship_state: selectedAddress?.state || '',
      ship_postal_code: selectedAddress?.postal_code || '',
      ship_country: selectedAddress?.country || '',
      ship_residential: selectedAddress ? (selectedAddress.residential ? 'yes' : 'no') : '',
      billing_same_as_shipping: selection?.billing_same_as_shipping === false ? 'no' : 'yes',
      bill_address1: selectedBillingAddress?.address1 || '',
      bill_address2: selectedBillingAddress?.address2 || '',
      bill_city: selectedBillingAddress?.city || '',
      bill_state: selectedBillingAddress?.state || '',
      bill_postal_code: selectedBillingAddress?.postal_code || '',
      bill_country: selectedBillingAddress?.country || '',
    },
  };
}

function selectionFromStripeMetadata(metadata = {}) {
  return {
    v: CONTRACT_VERSION,
    plan_id: metadata.shipping_plan_id,
    plan_digest: metadata.shipping_plan_digest,
    cart_digest: metadata.shipping_cart_digest,
    address_digest: metadata.shipping_address_digest,
    rate: {
      rate_id: metadata.shipping_rate_id,
      carrier_id: metadata.shipping_carrier_id,
      service_code: metadata.shipping_service_code,
      amount_minor: Number(metadata.shipping_amount_minor),
      currency: metadata.shipping_currency,
    },
  };
}

function orderShippingAddress(address = {}) {
  return {
    name: address.name || null,
    company: address.company || null,
    phone: address.phone || null,
    address: {
      line1: address.address1 || null,
      line2: address.address2 || null,
      city: address.city || null,
      state: address.state || null,
      postal_code: address.postal_code || null,
      country: address.country || 'US',
    },
    residential: address.residential === true,
  };
}

export function checkoutFulfillmentBuyerEmail({ session, boundBuyerEmail, legacyBuyerEmail }) {
  return checkoutFulfillmentNeedsBoundBuyer(session)
    ? boundBuyerEmail
    : legacyBuyerEmail;
}

export function checkoutFulfillmentNeedsBoundBuyer(session) {
  return String(session?.metadata?.shipping_contract_version || 'legacy_unmarked')
    === String(CONTRACT_VERSION);
}

export async function hydrateCheckoutFulfillmentOrder({
  env,
  session,
  cart,
  order,
  sb,
}, dependencies = {}) {
  const contract = String(session?.metadata?.shipping_contract_version || 'legacy_unmarked');
  if (contract === String(CONTRACT_VERSION)) {
    const selection = selectionFromStripeMetadata(session.metadata);
    const loadPlan = dependencies.loadShippingQuotePlan || loadShippingQuotePlan;
    const result = await loadPlan(env, selection.plan_id, { sb });
    const plan = assertShippingPlanSelection(selection, result, {
      notFoundStatus: 503,
      cart,
    });
    const paidShippingMinor = Number(
      session.shipping_cost?.amount_subtotal ?? session.total_details?.amount_shipping ?? 0,
    );
    if (paidShippingMinor !== Number(plan.amount_minor)) {
      throw new CheckoutFulfillmentError('shipping_plan_mismatch', 503);
    }
    return {
      ...order,
      ship_address: orderShippingAddress(plan.address),
      shipping_package_plan: plan.packages,
      fulfillment_contract_status: 'bound',
      shipstation_error: null,
    };
  }
  if (['legacy_unmarked', 'legacy_v2', 'legacy_static'].includes(contract)) {
    return {
      ...order,
      fulfillment_contract_status: 'legacy_review_required',
      shipstation_error: 'shipping_package_plan_review_required',
    };
  }
  throw new CheckoutFulfillmentError('shipping_contract_unsupported', 503);
}
