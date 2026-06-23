// POST /api/checkout - create a checkout for the cart.
// mode 'pay' -> Stripe-hosted Checkout Session.
// mode 'net' -> approved B2B account order.
import Stripe from 'stripe';
import { adminClient, userFromRequest, json, readBody, tierForRequest, tierPriceMap } from '../_lib/supabase.js';
import { buildStripeCheckoutSessionParams } from '../_lib/checkout-session.js';
import { companyCreditState, exceedsCredit, isMissingFunctionError } from '../_lib/credit.js';

function normalizeCart(cart) {
  const qtyBySku = {};
  for (const item of Array.isArray(cart) ? cart : []) {
    const sku = String(item.sku || '').trim();
    const qty = Math.max(0, Math.floor(Number(item.qty || 0)));
    if (sku && qty > 0) qtyBySku[sku] = (qtyBySku[sku] || 0) + qty;
  }
  return qtyBySku;
}

function variantIsStocked(variant, qty) {
  return !(variant.track_stock && variant.stock != null && Number(variant.stock) < qty);
}

async function decrementVariantStock(sb, sellable, qtyBySku) {
  for (const line of sellable) {
    if (!line.track_stock || line.stock == null) continue;
    const qty = qtyBySku[line.sku];
    const { data, error } = await sb.rpc('decrement_variant_stock', { p_vsku: line.sku, p_qty: qty });
    if (error || data !== true) return false;
  }
  return true;
}

export async function onRequestPost({ request, env }) {
  const body = await readBody(request);
  const mode = body.mode === 'net' ? 'net' : 'pay';
  // Cart line items. Canonical key is `cart`; `items` is accepted as a fallback so an
  // in-flight/cached client build (js/cart.js historically posted `items`) still checks out.
  const qtyBySku = normalizeCart(body.cart ?? body.items);
  const skus = Object.keys(qtyBySku);
  if (!skus.length) return json(400, { error: 'cart_empty' });

  const sb = adminClient(env);
  const { data: variants, error } = await sb
    .from('product_variants')
    .select('vsku,product_sku,label,price,currency,stripe_price_id,active,stock,track_stock,products(name,mode,active,taxable)')
    .in('vsku', skus);
  if (error) return json(500, { error: 'server_error' });

  const sellable = [];
  const rejected = [];
  const outOfStock = [];
  for (const vsku of skus) {
    const v = variants?.find((x) => x.vsku === vsku);
    const prod = v?.products;
    if (!v || v.active === false || v.price == null || !Number.isFinite(Number(v.price)) || !prod || prod.active === false || prod.mode !== 'buy') {
      rejected.push(vsku);
      continue;
    }
    if (!variantIsStocked(v, qtyBySku[vsku])) {
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

  const { tier } = await tierForRequest(request, env);
  if (tier !== 'retail') {
    const overrides = await tierPriceMap(sb, tier);
    for (const line of sellable) {
      if (overrides.has(line.sku)) {
        line.price = overrides.get(line.sku);
        line.stripe_price_id = null;
      }
    }
  }

  if (mode === 'net') {
    const { user } = await userFromRequest(request, env);
    if (!user) return json(401, { error: 'auth_required_for_net' });
    const { data: profile } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
    const { data: company } = await sb.from('companies').select('id,status,net_terms_days,credit_limit').eq('id', profile?.company_id).maybeSingle();
    if (!company || company.status !== 'approved' || (company.net_terms_days || 0) <= 0) {
      return json(403, { error: 'net_terms_unavailable' });
    }

    const subtotal = sellable.reduce((s, p) => s + Number(p.price) * qtyBySku[p.sku], 0);

    // Credit enforcement + order insert. Prefer the atomic place_net_order RPC, which
    // re-checks the limit while holding a row lock on the company — closing the
    // check-then-insert race where two concurrent NET orders could jointly exceed the
    // limit. Fall back to the in-app check when the RPC isn't deployed yet, so NET
    // checkout never hard-breaks before the migration is applied.
    let order;
    const { data: placed, error: placeErr } = await sb.rpc('place_net_order', {
      p_company_id: company.id,
      p_user_id: user.id,
      p_email: user.email || null,
      p_subtotal: subtotal,
      p_currency: sellable[0].currency || 'usd',
    });
    if (placeErr && isMissingFunctionError(placeErr)) {
      // Legacy fallback (pre-migration): non-atomic check, then insert.
      let creditState;
      try {
        creditState = await companyCreditState(sb, company.id, company.credit_limit);
      } catch (err) {
        return json(503, { error: 'credit_check_unavailable' });
      }
      if (exceedsCredit(creditState, subtotal)) {
        return json(403, {
          error: 'credit_limit_exceeded',
          credit_limit: creditState.credit_limit,
          outstanding: creditState.outstanding,
          available: creditState.available,
          order_total: subtotal,
        });
      }
      const { data: legacyOrder, error: orderErr } = await sb.from('orders').insert({
        company_id: company.id,
        user_id: user.id,
        customer_email: user.email || null,
        status: 'net_open',
        payment_method: 'net',
        qbo_sync_status: 'pending',
        subtotal,
        total: subtotal,
        currency: sellable[0].currency || 'usd',
      }).select('id').single();
      if (orderErr) return json(500, { error: 'order_persist_failed' });
      order = legacyOrder;
    } else if (placeErr) {
      return json(503, { error: 'credit_check_unavailable' });
    } else if (placed?.rejected) {
      return json(403, {
        error: 'credit_limit_exceeded',
        credit_limit: placed.credit_limit,
        outstanding: placed.outstanding,
        available: placed.available,
        order_total: subtotal,
      });
    } else {
      order = { id: placed.order_id };
    }

    const { error: itemsErr } = await sb.from('order_items').insert(sellable.map((p) => ({
      order_id: order.id,
      sku: p.sku,
      product_sku: p.product_sku,
      name: p.name,
      qty: qtyBySku[p.sku],
      unit_price: p.price,
      line_total: Number(p.price) * qtyBySku[p.sku],
    })));
    if (itemsErr) return json(500, { error: 'order_items_persist_failed' });

    const stockOk = await decrementVariantStock(sb, sellable, qtyBySku);
    if (!stockOk) {
      await sb.from('orders').update({ status: 'cancelled' }).eq('id', order.id);
      return json(409, {
        error: 'out_of_stock',
        message: 'Stock changed before the order could be placed. Review the cart and try again.',
      });
    }

    return json(201, {
      net: true,
      order_id: order.id,
      message: 'Order placed on account. A QuickBooks invoice will follow (NET terms).',
    });
  }

  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return json(500, { error: 'stripe_not_configured' });
  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() });
  const appUrl = String(env.APP_URL || '').replace(/\/+$/, '');
  if (!appUrl) return json(500, { error: 'app_url_not_configured' });

  const taxEnabled = env.STRIPE_TAX_ENABLED === 'true';

  let companyId = null;
  let company = null;
  const { user } = await userFromRequest(request, env);
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
      customerId = company.stripe_customer_id;
      if (!customerId) {
        const cu = await stripe.customers.create({
          email: body.email || user?.email || undefined, name: company.name || undefined,
          metadata: { company_id: company.id },
        });
        customerId = cu.id;
        await sb.from('companies').update({ stripe_customer_id: customerId }).eq('id', company.id);
      }
      if (taxEnabled) {
        await stripe.customers.update(customerId, { tax_exempt: company.tax_exempt ? 'exempt' : 'none' });
      }
    } catch (err) {
      // Customer setup must never block checkout — fall back to email-only (taxed normally).
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
    }));
    return json(200, { url: session.url });
  } catch (err) {
    return json(502, { error: 'stripe_error', code: err?.code || null, detail: err?.message || String(err) });
  }
}
