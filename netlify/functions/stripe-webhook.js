// POST /api/stripe-webhook — Stripe event sink. Verifies signature, records paid orders.
// Configure in Stripe Dashboard → Webhooks → endpoint https://masest.co/api/stripe-webhook,
// event checkout.session.completed. Put the signing secret in STRIPE_WEBHOOK_SECRET.
import Stripe from 'stripe';
import { adminClient, json } from '../lib/supabase.js';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const secret = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !whSecret) return json(500, { error: 'stripe_not_configured' });

  const stripe = new Stripe(secret);
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text(); // raw body required for signature verification

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, whSecret);
  } catch (err) {
    return json(400, { error: 'invalid_signature', detail: err.message });
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const sb = adminClient();

    // Idempotency: skip if this session already recorded.
    const { data: dupe } = await sb.from('orders').select('id').eq('stripe_payment_intent', s.payment_intent).maybeSingle();
    if (dupe) return json(200, { received: true, duplicate: true });

    let cart = [];
    try { cart = JSON.parse(s.metadata?.cart || '[]'); } catch { cart = []; }
    const subtotal = (s.amount_subtotal ?? 0) / 100;
    const tax = (s.total_details?.amount_tax ?? 0) / 100;
    const total = (s.amount_total ?? 0) / 100;

    const { data: order } = await sb.from('orders').insert({
      company_id: s.metadata?.company_id || null,
      status: 'paid',
      payment_method: 'stripe',
      subtotal, tax, total,
      currency: s.currency || 'usd',
      stripe_payment_intent: s.payment_intent,
      ship_address: s.shipping_details || s.customer_details || null,
    }).select('id').single();

    if (order && cart.length) {
      // resolve proper product names (metadata cart is kept compact)
      const { data: prods } = await sb.from('products').select('sku,name').in('sku', cart.map((c) => c.sku));
      const nameBySku = Object.fromEntries((prods || []).map((p) => [p.sku, p.name]));
      await sb.from('order_items').insert(cart.map((c) => ({
        order_id: order.id, sku: c.sku, name: nameBySku[c.sku] || c.sku, qty: c.qty,
        unit_price: c.unit_price, line_total: c.unit_price * c.qty,
      })));
    }
    // TODO Phase 2: Resend order-confirmation email. Phase 3: QBO sales receipt.
  }

  return json(200, { received: true });
};

// Stripe must reach the raw body unparsed.
export const config = { path: '/api/stripe-webhook' };
