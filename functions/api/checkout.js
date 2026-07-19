// POST /api/checkout - create a checkout for the cart.
// mode 'pay' -> Stripe-hosted Checkout Session.
// mode 'net' -> approved B2B account order.
import Stripe from 'stripe';
import { adminClient, userFromRequest, json, tierForRequest, tierPriceMap, sendEmail, emailLayout, htmlEscape } from '../_lib/supabase.js';
import { buildStripeCheckoutSessionParams } from '../_lib/checkout-session.js';
import { ensureCompanyStripeCustomer } from '../_lib/stripe-customer.js';
import { isMissingFunctionError } from '../_lib/credit.js';
import { sdsAttachments } from '../_lib/sds-docs.js';
import { orderItemsTableHtml, sdsNoteHtml } from '../_lib/order-email.js';
import { clientIp, rateLimit } from '../_lib/ratelimit.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../_lib/request-body.js';

const CHECKOUT_BODY_MAX_BYTES = 64 * 1024;
const CHECKOUT_MAX_CART_LINES = 50;
const CHECKOUT_MAX_SKU_LENGTH = 80;
const CHECKOUT_MAX_QUANTITY = 999;

// Branded confirmation for a NET (on-account) order. Stripe orders are confirmed by the
// webhook; NET orders had no email at all. Best-effort: the order is already placed and
// stock decremented, so an email failure must never fail the checkout response.
async function sendNetOrderConfirmation({ env, order, lines, toEmail }) {
  try {
    if (!env.RESEND_API_KEY || !toEmail) return;
    const appUrl = String(env.APP_URL || 'https://masest.co').replace(/\/+$/, '');
    const currency = lines[0]?.currency || 'usd';
    const total = lines.reduce((s, l) => s + (Number(l.unit_price) || 0) * (Number(l.qty) || 0), 0);
    const ref = order?.id ? ` #${order.id}` : '';
    const attachments = sdsAttachments(lines, appUrl);
    const bodyHtml = `<p style="margin:0 0 16px;color:#556;font-size:14px;line-height:1.5">Your order is placed on account. A QuickBooks invoice will follow under your NET terms; no payment is due now.</p>`
      + orderItemsTableHtml(lines, { currency, subtotal: total, total })
      + sdsNoteHtml(attachments.length);
    await sendEmail(env, {
      to: [toEmail],
      bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
      subject: `Your MASEST order${ref} is placed (NET terms)`,
      html: emailLayout({ heading: `Order placed${htmlEscape(ref)}`, bodyHtml, ctaText: 'View your order', ctaUrl: `${appUrl}/dashboard.html#orders` }),
      category: 'order',
      attachments,
      idempotencyKey: order?.id ? `order-confirm:${order.id}` : null,
    });
  } catch {
    // Confirmation email is advisory — never fail a placed NET order on it.
  }
}

function normalizeCart(cart) {
  if (!Array.isArray(cart)) return Object.create(null);

  const qtyBySku = Object.create(null);
  let distinctLines = 0;
  for (const item of cart) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (typeof item.sku !== 'string') return null;
    const sku = item.sku.trim();
    if (!sku || sku.length > CHECKOUT_MAX_SKU_LENGTH) return null;
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > CHECKOUT_MAX_QUANTITY) return null;

    if (qtyBySku[sku] === undefined) {
      distinctLines += 1;
      if (distinctLines > CHECKOUT_MAX_CART_LINES) return null;
      qtyBySku[sku] = 0;
    }
    const qty = qtyBySku[sku] + item.qty;
    if (qty > CHECKOUT_MAX_QUANTITY) return null;
    qtyBySku[sku] = qty;
  }
  return qtyBySku;
}

function variantIsStocked(variant, qty) {
  return !(variant.track_stock && variant.stock != null && Number(variant.stock) < qty);
}

export async function handleCheckout({ request, env }, dependencies = {}) {
  const getAdminClient = dependencies.adminClient || adminClient;
  const getUserFromRequest = dependencies.userFromRequest || userFromRequest;
  const getTierForRequest = dependencies.tierForRequest || tierForRequest;
  const getTierPriceMap = dependencies.tierPriceMap || tierPriceMap;
  const getStripeCustomer = dependencies.ensureCompanyStripeCustomer || ensureCompanyStripeCustomer;
  const checkRateLimit = dependencies.rateLimit || rateLimit;
  const parseBody = dependencies.readBoundedJson || readBoundedJson;
  const sendNetConfirmation = dependencies.sendNetOrderConfirmation || sendNetOrderConfirmation;
  const createStripe = dependencies.createStripe
    || ((secret) => new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() }));

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

  const mode = body.mode === 'net' ? 'net' : 'pay';
  const requestKey = typeof body.request_key === 'string' ? body.request_key.trim() : '';
  if (mode === 'net' && (!requestKey || requestKey.length > 128)) {
    return json(400, { error: 'bad_request' });
  }
  // Cart line items. Canonical key is `cart`; `items` is accepted as a fallback so an
  // in-flight/cached client build (js/cart.js historically posted `items`) still checks out.
  const qtyBySku = normalizeCart(body.cart ?? body.items);
  if (!qtyBySku) return json(400, { error: 'bad_request' });
  const skus = Object.keys(qtyBySku);
  if (!skus.length) return json(400, { error: 'cart_empty' });

  const sb = getAdminClient(env);
  let netContext = null;
  if (mode === 'net') {
    const { user } = await getUserFromRequest(request, env);
    if (!user) return json(401, { error: 'auth_required_for_net' });
    const { data: profile } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
    const { data: company } = await sb.from('companies').select('id,status,net_terms_days,credit_limit').eq('id', profile?.company_id).maybeSingle();
    if (!company) return json(403, { error: 'net_terms_unavailable' });

    // Probe request-key identity before catalog/stock validation. A response-loss retry
    // must return its original order even when the first attempt consumed the last stock.
    const { data: probe, error: probeErr } = await sb.rpc('place_net_order_v2', {
      p_company_id: company.id,
      p_user_id: user.id,
      p_email: user.email || null,
      p_request_key: requestKey,
      p_items: Object.entries(qtyBySku).map(([sku, qty]) => ({ sku, qty })),
      p_subtotal: 0,
      p_currency: '',
      p_probe: true,
    });
    if (probeErr && isMissingFunctionError(probeErr)) {
      return json(503, { error: 'net_order_unavailable' });
    }
    if (probeErr || !probe || typeof probe !== 'object') {
      return json(503, { error: 'net_order_unavailable' });
    }
    if (probe.rejected && probe.reason === 'request_key_conflict') {
      return json(409, { error: 'request_key_conflict' });
    }
    if (probe.rejected) {
      return json(409, { error: probe.reason || 'net_order_rejected' });
    }
    if (probe.duplicate) {
      return json(200, {
        net: true,
        order_id: probe.order_id,
        duplicate: true,
        message: 'Order placed on account. A QuickBooks invoice will follow (NET terms).',
      });
    }
    if (!probe.probe) return json(503, { error: 'net_order_unavailable' });

    if (company.status !== 'approved' || (company.net_terms_days || 0) <= 0) {
      return json(403, { error: 'net_terms_unavailable' });
    }
    netContext = { user, company };
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

  // One order = one currency (Stripe forbids mixed-currency sessions, and the subtotal sum
  // would be meaningless). Catalog is USD today; this guards a future non-USD variant.
  const currencies = new Set(sellable.map((p) => (p.currency || 'usd').toLowerCase()));
  if (currencies.size > 1) {
    return json(409, { error: 'mixed_currency', message: 'Items in your cart use different currencies. Order them separately.' });
  }

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

  if (mode === 'net') {
    const { user, company } = netContext;

    const subtotal = sellable.reduce((s, p) => s + Number(p.price) * qtyBySku[p.sku], 0);

    const rpcItems = sellable.map((p) => ({
      sku: p.sku,
      product_sku: p.product_sku,
      name: p.name,
      qty: qtyBySku[p.sku],
      unit_price: Number(p.price),
      line_total: Number(p.price) * qtyBySku[p.sku],
    }));

    // The v2 RPC owns the entire NET ledger transaction: credit, order, items, stock,
    // and request-key idempotency. Missing v2 fails closed; v1 remains migration-only.
    const { data: placed, error: placeErr } = await sb.rpc('place_net_order_v2', {
      p_company_id: company.id,
      p_user_id: user.id,
      p_email: user.email || null,
      p_request_key: requestKey,
      p_items: rpcItems,
      p_subtotal: subtotal,
      p_currency: sellable[0].currency || 'usd',
      p_probe: false,
    });
    if (placeErr && isMissingFunctionError(placeErr)) {
      return json(503, { error: 'net_order_unavailable' });
    }
    if (placeErr || !placed || typeof placed !== 'object') {
      return json(503, { error: 'net_order_unavailable' });
    }
    if (placed.rejected && placed.reason === 'credit_limit_exceeded') {
      return json(403, {
        error: 'credit_limit_exceeded',
        credit_limit: placed.credit_limit,
        outstanding: placed.outstanding,
        available: placed.available,
        order_total: subtotal,
      });
    }
    if (placed.rejected && placed.reason === 'out_of_stock') {
      return json(409, {
        error: 'out_of_stock',
        skus: placed.skus || [],
        message: 'Stock changed before the order could be placed. Review the cart and try again.',
      });
    }
    if (placed.rejected && placed.reason === 'currency_mismatch') {
      return json(409, {
        error: 'mixed_currency',
        message: 'Items in your cart use different currencies. Order them separately.',
      });
    }
    if (placed.rejected && placed.reason === 'request_key_conflict') {
      return json(409, { error: 'request_key_conflict' });
    }
    if (placed.rejected) {
      return json(409, { error: placed.reason || 'net_order_rejected' });
    }

    const order = { id: placed.order_id };

    if (!placed.duplicate) {
      await sendNetConfirmation({
        env,
        order,
        lines: sellable.map((p) => ({ name: p.name, sku: p.sku, qty: qtyBySku[p.sku], unit_price: p.price, currency: p.currency })),
        toEmail: user.email,
      });
    }

    return json(placed.duplicate ? 200 : 201, {
      net: true,
      order_id: order.id,
      duplicate: !!placed.duplicate,
      message: 'Order placed on account. A QuickBooks invoice will follow (NET terms).',
    });
  }

  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return json(500, { error: 'stripe_not_configured' });
  const stripe = createStripe(secret);
  const appUrl = String(env.APP_URL || '').replace(/\/+$/, '');
  if (!appUrl) return json(500, { error: 'app_url_not_configured' });

  const taxEnabled = env.STRIPE_TAX_ENABLED === 'true';

  let companyId = null;
  let company = null;
  const { user } = await getUserFromRequest(request, env);
  if (user) {
    const { data: profile } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
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
        await stripe.customers.update(customerId, { tax_exempt: company.tax_exempt ? 'exempt' : 'none' });
      } catch {
        // Preserve checkout availability if the optional tax-state update fails.
        customerId = null;
      }
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
    }));
    return json(200, { url: session.url });
  } catch (err) {
    return json(502, { error: 'stripe_error', code: err?.code || null, detail: err?.message || String(err) });
  }
}

export function createCheckoutHandler(dependencies = {}) {
  return (context) => handleCheckout(context, dependencies);
}

export async function onRequestPost(context) {
  return handleCheckout(context);
}
