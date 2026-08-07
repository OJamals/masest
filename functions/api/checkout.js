// POST /api/checkout - create a Stripe-hosted Checkout Session for the cart.
// Card/ACH only. NET (on-account) orders are not self-serve: sales raises them from an
// accepted quote via functions/api/admin/quotes.js -> _lib/quote-convert.js netOrderRow().
import Stripe from 'stripe';
import { adminClient, userFromRequest, json, tierForRequest, tierPriceMap } from '../_lib/supabase.js';
import {
  buildStripeCheckoutSessionParams,
  normalizePurchaseOrderNumber,
  parseStripeShippingRateIds,
  shippingRateIdsFromContentEntries,
} from '../_lib/checkout-session.js';
import { ensureCompanyStripeCustomer } from '../_lib/stripe-customer.js';
import { guestStripeCustomer, stripeCustomerAddress } from '../_lib/stripe-customer.js';
import { CheckoutShippingError, verifyShippingSelectionToken } from '../_lib/checkout-shipping.js';
import { clientIp, rateLimit } from '../_lib/ratelimit.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../_lib/request-body.js';
import { normalizeCartQuantities } from '../_lib/order-shape.js';
import { stripeRuntimeError, stripeShippingRatesError } from '../_lib/stripe-runtime.js';

const CHECKOUT_BODY_MAX_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function variantIsStocked(variant, qty) {
  return !(variant.track_stock && variant.stock != null && Number(variant.stock) < qty);
}

export async function handleCheckout({ request, env }, dependencies = {}) {
  const getAdminClient = dependencies.adminClient || adminClient;
  const getUserFromRequest = dependencies.userFromRequest || userFromRequest;
  const getTierForRequest = dependencies.tierForRequest || tierForRequest;
  const getTierPriceMap = dependencies.tierPriceMap || tierPriceMap;
  const getStripeCustomer = dependencies.ensureCompanyStripeCustomer || ensureCompanyStripeCustomer;
  const createGuestCustomer = dependencies.guestStripeCustomer || guestStripeCustomer;
  const checkRateLimit = dependencies.rateLimit || rateLimit;
  const parseBody = dependencies.readBoundedJson || readBoundedJson;
  const createStripe = dependencies.createStripe
    || ((secret) => new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() }));
  const validateShippingRates = dependencies.validateShippingRates || stripeShippingRatesError;
  const verifyShippingSelection = dependencies.verifyShippingSelectionToken || verifyShippingSelectionToken;

  const rl = await checkRateLimit(env, 'checkout', clientIp(request), { limit: 20, windowSec: 60 });
  if (!rl.ok) {
    return json(429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfter || 60) });
  }

  let body;
  try {
    body = await parseBody(request, CHECKOUT_BODY_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json(413, { error: 'request_too_large' });
    }
    return json(400, { error: 'bad_request' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { error: 'bad_request' });
  }

  const purchaseOrder = normalizePurchaseOrderNumber(body.purchase_order_number);
  if (purchaseOrder.error) return json(400, { error: purchaseOrder.error });
  const purchaseOrderNumber = purchaseOrder.value;

  // Card/ACH only. A caller that asks for on-account terms must never be silently
  // downgraded into a card charge, so an unsupported mode is refused outright.
  if (body.mode != null && body.mode !== 'pay') {
    return json(400, {
      error: 'net_checkout_unavailable',
      message: 'Ordering on account is arranged by the MASEST account team. Request a quote to order on NET terms.',
    });
  }
  const qtyBySku = normalizeCartQuantities(body.cart);
  if (!qtyBySku) return json(400, { error: 'bad_request' });
  const skus = Object.keys(qtyBySku);
  if (!skus.length) return json(400, { error: 'cart_empty' });
  let shippingSelection = null;
  if (body.shipping_quote_token) {
    try {
      shippingSelection = await verifyShippingSelection({
        secret: env.SHIPPING_QUOTE_SECRET,
        token: body.shipping_quote_token,
        cart: Object.entries(qtyBySku).map(([sku, qty]) => ({ sku, qty })),
      });
    } catch (error) {
      if (error instanceof CheckoutShippingError) return json(error.status, { error: error.code });
      return json(400, { error: 'shipping_quote_invalid' });
    }
  } else if (env.SHIPPING_QUOTE_SECRET) {
    return json(400, { error: 'shipping_quote_required' });
  }

  const sb = getAdminClient(env);
  const { user } = await getUserFromRequest(request, env);
  let profile = null;
  const quoteId = String(body.quote_id || '');
  const quoteOrderId = String(body.quote_order_id || '');
  const hasQuoteIdentity = Boolean(quoteId || quoteOrderId);
  let quoteContext = null;
  if (hasQuoteIdentity) {
    if (!UUID.test(quoteId) || !UUID.test(quoteOrderId)) {
      return json(400, { error: 'invalid_quote_identity' });
    }
    if (!user) return json(401, { error: 'auth_required_for_quote' });
    const { data, error: profileError } = await sb.from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) return json(500, { error: 'server_error' });
    profile = data || null;
    if (!profile?.company_id) return json(403, { error: 'quote_unavailable' });

    const quoteQuery = sb.from('quotes')
      .select('id,payload,status')
      .eq('id', quoteId)
      .neq('status', 'spam')
      .maybeSingle();
    const orderQuery = sb.from('orders')
      .select('id,company_id,user_id,subtotal,total,currency,order_items(sku,product_sku,name,qty,unit_price,line_total)')
      .eq('id', quoteOrderId)
      .eq('company_id', profile.company_id)
      .eq('user_id', user.id)
      .eq('status', 'cart')
      .is('requisition_name', null)
      .maybeSingle();
    const [
      { data: quote, error: quoteError },
      { data: quoteOrder, error: quoteOrderError },
    ] = await Promise.all([quoteQuery, orderQuery]);
    if (quoteError || quoteOrderError) return json(500, { error: 'server_error' });
    if (!quote || !quoteOrder
      || quote.status === 'closed'
      || quote.payload?.offer_order_id !== quoteOrder.id
      || quote.payload?.requester_id !== user.id
      || quote.payload?.company_id !== profile.company_id
      || quote.payload?.offer_status !== 'accepted') {
      return json(409, { error: 'quote_unavailable' });
    }

    const quotedItemsBySku = new Map();
    for (const item of quoteOrder.order_items || []) {
      if (quotedItemsBySku.has(item.sku)
        || !Number.isFinite(Number(item.unit_price))
        || Number(item.unit_price) < 0) {
        return json(409, { error: 'quote_unavailable' });
      }
      quotedItemsBySku.set(item.sku, item);
    }
    if (quotedItemsBySku.size !== skus.length
      || skus.some((sku) => Number(quotedItemsBySku.get(sku)?.qty) !== qtyBySku[sku])) {
      return json(409, { error: 'quote_cart_changed' });
    }
    quoteContext = {
      quoteId,
      quoteOrderId,
      companyId: profile.company_id,
      currency: String(quoteOrder.currency || 'usd').toLowerCase(),
      quotedItemsBySku,
    };
  }

  const { data: variants, error } = await sb
    .from('product_variants')
    .select('vsku,product_sku,label,price,currency,stripe_price_id,active,stock,track_stock,allow_backorder,products(name,mode,active,taxable)')
    .in('vsku', skus);
  if (error) return json(500, { error: 'server_error' });

  const sellable = [];
  const rejected = [];
  const outOfStock = [];
  // Index variants by vsku once so the per-line lookup below is O(1) (vsku is unique
  // within the .in() result), keeping cart validation linear in line count.
  const variantBySku = new Map((variants ?? []).map((v) => [v.vsku, v]));
  for (const vsku of skus) {
    const v = variantBySku.get(vsku);
    const prod = v?.products;
    if (!v || v.active === false || v.price == null || !Number.isFinite(Number(v.price)) || !prod || prod.active === false || prod.mode !== 'buy') {
      rejected.push(vsku);
      continue;
    }
    // Out of stock blocks checkout unless the variant allows backorder, in which case
    // the line is sold and flagged (stock left untouched, fulfillment ships on restock).
    const inStock = variantIsStocked(v, qtyBySku[vsku]);
    if (!inStock && !v.allow_backorder) {
      outOfStock.push(vsku);
      continue;
    }
    sellable.push({
      sku: v.vsku,
      product_sku: v.product_sku,
      name: `${prod.name} - ${v.label}`,
      price: v.price,
      currency: v.currency || 'usd',
      taxable: prod.taxable,
      stripe_price_id: v.stripe_price_id,
      stock: v.stock,
      track_stock: v.track_stock,
      backordered: !inStock,
    });
  }
  if (rejected.length) {
    return json(409, {
      error: 'not_purchasable',
      skus: rejected,
      message: 'These items need bulk freight review before checkout. Use the quote form.',
    });
  }
  if (outOfStock.length) {
    return json(409, {
      error: 'out_of_stock',
      skus: outOfStock,
      message: 'Some items do not have enough stock. Adjust quantities or request a quote.',
    });
  }

  if (quoteContext) {
    for (const line of sellable) {
      const quoted = quoteContext.quotedItemsBySku.get(line.sku);
      line.price = quoted.unit_price;
      line.product_sku = quoted.product_sku || line.product_sku;
      line.name = quoted.name || line.name;
      line.currency = quoteContext.currency;
      line.stripe_price_id = null;
    }
  } else {
    const { tier } = await getTierForRequest(request, env);
    if (tier !== 'retail') {
      const overrides = await getTierPriceMap(sb, tier);
      for (const line of sellable) {
        if (overrides.has(line.sku)) {
          line.price = overrides.get(line.sku);
          line.stripe_price_id = null;
        }
      }
    }
  }

  // One order = one currency (Stripe forbids mixed-currency sessions, and the subtotal sum
  // would be meaningless). Catalog is USD today; this guards a future non-USD variant.
  const currencies = new Set(sellable.map((p) => (p.currency || 'usd').toLowerCase()));
  if (currencies.size > 1) {
    return json(409, { error: 'mixed_currency', message: 'Items in your cart use different currencies. Order them separately.' });
  }

  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return json(500, { error: 'stripe_not_configured' });
  const appUrl = String(env.APP_URL || '').replace(/\/+$/, '');
  if (!appUrl) return json(500, { error: 'app_url_not_configured' });
  const runtimeError = stripeRuntimeError(env);
  if (runtimeError) return json(503, { error: runtimeError });
  let shippingRateIds = [];
  if (!shippingSelection) {
    shippingRateIds = parseStripeShippingRateIds(env.STRIPE_SHIPPING_RATE_IDS);
    try {
      const { data: entries, error } = await sb.from('content_entries')
        .select('slug,payload')
        .eq('type', 'shipping_rate')
        .eq('status', 'published')
        .eq('locale', 'en')
        .order('slug');
      if (!error && entries?.length) shippingRateIds = shippingRateIdsFromContentEntries(entries);
    } catch {
      // Keep env config as emergency fallback while CMS is unavailable.
    }
    if (!shippingRateIds?.length) return json(503, { error: 'shipping_not_configured' });
    const shippingRateError = await validateShippingRates(env, shippingRateIds);
    if (shippingRateError) return json(503, { error: shippingRateError });
  }
  const stripe = createStripe(secret);

  const taxEnabled = env.STRIPE_TAX_ENABLED === 'true';

  let companyId = null;
  let company = null;
  if (user) {
    if (!profile) {
      const { data } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
      profile = data || null;
    }
    companyId = profile?.company_id || null;
    if (companyId) {
      const { data } = await sb.from('companies')
        .select('id,name,tax_exempt,stripe_customer_id').eq('id', companyId).maybeSingle();
      company = data || null;
    }
  }

  // Bind B2B checkouts to the company's Stripe Customer so tax is computed against it.
  // When tax is live, mark a tax_exempt company's Customer 'exempt' so it isn't charged.
  let customerId = null;
  if (company) {
    try {
      customerId = await getStripeCustomer({
        stripe, sb, company, email: body.email || user?.email,
      });
    } catch {
      return json(502, { error: 'stripe_customer_setup_failed' });
    }
    if (taxEnabled) {
      try {
        await stripe.customers.update(customerId, {
          tax_exempt: company.tax_exempt ? 'exempt' : 'none'
        });
      } catch {
        return json(502, { error: 'stripe_customer_setup_failed' });
      }
    }
    if (shippingSelection) {
      try {
        const shippingAddress = shippingSelection.address;
        const billingAddress = shippingSelection.billing_address || shippingAddress;
        await stripe.customers.update(customerId, {
          name: shippingAddress.company || shippingAddress.name,
          phone: shippingAddress.phone || undefined,
          address: stripeCustomerAddress(billingAddress),
          shipping: {
            name: shippingAddress.name,
            phone: shippingAddress.phone || undefined,
            address: stripeCustomerAddress(shippingAddress),
          },
        });
      } catch {
        return json(502, { error: 'stripe_customer_setup_failed' });
      }
    }
  } else if (shippingSelection) {
    // Guest with a validated address: bind it to a Customer so Stripe sees the addresses
    // the buyer already confirmed. Failure here is not worth losing the sale — fall back
    // to the email-only session, which is exactly the previous behavior.
    try {
      customerId = await createGuestCustomer({
        stripe,
        email: body.email || user?.email || '',
        shippingAddress: shippingSelection.address,
        billingAddress: shippingSelection.billing_address || shippingSelection.address,
        rateId: shippingSelection.rate?.rate_id || null,
      });
    } catch {
      customerId = null;
    }
  }

  try {
    const session = await stripe.checkout.sessions.create(buildStripeCheckoutSessionParams({
      appUrl,
      email: body.email || user?.email || '',
      companyId,
      sellable,
      qtyBySku,
      taxEnabled,
      customerId,
      shippingRateIds,
      shippingSelection,
      purchaseOrderNumber,
      quoteId: quoteContext?.quoteId || null,
      quoteOrderId: quoteContext?.quoteOrderId || null,
      allowPromotionCodes: !quoteContext,
    }), quoteContext ? { idempotencyKey: `quote-checkout:${quoteContext.quoteOrderId}` } : undefined);
    return json(200, { url: session.url });
  } catch (err) {
    return json(502, { error: 'stripe_error', code: err?.code || null });
  }
}

export function createCheckoutHandler(dependencies = {}) {
  return (context) => handleCheckout(context, dependencies);
}

export async function onRequestPost(context) {
  return handleCheckout(context);
}
