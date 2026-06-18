// POST /api/checkout — create a checkout for the cart.
// mode 'pay' → Stripe-hosted Checkout Session (guest or logged-in). Returns { url }.
// mode 'net' → place on account; approved B2B only. Phase 3 creates the QBO invoice.
//
// SECURITY: server re-prices every line from the DB and refuses any vsku that is not
// active, priced, and whose parent product is active + mode='buy'. Client prices are
// ignored entirely. Self-gate: unpriced/unknown vsku → 409 not_purchasable.
import Stripe from 'stripe';
import { adminClient, userFromRequest, json, readBody, tierForRequest, tierPriceMap } from '../_lib/supabase.js';

export async function onRequestPost({ request, env }) {
  const body = await readBody(request);
  const mode = body.mode === 'net' ? 'net' : 'pay';

  const wanted = Array.isArray(body.items) ? body.items : [];
  if (!wanted.length) return json(400, { error: 'cart_empty' });

  const skus = [...new Set(wanted.map((i) => String(i.sku)))];
  const qtyBySku = Object.fromEntries(
    wanted.map((i) => [String(i.sku), Math.max(1, parseInt(i.qty, 10) || 1)])
  );

  const sb = adminClient(env);
  const { data: variants, error } = await sb
    .from('product_variants')
    .select('vsku,product_sku,label,price,currency,stripe_price_id,active,products(name,mode,active,taxable)')
    .in('vsku', skus);
  if (error) return json(500, { error: error.message });

  // Re-price + self-gate from the DB.
  const sellable = [];
  const rejected = [];
  for (const vsku of skus) {
    const v = variants?.find((x) => x.vsku === vsku);
    const prod = v?.products;
    if (!v || v.active === false || v.price == null || !prod || prod.active === false || prod.mode !== 'buy') {
      rejected.push(vsku);
    } else {
      sellable.push({
        sku: v.vsku,
        product_sku: v.product_sku,
        name: `${prod.name} — ${v.label}`,
        price: v.price,
        currency: v.currency || 'usd',
        taxable: prod.taxable,
        stripe_price_id: v.stripe_price_id,
      });
    }
  }

  if (rejected.length) {
    return json(409, {
      error: 'not_purchasable',
      skus: rejected,
      message: 'These items are quote-only or not yet priced. Use the quote form.',
    });
  }

  // Apply the caller's tier price (price_tiers[tier] ?? base). When an override
  // exists, force dynamic price_data by clearing stripe_price_id so the tier
  // amount is actually charged. Drives both the Stripe and NET subtotals below.
  const { tier } = await tierForRequest(request, env);
  if (tier !== 'retail') {
    const overrides = await tierPriceMap(sb, tier);
    for (const p of sellable) {
      if (overrides.has(p.sku)) { p.price = overrides.get(p.sku); p.stripe_price_id = null; }
    }
  }

  // NET terms path (approved B2B only).
  if (mode === 'net') {
    const { user } = await userFromRequest(request, env);
    if (!user) return json(401, { error: 'auth_required_for_net' });
    const { data: profile } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
    const { data: company } = profile?.company_id
      ? await sb.from('companies').select('id,status,net_terms_days').eq('id', profile.company_id).maybeSingle()
      : { data: null };
    if (!company || company.status !== 'approved' || (company.net_terms_days || 0) <= 0) {
      return json(403, { error: 'net_terms_unavailable' });
    }
    const subtotal = sellable.reduce((s, p) => s + Number(p.price) * qtyBySku[p.sku], 0);
    const { data: order } = await sb.from('orders').insert({
      company_id: company.id, user_id: user.id, status: 'net_open', payment_method: 'net',
      subtotal, total: subtotal, currency: sellable[0].currency || 'usd',
    }).select('id').single();
    if (order) {
      const { error: itemsErr } = await sb.from('order_items').insert(sellable.map((p) => ({
        order_id: order.id, sku: p.sku, product_sku: p.product_sku, name: p.name, qty: qtyBySku[p.sku],
        unit_price: p.price, line_total: Number(p.price) * qtyBySku[p.sku],
      })));
      if (itemsErr) console.error('order_items_insert_failed', itemsErr.message);
    }
    return json(201, {
      net: true, order_id: order?.id,
      message: 'Order placed on account. A QuickBooks invoice will follow (NET terms).',
    });
  }

  // Stripe-hosted Checkout (guest or logged-in).
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return json(500, { error: 'stripe_not_configured' });
  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() });
  const appUrl = env.APP_URL || `https://${request.headers.get('host')}`;

  const line_items = sellable.map((p) => (
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

  const { user } = await userFromRequest(request, env);
  let companyId = null;
  if (user) {
    const { data: profile } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
    companyId = profile?.company_id || null;
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      payment_method_types: ['card', 'us_bank_account'],
      // Tax reconciled on the B2B invoice (Stripe Tax not yet configured). Re-enable
      // by flipping to { enabled: true } after setting a head-office address in Stripe.
      automatic_tax: { enabled: false },
      customer_email: body.email || user?.email || undefined,
      shipping_address_collection: { allowed_countries: ['US'] },
      billing_address_collection: 'required',
      success_url: `${appUrl}/order-confirmed.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/cart.html`,
      metadata: {
        company_id: companyId || '',
        buyer_email: body.email || user?.email || '',
        cart: JSON.stringify(sellable.map((p) => ({ sku: p.sku, product_sku: p.product_sku, name: p.name, qty: qtyBySku[p.sku], unit_price: Number(p.price) }))),
      },
    });
  } catch (err) {
    // Surface Stripe API errors as JSON instead of a 1101 Worker crash.
    return json(502, { error: 'stripe_error', code: err?.code || null, detail: err?.message || String(err) });
  }

  return json(200, { url: session.url });
}
