// POST /api/stripe-webhook — Stripe event sink. Verifies signature, records paid orders.
// Configure in Stripe Dashboard → Webhooks → endpoint <your-domain>/api/stripe-webhook,
// event checkout.session.completed. Put that endpoint's signing secret in STRIPE_WEBHOOK_SECRET.
// On the Workers runtime signature verification must use the SubtleCrypto provider.
import Stripe from 'stripe';
import { adminClient, json } from '../_lib/supabase.js';
import { buyerEmailFromStripeSession } from '../_lib/checkout-session.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Branded order-confirmation email via Resend. Never throws: email failure must not
// fail the webhook (Stripe would retry the whole event). No-op if unconfigured or
// the session has no buyer email. RESEND_FROM must be a Resend-verified sender.
async function sendOrderConfirmation({ env, session, order, lines, subtotal, tax, total }) {
  const apiKey = env.RESEND_API_KEY;
  const to = buyerEmailFromStripeSession(session);
  if (!apiKey || !to) return;

  const from = env.RESEND_FROM || 'MASEST Orders <orders@masest.co>';
  const currency = (session.currency || 'usd').toUpperCase();
  const fmt = (n) => `${currency} ${Number(n || 0).toFixed(2)}`;
  const ref = order?.id ? ` #${order.id}` : '';

  const rows = (lines || []).map((l) =>
    `<tr>`
    + `<td style="padding:8px 0;border-bottom:1px solid #eef">${escapeHtml(l.name)} `
    + `<span style="color:#789">(${escapeHtml(l.sku)})</span></td>`
    + `<td style="padding:8px 0;border-bottom:1px solid #eef;text-align:center">${l.qty}</td>`
    + `<td style="padding:8px 0;border-bottom:1px solid #eef;text-align:right">${fmt(l.unit_price * l.qty)}</td>`
    + `</tr>`).join('');

  const addr = session.shipping_details?.address || session.customer_details?.address || null;
  const shipBlock = addr
    ? `<p style="margin:18px 0 0;color:#445"><b>Ship to</b><br>${[addr.line1, addr.line2, [addr.city, addr.state, addr.postal_code].filter(Boolean).join(', '), addr.country].filter(Boolean).map(escapeHtml).join('<br>')}</p>`
    : '';

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#223">
    <h2 style="margin:0 0 4px">Order confirmed${escapeHtml(ref)}</h2>
    <p style="margin:0 0 18px;color:#556">Thank you. MASEST will reconcile freight and documentation before fulfillment. A separate card receipt is sent by our payment processor.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr>
        <th style="text-align:left;padding:6px 0;border-bottom:2px solid #ccd">Product</th>
        <th style="text-align:center;padding:6px 0;border-bottom:2px solid #ccd">Qty</th>
        <th style="text-align:right;padding:6px 0;border-bottom:2px solid #ccd">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:10px">
      <tr><td style="padding:3px 0;color:#556">Subtotal</td><td style="padding:3px 0;text-align:right">${fmt(subtotal)}</td></tr>
      <tr><td style="padding:3px 0;color:#556">Tax</td><td style="padding:3px 0;text-align:right">${fmt(tax)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:bold;border-top:1px solid #ccd">Total</td><td style="padding:6px 0;text-align:right;font-weight:bold;border-top:1px solid #ccd">${fmt(total)}</td></tr>
    </table>
    ${shipBlock}
    <p style="margin:22px 0 0;font-size:13px;color:#789">Questions? Reply to this email or contact MASEST through masest.co.</p>
  </div>`;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        bcc: env.ORDER_NOTIFY_EMAIL || undefined,
        subject: `Your MASEST order${ref} is confirmed`,
        html,
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      console.error('resend_failed', resp.status, detail.slice(0, 300));
    }
  } catch (err) {
    console.error('resend_error', err?.message || err);
  }
}

export async function onRequestPost({ request, env }) {
  const secret = env.STRIPE_SECRET_KEY;
  const whSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !whSecret) return json(500, { error: 'stripe_not_configured' });

  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() });
  const cryptoProvider = Stripe.createSubtleCryptoProvider();
  const sig = request.headers.get('stripe-signature');
  const raw = await request.text(); // raw body required for signature verification

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, whSecret, undefined, cryptoProvider);
  } catch (err) {
    return json(400, { error: 'invalid_signature', detail: err.message });
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const sb = adminClient(env);

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

    // Cart keys are variant SKUs; names come from checkout metadata ("Product — 55 gal drum").
    let lines = [];
    if (cart.length) {
      lines = cart.map((c) => ({ sku: c.sku, name: c.name || c.sku, qty: c.qty, unit_price: c.unit_price }));
      if (order) {
        await sb.from('order_items').insert(lines.map((l) => ({
          order_id: order.id, sku: l.sku, name: l.name, qty: l.qty,
          unit_price: l.unit_price, line_total: l.unit_price * l.qty,
        })));
      }
    }

    // Branded order-confirmation email (Stripe also sends its own card receipt).
    await sendOrderConfirmation({ env, session: s, order, lines, subtotal, tax, total });
    // TODO Phase 3: QBO sales receipt.
  }

  return json(200, { received: true });
}
