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

  const from = env.RESEND_FROM || 'MASEST <noreply@send.masest.co>';
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

  const appUrl = env.APP_URL || 'https://masest.co';
  const html = `
  <div style="background:#f4f7f7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:580px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e4e6e9">
      <div style="background:#0e7c86;padding:20px 28px">
        <span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:.04em">MASEST</span>
        <span style="color:#bfe4e7;font-size:11px;letter-spacing:.16em;margin-left:8px">VERTKLEEN</span>
      </div>
      <div style="padding:28px;color:#223">
        <h2 style="margin:0 0 4px;color:#15171c">Order confirmed${escapeHtml(ref)}</h2>
        <p style="margin:0 0 20px;color:#556;font-size:14px;line-height:1.5">Thank you. MASEST will reconcile freight and documentation before fulfillment. Your payment processor sends a separate card receipt.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead><tr>
            <th style="text-align:left;padding:6px 0;border-bottom:2px solid #d7e3e3">Product</th>
            <th style="text-align:center;padding:6px 0;border-bottom:2px solid #d7e3e3">Qty</th>
            <th style="text-align:right;padding:6px 0;border-bottom:2px solid #d7e3e3">Amount</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:10px">
          <tr><td style="padding:3px 0;color:#556">Subtotal</td><td style="padding:3px 0;text-align:right">${fmt(subtotal)}</td></tr>
          <tr><td style="padding:3px 0;color:#556">Tax</td><td style="padding:3px 0;text-align:right">${fmt(tax)}</td></tr>
          <tr><td style="padding:6px 0;font-weight:bold;border-top:1px solid #ccd">Total</td><td style="padding:6px 0;text-align:right;font-weight:bold;border-top:1px solid #ccd">${fmt(total)}</td></tr>
        </table>
        ${shipBlock}
        <div style="margin:24px 0 0">
          <a href="${appUrl}/dashboard.html#orders" style="display:inline-block;background:#0e7c86;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:999px">View your order</a>
        </div>
      </div>
      <div style="background:#0b0d12;padding:18px 28px;color:#8a93a0;font-size:11px;line-height:1.7">
        MASEST Consulting LLC &middot; Florida's Space Coast &middot; CAGE 0B2Q3 &middot; NAICS 424690<br>
        HMIS 0-0-0 industrial cleaning chemistry. Questions? Reply to this email.
      </div>
    </div>
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

// Best-effort stock decrement for paid lines. Product-level (matches the admin stock UI). Never throws:
// inventory drift must not fail the webhook (Stripe would retry the whole event).
async function decrementStock(sb, lines) {
  for (const l of lines || []) {
    const key = l.product_sku || l.sku;
    if (!key) continue;
    try {
      const { data: p } = await sb.from('products').select('sku,track_stock,stock').eq('sku', key).maybeSingle();
      if (p && p.track_stock && p.stock != null) {
        const next = Math.max(0, Number(p.stock) - Number(l.qty || 0));
        await sb.from('products').update({ stock: next }).eq('sku', key);
      }
    } catch (e) { console.error('stock_decrement_failed', key, e?.message || e); }
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

    // Program subscription checkout (mode=subscription): record enrollment, skip the order path.
    if (s.mode === 'subscription') {
      try {
        await sb.from('program_subscriptions').upsert({
          company_id: s.metadata?.company_id || null,
          tier: s.metadata?.tier || null,
          stripe_subscription_id: s.subscription || null,
          stripe_customer_id: s.customer || null,
          status: 'active',
        }, { onConflict: 'stripe_subscription_id' });
        if (s.metadata?.company_id) {
          await sb.from('notifications').insert({
            company_id: s.metadata.company_id, type: 'account',
            title: `${s.metadata?.tier || 'Program'} program active`,
            body: 'Your VertKleen service program is now active.', link: '/business.html',
          }).then(() => {}, () => {});
        }
      } catch (e) { console.error('program_sub_record_failed', e?.message || e); }
      return json(200, { received: true, subscription: true });
    }

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
      lines = cart.map((c) => ({ sku: c.sku, product_sku: c.product_sku || null, name: c.name || c.sku, qty: c.qty, unit_price: c.unit_price }));
      if (order) {
        const { error: itemsErr } = await sb.from('order_items').insert(lines.map((l) => ({
          order_id: order.id, sku: l.sku, product_sku: l.product_sku, name: l.name, qty: l.qty,
          unit_price: l.unit_price, line_total: l.unit_price * l.qty,
        })));
        if (itemsErr) console.error('order_items_insert_failed', itemsErr.message);
      }
    }

    // Branded order-confirmation email (Stripe also sends its own card receipt).
    await sendOrderConfirmation({ env, session: s, order, lines, subtotal, tax, total });
    // Decrement inventory for stock-tracked SKUs (best-effort; never fails the webhook).
    if (order && lines.length) await decrementStock(sb, lines);
    // Notify the buyer's company that the order was received (feeds the dashboard + nav badge).
    if (order && s.metadata?.company_id) {
      await sb.from('notifications').insert({
        company_id: s.metadata.company_id, type: 'order', title: 'Order received',
        body: `We received your order (${(s.currency || 'usd').toUpperCase()} ${total.toFixed(2)}) and are processing it.`,
        link: '/dashboard.html#orders',
      }).then(() => {}, () => {});
    }
    // TODO Phase 3: QBO sales receipt.
  }

  // Subscription lifecycle → keep program_subscriptions status in sync.
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const status = event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status;
    try {
      await adminClient(env).from('program_subscriptions')
        .update({ status }).eq('stripe_subscription_id', sub.id);
    } catch (e) { console.error('sub_status_update_failed', e?.message || e); }
    return json(200, { received: true });
  }

  return json(200, { received: true });
}
