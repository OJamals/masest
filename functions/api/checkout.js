// POST /api/checkout - create a checkout for the cart.
// mode 'pay' -> Stripe-hosted Checkout Session.
// mode 'net' -> approved B2B account order.
import Stripe from 'stripe';
import { adminClient, userFromRequest, json, readBody, tierForRequest, tierPriceMap } from '../_lib/supabase.js';

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

function lineItemsForStripe(sellable, qtyBySku) {
  return sellable.map((p) => (
    p.stripe_price_id
      ? { price: p.stripe_price_id, quantity: qtyBySku[p.sku] }
      : {
        quantity: qtyBySku[p.sku],
        price_data: {
          currency: p.currency || 'usd',
          unit_amount: Math.round(Number(p.price) * 100),
          product_data: { name: p.name, metadata: { sku: p.sku } },
          tax_behavior: 'exclusive',
        },
      }
  ));
}

export async function onRequestPost({ request, env }) {
  const body = await readBody(request);
  const mode = body.mode === 'net' ? 'net' : 'pay';
  const qtyBySku = normalizeCart(body.cart);
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
      message: 'These items are quote-only or not yet priced. Use the quote form.',
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
    const user = await userFromRequest(request, env);
    if (!user) return json(401, { error: 'auth_required_for_net' });
    const { data: profile } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
    const { data: company } = await sb.from('companies').select('id,status,net_terms_days').eq('id', profile?.company_id).maybeSingle();
    if (!company || company.status !== 'approved' || (company.net_terms_days || 0) <= 0) {
      return json(403, { error: 'net_terms_unavailable' });
    }

    const subtotal = sellable.reduce((s, p) => s + Number(p.price) * qtyBySku[p.sku], 0);
    const { data: order, error: orderErr } = await sb.from('orders').insert({
      company_id: company.id,
      user_id: user.id,
      status: 'net_open',
      payment_method: 'net',
      subtotal,
      total: subtotal,
      currency: sellable[0].currency || 'usd',
    }).select('id').single();
    if (orderErr) return json(500, { error: orderErr.message });

    const { error: itemsErr } = await sb.from('order_items').insert(sellable.map((p) => ({
      order_id: order.id,
      sku: p.sku,
      product_sku: p.product_sku,
      name: p.name,
      qty: qtyBySku[p.sku],
      unit_price: p.price,
      line_total: Number(p.price) * qtyBySku[p.sku],
    })));
    if (itemsErr) return json(500, { error: itemsErr.message });

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
  const appUrl = env.APP_URL || `https://${request.headers.get('host')}`;

  let companyId = null;
  const user = await userFromRequest(request, env);
  if (user) {
    const { data: profile } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
    companyId = profile?.company_id || null;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItemsForStripe(sellable, qtyBySku),
      payment_method_types: ['card', 'us_bank_account'],
      automatic_tax: { enabled: false },
      customer_email: body.email || user?.email || undefined,
      shipping_address_collection: { allowed_countries: ['US'] },
      billing_address_collection: 'required',
      success_url: `${appUrl}/order-confirmed.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/cart.html`,
      metadata: {
        company_id: companyId || '',
        buyer_email: body.email || user?.email || '',
        cart: JSON.stringify(sellable.map((p) => ({
          sku: p.sku,
          product_sku: p.product_sku,
          name: p.name,
          qty: qtyBySku[p.sku],
          unit_price: Number(p.price),
        }))),
      },
    });
    return json(200, { url: session.url });
  } catch (err) {
    return json(502, { error: 'stripe_error', code: err?.code || null, detail: err?.message || String(err) });
  }
}
