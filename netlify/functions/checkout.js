// POST /api/checkout — create a checkout for the cart.
// mode 'pay'  → Stripe-hosted Checkout Session (guest or logged-in). Returns { url }.
// mode 'net'  → place on account; approved B2B only. Phase 3 creates the QBO invoice.
//
// SECURITY: the server re-prices every line from the DB and refuses any SKU that is not
// mode='buy', active, and priced. Client-sent prices are ignored entirely. This is also the
// self-gate: with all buy-SKU prices still null, every checkout 400s until owner sets prices.
import Stripe from 'stripe';
import { adminClient, userFromRequest, json, readBody } from '../lib/supabase.js';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const body = await readBody(req);
  const wanted = Array.isArray(body.items) ? body.items : [];
  const mode = body.mode === 'net' ? 'net' : 'pay';
  if (!wanted.length) return json(400, { error: 'cart_empty' });

  // Cart keys are variant SKUs (vsku). Re-price from product_variants, not the parent product.
  const skus = [...new Set(wanted.map((i) => String(i.sku)))];
  const qtyBySku = Object.fromEntries(wanted.map((i) => [String(i.sku), Math.max(1, parseInt(i.qty, 10) || 1)]));

  const sb = adminClient();
  const { data: variants, error } = await sb
    .from('product_variants')
    .select('vsku,label,price,currency,stripe_price_id,active,products(name,mode,active,taxable)')
    .in('vsku', skus);
  if (error) return json(500, { error: error.message });

  // Validate: variant active + priced, and its parent product active + mode 'buy'.
  // `sellable` rows are shaped like the old product rows (sku=vsku, name="Product — label")
  // so the Stripe / order / metadata code below is unchanged.
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
        name: `${prod.name} — ${v.label}`,
        price: v.price,
        currency: v.currency || 'usd',
        taxable: prod.taxable,
        stripe_price_id: v.stripe_price_id,
      });
    }
  }
  if (rejected.length) {
    return json(409, { error: 'not_purchasable', skus: rejected,
      message: 'These items are quote-only or not yet priced. Use the quote form.' });
  }

  // --- NET terms path (approved B2B only) ---
  if (mode === 'net') {
    const { user } = await userFromRequest(req);
    if (!user) return json(401, { error: 'auth_required_for_net' });
    const { data: profile } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
    const { data: company } = profile
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
      await sb.from('order_items').insert(sellable.map((p) => ({
        order_id: order.id, sku: p.sku, name: p.name, qty: qtyBySku[p.sku],
        unit_price: p.price, line_total: Number(p.price) * qtyBySku[p.sku],
      })));
    }
    // TODO Phase 3: create QuickBooks invoice via QBO API, email it, store qbo_invoice_id.
    return json(201, { net: true, order_id: order?.id,
      message: 'Order placed on account. A QuickBooks invoice will follow (NET terms).' });
  }

  // --- Stripe pay path (guest or logged-in) ---
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return json(500, { error: 'stripe_not_configured' });
  const stripe = new Stripe(secret);
  const appUrl = process.env.APP_URL || `https://${req.headers.get('host')}`;

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

  // Optional logged-in context for the order metadata.
  const { user } = await userFromRequest(req);
  let companyId = null;
  if (user) {
    const { data: profile } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
    companyId = profile?.company_id || null;
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items,
    payment_method_types: ['card', 'us_bank_account'],
    automatic_tax: { enabled: true },
    customer_email: body.email || user?.email || undefined,
    shipping_address_collection: { allowed_countries: ['US'] },
    billing_address_collection: 'required',
    success_url: `${appUrl}/order-confirmed.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/cart.html`,
    metadata: {
      company_id: companyId || '',
      buyer_email: body.email || user?.email || '',
      cart: JSON.stringify(sellable.map((p) => ({ sku: p.sku, name: p.name, qty: qtyBySku[p.sku], unit_price: Number(p.price) }))),
    },
  });

  return json(200, { url: session.url });
};

export const config = { path: '/api/checkout' };
