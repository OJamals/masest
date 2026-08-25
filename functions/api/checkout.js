// POST /api/checkout - create a Stripe-hosted Checkout Session for the cart.
// Card/ACH only. NET (on-account) orders are not self-serve: sales raises them from an
// accepted quote via functions/api/admin/quotes.js -> _lib/quote-convert.js netOrderRow().
import Stripe from 'stripe';
import {
  adminClient,
  CommerceContextError,
  json,
  resolveCommerceContext,
  tierPriceMap,
} from '../_lib/supabase.js';
import {
  buildStripeCheckoutSessionParams,
  normalizeCheckoutBuyerEmail,
  normalizePurchaseOrderNumber,
  parseStripeShippingRateIds,
  shippingRateIdsFromContentEntries,
} from '../_lib/checkout-session.js';
import { ensureCompanyStripeCustomer } from '../_lib/stripe-customer.js';
import { guestStripeCustomer, stripeCustomerAddress } from '../_lib/stripe-customer.js';
import {
  CheckoutFulfillmentError,
  resolveCheckoutFulfillmentSelection,
} from '../_lib/checkout-fulfillment-contract.js';
import { clientIp, rateLimit } from '../_lib/ratelimit.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../_lib/request-body.js';
import { normalizeCartQuantities } from '../_lib/order-shape.js';
import { storefrontPromotionCodesReady } from '../_lib/coupons.js';
import { stripeRuntimeError, stripeShippingRatesError } from '../_lib/stripe-runtime.js';
import { expireQuoteOfferIfDue } from '../_lib/quote-offer.js';
import { quoteBuyerActions, quoteBuyerOwns } from '../_lib/quote-lifecycle.js';
import {
  createSupabaseQuoteCheckoutAttemptStore,
  openQuoteCheckoutSession,
  QuoteCheckoutAttemptError,
} from '../_lib/quote-checkout-attempt.js';
import {
  attachCompanyStoreCreditReservation,
  normalizeStoreCreditIntentId,
  reserveCompanyStoreCredit,
  storeCreditCheckoutIdempotencyKey,
} from '../_lib/store-credit.js';

const CHECKOUT_BODY_MAX_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Stripe rejects expires_at values less than 30 minutes in the future. Keep a one-minute
// transport margin so a Quote that passed local validation cannot cross that boundary
// while customer/shipping setup and the provider request are still in flight.
const STRIPE_MIN_CHECKOUT_WINDOW_MS = 31 * 60 * 1000;
const STRIPE_MAX_CHECKOUT_WINDOW_MS = 24 * 60 * 60 * 1000;
const STORE_CREDIT_CHECKOUT_WINDOW_MS = 35 * 60 * 1000;
const STOREFRONT_PROMOTION_PERCENT = 5;

function quoteOrderCheckoutSnapshot(order) {
  return {
    id: String(order.id),
    company_id: String(order.company_id),
    user_id: String(order.user_id),
    status: 'cart',
    requisition_name: null,
    subtotal: Number(order.subtotal),
    total: Number(order.total),
    currency: String(order.currency || 'usd').toLowerCase(),
    items: [...(order.order_items || [])]
      .map((item) => ({
        sku: String(item.sku),
        product_sku: item.product_sku == null ? null : String(item.product_sku),
        name: String(item.name),
        qty: Number(item.qty),
        unit_price: Number(item.unit_price),
        line_total: Number(item.line_total),
      }))
      .sort((left, right) => left.sku.localeCompare(right.sku)),
  };
}

function variantIsStocked(variant, qty) {
  return !(variant.track_stock && variant.stock != null && Number(variant.stock) < qty);
}

export function checkoutPriceFloorViolations(lines = []) {
  return lines
    .filter((line) => line.minimum_checkout_price != null
      && Number(line.price) < Number(line.minimum_checkout_price))
    .map((line) => line.sku);
}

export function storefrontPromotionFloorSafe(lines = []) {
  return lines.every((line) => {
    if (line.minimum_checkout_price == null) return true;
    const discountedMinor = Math.round(
      Math.round(Number(line.price) * 100) * (1 - STOREFRONT_PROMOTION_PERCENT / 100),
    );
    return discountedMinor >= Math.round(Number(line.minimum_checkout_price) * 100);
  });
}

export async function handleCheckout({ request, env }, dependencies = {}) {
  const getAdminClient = dependencies.adminClient || adminClient;
  const getTierPriceMap = dependencies.tierPriceMap || tierPriceMap;
  const getCommerceContext = dependencies.resolveCommerceContext
    || ((runtimeRequest, runtimeEnv) => resolveCommerceContext(runtimeRequest, runtimeEnv, {
      adminClient: getAdminClient,
      userFromRequest: dependencies.userFromRequest,
    }));
  const getStripeCustomer = dependencies.ensureCompanyStripeCustomer || ensureCompanyStripeCustomer;
  const createGuestCustomer = dependencies.guestStripeCustomer || guestStripeCustomer;
  const checkRateLimit = dependencies.rateLimit || rateLimit;
  const parseBody = dependencies.readBoundedJson || readBoundedJson;
  const createStripe = dependencies.createStripe
    || ((secret) => new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() }));
  const validateShippingRates = dependencies.validateShippingRates || stripeShippingRatesError;
  const resolveShippingSelection = dependencies.resolveCheckoutFulfillmentSelection
    || resolveCheckoutFulfillmentSelection;
  const clock = dependencies.now || (() => new Date());
  const openQuotedSession = dependencies.openQuoteCheckoutSession || openQuoteCheckoutSession;
  const reserveStoreCredit = dependencies.reserveCompanyStoreCredit || reserveCompanyStoreCredit;
  const attachStoreCredit = dependencies.attachCompanyStoreCreditReservation
    || attachCompanyStoreCreditReservation;
  const promotionsReady = dependencies.storefrontPromotionCodesReady
    || storefrontPromotionCodesReady;

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
  if (body.apply_store_credit != null && typeof body.apply_store_credit !== 'boolean') {
    return json(400, { error: 'invalid_store_credit_request' });
  }
  const applyStoreCredit = body.apply_store_credit === true;
  const checkoutIntentId = applyStoreCredit
    ? normalizeStoreCreditIntentId(body.checkout_intent_id)
    : '';
  if (applyStoreCredit && !checkoutIntentId) {
    return json(400, { error: 'invalid_checkout_intent_id' });
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
  if (!body.shipping_quote_token && env.SHIPPING_QUOTE_SECRET) {
    return json(400, { error: 'shipping_quote_required' });
  }
  if (body.shipping_quote_token) {
    try {
      // Verify untrusted token bytes before unrelated account/database reads. Resolver then
      // creates its own service client only after signature, expiry, and cart binding pass.
      shippingSelection = await resolveShippingSelection({
        env,
        token: body.shipping_quote_token,
        cart: Object.entries(qtyBySku).map(([sku, qty]) => ({ sku, qty })),
      });
    } catch (error) {
      if (error instanceof CheckoutFulfillmentError) {
        return json(error.status, { error: error.code, retryable: error.status >= 500 });
      }
      return json(503, { error: 'shipping_plan_store_unavailable', retryable: true });
    }
  }

  let commerce;
  try {
    commerce = await getCommerceContext(request, env);
  } catch (error) {
    if (error instanceof CommerceContextError || error?.code === 'commerce_context_unavailable') {
      return json(503, { error: 'commerce_context_unavailable', retryable: true });
    }
    return json(503, { error: 'commerce_context_unavailable', retryable: true });
  }
  const { sb, user, profile, company, companyId, tier, taxExempt } = commerce;
  const buyerEmail = normalizeCheckoutBuyerEmail(body.email || user?.email);
  if (buyerEmail.error) return json(400, { error: buyerEmail.error });

  const quoteId = String(body.quote_id || '');
  const quoteOrderId = String(body.quote_order_id || '');
  const hasQuoteIdentity = Boolean(quoteId || quoteOrderId);
  let quoteContext = null;
  if (hasQuoteIdentity) {
    if (!UUID.test(quoteId) || !UUID.test(quoteOrderId)) {
      return json(400, { error: 'invalid_quote_identity' });
    }
    if (!user) return json(401, { error: 'auth_required_for_quote' });
    if (!companyId) return json(403, { error: 'quote_unavailable' });

    const quoteQuery = sb.from('quotes')
      .select('id,source,payload,status,pipeline_stage,offer_revision,checkout_mutation_id')
      .eq('id', quoteId)
      .neq('status', 'spam')
      .maybeSingle();
    const orderQuery = sb.from('orders')
      .select('id,company_id,user_id,status,requisition_name,subtotal,total,currency,order_items(sku,product_sku,name,qty,unit_price,line_total)')
      .eq('id', quoteOrderId)
      .eq('company_id', companyId)
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
      || !quoteBuyerOwns(quote, { userId: user.id, companyId })
      || quote.payload?.offer_order_id !== quoteOrder.id) {
      return json(409, { error: 'quote_unavailable' });
    }
    const checkoutAt = clock().toISOString();
    const expiry = await expireQuoteOfferIfDue(sb, quote, { at: checkoutAt });
    if (expiry.error) return json(500, { error: 'server_error' });
    const currentQuote = expiry.quote;
    const actions = quoteBuyerActions(currentQuote, {
      userId: user.id,
      companyId,
      hasOffer: Boolean(quoteOrder.order_items?.length),
      now: Date.parse(checkoutAt),
    });
    if (!actions.can_checkout) return json(409, { error: 'quote_unavailable' });
    const offerRevision = Number(currentQuote.offer_revision);
    if (!Number.isSafeInteger(offerRevision) || offerRevision < 1
      || currentQuote.checkout_mutation_id) {
      return json(409, { error: 'quote_unavailable' });
    }
    const offerExpiresAt = String(currentQuote.payload?.offer_expires_at || '');
    const offerExpiryMs = Date.parse(offerExpiresAt);
    if (!Number.isFinite(offerExpiryMs)
      || offerExpiryMs - Date.parse(checkoutAt) < STRIPE_MIN_CHECKOUT_WINDOW_MS) {
      return json(409, {
        error: 'quote_checkout_window_too_short',
        message: 'This offer expires too soon to open a secure payment session. Ask your account team for a revision.',
      });
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
      companyId,
      requesterId: user.id,
      offerExpiresAt,
      offerRevision,
      orderSnapshot: quoteOrderCheckoutSnapshot(quoteOrder),
      currency: String(quoteOrder.currency || 'usd').toLowerCase(),
      quotedItemsBySku,
    };
  }
  if (applyStoreCredit && quoteContext) {
    return json(409, {
      error: 'store_credit_unavailable_for_quote',
      message: 'Accepted quote pricing cannot be combined with account credit.',
    });
  }
  if (applyStoreCredit && (!user || !companyId || company?.status !== 'approved')) {
    return json(403, { error: 'store_credit_account_required' });
  }

  const { data: variants, error } = await sb
    .from('product_variants')
    .select('vsku,product_sku,label,price,currency,stripe_price_id,active,stock,track_stock,allow_backorder,market,package_kind,marketing_name,minimum_checkout_price,products(name,mode,active,taxable)')
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
      name: `${v.marketing_name || prod.name} - ${v.label}`,
      price: v.price,
      market: v.market || 'industrial',
      package_kind: v.package_kind || 'unit',
      minimum_checkout_price: v.minimum_checkout_price == null
        ? null
        : Number(v.minimum_checkout_price),
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
    if (tier !== 'retail') {
      let overrides;
      try {
        overrides = await getTierPriceMap(sb, tier);
      } catch (error) {
        if (error instanceof CommerceContextError || error?.code === 'commerce_context_unavailable') {
          return json(503, { error: 'commerce_context_unavailable', retryable: true });
        }
        return json(503, { error: 'commerce_context_unavailable', retryable: true });
      }
      for (const line of sellable) {
        if (overrides.has(line.sku)) {
          line.price = overrides.get(line.sku);
          line.stripe_price_id = null;
        }
      }
    }
  }

  if (!quoteContext) {
    const floorViolations = checkoutPriceFloorViolations(sellable);
    if (floorViolations.length) {
      return json(409, {
        error: 'checkout_price_below_floor',
        skus: floorViolations,
        message: 'A catalog price is below its approved checkout floor. Request pricing instead.',
      });
    }
  }

  // One order = one currency (Stripe forbids mixed-currency sessions, and the subtotal sum
  // would be meaningless). Catalog is USD today; this guards a future non-USD variant.
  const currencies = new Set(sellable.map((p) => (p.currency || 'usd').toLowerCase()));
  const [orderCurrency] = currencies;
  if (currencies.size > 1
    || (shippingSelection
      && String(shippingSelection.rate?.currency || '').toLowerCase() !== orderCurrency)) {
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

  // Bind B2B checkouts to the company's Stripe Customer so tax is computed against it.
  // When tax is live, mark a tax_exempt company's Customer 'exempt' so it isn't charged.
  let customerId = null;
  if (company) {
    try {
      customerId = await getStripeCustomer({
        stripe, sb, company, email: buyerEmail.value,
      });
    } catch {
      return json(502, { error: 'stripe_customer_setup_failed' });
    }
    if (taxEnabled) {
      try {
        await stripe.customers.update(customerId, {
          tax_exempt: taxExempt ? 'exempt' : 'none'
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
        email: buyerEmail.value,
        shippingAddress: shippingSelection.address,
        billingAddress: shippingSelection.billing_address || shippingSelection.address,
        rateId: shippingSelection.rate?.rate_id || null,
      });
    } catch {
      customerId = null;
    }
  }

  let storeCredit = null;
  let storeCreditExpiresAt = null;
  if (applyStoreCredit) {
    if (orderCurrency !== 'usd') {
      return json(409, { error: 'store_credit_currency_unsupported' });
    }
    const merchandiseSubtotalMinor = sellable.reduce(
      (sum, line) => sum + (Math.round(Number(line.price) * 100) * qtyBySku[line.sku]),
      0,
    );
    if (!Number.isSafeInteger(merchandiseSubtotalMinor) || merchandiseSubtotalMinor <= 0) {
      return json(409, { error: 'store_credit_unavailable' });
    }
    storeCreditExpiresAt = new Date(clock().getTime() + STORE_CREDIT_CHECKOUT_WINDOW_MS);
    try {
      const reservation = await reserveStoreCredit(sb, {
        companyId,
        userId: user.id,
        intentId: checkoutIntentId,
        maxAmountMinor: merchandiseSubtotalMinor,
        expiresAt: storeCreditExpiresAt.toISOString(),
        currency: orderCurrency,
      });
      const amountMinor = Number(reservation?.amount_minor);
      if (!reservation?.id || !Number.isSafeInteger(amountMinor)
        || amountMinor <= 0 || amountMinor > merchandiseSubtotalMinor) {
        return json(503, { error: 'store_credit_reservation_failed', retryable: true });
      }
      storeCredit = { reservationId: reservation.id, amountMinor };
    } catch (error) {
      if (error?.code === 'store_credit_insufficient') {
        return json(409, { error: 'store_credit_unavailable' });
      }
      if (['store_credit_request_identity_collision', 'store_credit_reservation_conflict'].includes(error?.code)) {
        return json(409, { error: error.code });
      }
      if (error?.code === 'store_credit_reservation_expired') {
        return json(409, { error: error.code });
      }
      return json(503, { error: 'store_credit_reservation_failed', retryable: true });
    }
  }

  let allowPromotionCodes = false;
  if (!quoteContext && tier === 'retail' && storefrontPromotionFloorSafe(sellable)) {
    allowPromotionCodes = await promotionsReady(stripe);
  }

  const sessionParams = buildStripeCheckoutSessionParams({
    appUrl,
    email: buyerEmail.value,
    companyId,
    buyerUserId: commerce.userId,
    sellable,
    qtyBySku,
    taxEnabled,
    customerId,
    shippingRateIds,
    shippingSelection,
    purchaseOrderNumber,
    quoteId: quoteContext?.quoteId || null,
    quoteOrderId: quoteContext?.quoteOrderId || null,
    allowPromotionCodes,
    storeCredit,
  });
  if (storeCredit) {
    sessionParams.expires_at = Math.floor(storeCreditExpiresAt.getTime() / 1000);
  }

  if (quoteContext) {
    const offerExpiryMs = Date.parse(quoteContext.offerExpiresAt);
    const remainingMs = offerExpiryMs - clock().getTime();
    const providerParams = { ...sessionParams };
    // Stripe permits an explicit Checkout Session expiry only within its 30-minute to
    // 24-hour window. A nearer Quote fails closed above; a farther Quote uses Stripe's
    // earlier default expiry and can safely claim another attempt afterward.
    if (remainingMs <= STRIPE_MAX_CHECKOUT_WINDOW_MS) {
      providerParams.expires_at = Math.floor(offerExpiryMs / 1000);
    }
    try {
      const opened = await openQuotedSession({
        stripe,
        store: dependencies.quoteCheckoutAttemptStore
          || createSupabaseQuoteCheckoutAttemptStore(sb),
        identity: {
          quoteId: quoteContext.quoteId,
          quoteOrderId: quoteContext.quoteOrderId,
          requesterId: quoteContext.requesterId,
          companyId: quoteContext.companyId,
          offerRevision: quoteContext.offerRevision,
          orderSnapshot: quoteContext.orderSnapshot,
        },
        requestParams: providerParams,
        // Provider expiry placement can change as the offer moves inside Stripe's
        // 24-hour window; it is not a Buyer input and must not rotate an identical retry.
        fingerprintValue: {
          params: sessionParams,
          offer_expires_at: quoteContext.offerExpiresAt,
        },
        ...(dependencies.randomUUID ? { attemptIdFactory: dependencies.randomUUID } : {}),
      });
      return json(200, { url: opened.url, quote_checkout_attempt_id: opened.attemptId });
    } catch (error) {
      if (error instanceof QuoteCheckoutAttemptError) {
        return json(error.status, {
          error: error.code,
          ...(error.retryable ? { retryable: true } : {}),
          ...(error.providerCode ? { code: error.providerCode } : {}),
        });
      }
      return json(503, { error: 'quote_checkout_attempt_unavailable', retryable: true });
    }
  }

  try {
    const session = storeCredit
      ? await stripe.checkout.sessions.create(sessionParams, {
          idempotencyKey: storeCreditCheckoutIdempotencyKey(storeCredit.reservationId),
        })
      : await stripe.checkout.sessions.create(sessionParams);
    if (storeCredit) {
      if (!session?.id) {
        return json(503, { error: 'store_credit_attach_failed', retryable: true });
      }
      try {
        await attachStoreCredit(sb, {
          reservationId: storeCredit.reservationId,
          stripeSessionId: session.id,
        });
      } catch {
        // Provider creation may have succeeded. Keep the reservation fail-closed and use
        // the same idempotency key on retry instead of risking a second spend or session.
        return json(503, { error: 'store_credit_attach_failed', retryable: true });
      }
    }
    return json(200, {
      url: session.url,
      ...(storeCredit ? { store_credit_amount_minor: storeCredit.amountMinor } : {}),
    });
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
