// POST /api/stripe-webhook — Stripe event sink. Verifies signature, records paid orders.
// Configure in Stripe Dashboard → Webhooks → endpoint <your-domain>/api/stripe-webhook,
// event checkout.session.completed. Put that endpoint's signing secret in STRIPE_WEBHOOK_SECRET.
// On the Workers runtime signature verification must use the SubtleCrypto provider.
import Stripe from 'stripe';
import { adminClient, json, sendEmail, companyEmails, htmlEscape } from '../_lib/supabase.js';
import { buyerEmailFromStripeSession } from '../_lib/checkout-session.js';
import { sdsAttachments } from '../_lib/sds-docs.js';
import {
  isDelinquentStatus,
  planFailedPayment,
  planRecoveredPayment,
  planDispute,
  planRefundReconcile,
} from '../_lib/dunning.js';
import {
  centsToAmount,
  parseCartMetadata,
  orderRowFromSession,
  cartLines,
  orderItemRows,
  stockDecrements,
  isSubscriptionCheckout,
  subscriptionRow,
} from '../_lib/order-shape.js';

export { htmlEscape as escapeHtml } from '../_lib/supabase.js';

// Postgres unique-constraint violation (e.g. the orders.stripe_payment_intent guard).
export function isUniqueViolation(error) {
  return error?.code === '23505';
}

// Classify the paid-order insert so the webhook reacts correctly to each outcome:
//   'ok'        -> persisted; proceed with items / email / stock / notify.
//   'duplicate' -> a concurrent Stripe delivery already inserted this payment's order
//                  (unique guard fired); treat as idempotent success (HTTP 200).
//   'error'     -> transient/DB failure; the caller must return a 5xx so Stripe
//                  re-delivers — acking 200 here would lose a paid order.
export function classifyOrderInsert(error) {
  if (!error) return 'ok';
  if (isUniqueViolation(error)) return 'duplicate';
  return 'error';
}

// Branded order-confirmation email via Resend. Never throws: email failure must not
// fail the webhook (Stripe would retry the whole event). No-op if unconfigured or
// the session has no buyer email. RESEND_FROM must be a Resend-verified sender.
async function sendOrderConfirmation({ env, session, order, lines, subtotal, tax, total }) {
  const apiKey = env.RESEND_API_KEY;
  const to = buyerEmailFromStripeSession(session);
  if (!apiKey || !to) return;

  const from = env.RESEND_FROM || 'MASEST <noreply@masest.co>';
  const currency = (session.currency || 'usd').toUpperCase();
  const fmt = (n) => `${currency} ${Number(n || 0).toFixed(2)}`;
  const ref = order?.id ? ` #${order.id}` : '';

  const rows = (lines || []).map((l) =>
    `<tr>`
    + `<td style="padding:8px 0;border-bottom:1px solid #eef">${htmlEscape(l.name)} `
    + `<span style="color:#789">(${htmlEscape(l.sku)})</span></td>`
    + `<td style="padding:8px 0;border-bottom:1px solid #eef;text-align:center">${l.qty}</td>`
    + `<td style="padding:8px 0;border-bottom:1px solid #eef;text-align:right">${fmt(l.unit_price * l.qty)}</td>`
    + `</tr>`).join('');

  const addr = session.shipping_details?.address || session.customer_details?.address || null;
  const shipBlock = addr
    ? `<p style="margin:18px 0 0;color:#445"><b>Ship to</b><br>${[addr.line1, addr.line2, [addr.city, addr.state, addr.postal_code].filter(Boolean).join(', '), addr.country].filter(Boolean).map(htmlEscape).join('<br>')}</p>`
    : '';

  const appUrl = env.APP_URL || 'https://masest.co';
  // Attach the Safety Data Sheet for each chemical in the order (Resend fetches by URL).
  const attachments = sdsAttachments(lines, appUrl);
  const sdsNote = attachments.length
    ? `<p style="margin:0 0 20px;color:#556;font-size:13px;line-height:1.5">Safety Data Sheet${attachments.length > 1 ? 's are' : ' is'} attached to this email for the ${attachments.length > 1 ? 'products' : 'product'} you ordered.</p>`
    : '';
  const html = `
  <div style="background:#f4f7f7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:580px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e4e6e9">
      <div style="background:#0e7c86;padding:20px 28px">
        <span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:.04em">MASEST</span>
        <span style="color:#bfe4e7;font-size:11px;letter-spacing:.16em;margin-left:8px">VERTKLEEN</span>
      </div>
      <div style="padding:28px;color:#223">
        <h2 style="margin:0 0 4px;color:#15171c">Order confirmed${htmlEscape(ref)}</h2>
        <p style="margin:0 0 20px;color:#556;font-size:14px;line-height:1.5">Thank you. MASEST will reconcile freight and documentation before fulfillment. Your payment processor sends a separate card receipt.</p>
        ${sdsNote}
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

  // Logged + suppression-checked via the sendEmail chokepoint (category 'order').
  await sendEmail(env, {
    to: [to],
    bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
    subject: `Your MASEST order${ref} is confirmed`,
    html,
    category: 'order',
    attachments,
    // Stripe retries checkout.session.completed; key on the order so a retry can't re-send.
    idempotencyKey: order?.id ? `order-confirm:${order.id}` : (session?.id ? `order-confirm:${session.id}` : null),
  });
}

// Best-effort stock decrement for paid lines. Product-level (matches the admin stock UI). Never throws:
// inventory drift must not fail the webhook (Stripe would retry the whole event).
async function decrementVariantStock(sb, lines) {
  for (const args of stockDecrements(lines)) {
    try {
      const { error } = await sb.rpc('decrement_variant_stock', args);
      if (error) console.error('stock_decrement_failed', args.p_vsku, error.message);
    } catch (e) {
      console.error('stock_decrement_failed', args.p_vsku, e?.message || e);
    }
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
    if (isSubscriptionCheckout(s)) {
      try {
        const row = subscriptionRow(s);
        // Promote the checkout placeholder inserted at session creation (matched by
        // checkout session id). Falls back to upsert for sessions predating the placeholder.
        const { data: promoted } = await sb.from('program_subscriptions')
          .update({ status: row.status, stripe_subscription_id: row.stripe_subscription_id, stripe_customer_id: row.stripe_customer_id, tier: row.tier })
          .eq('stripe_checkout_session_id', s.id).select('id');
        if (!promoted?.length) {
          await sb.from('program_subscriptions').upsert(row, { onConflict: 'stripe_subscription_id' });
        }
        if (s.metadata?.company_id) {
          await sb.from('notifications').insert({
            company_id: s.metadata.company_id, type: 'account',
            title: `${s.metadata?.tier || 'Program'} program active`,
            body: 'Your VertKleen service program is now active.', link: '/dashboard.html#business',
          }).then(() => {}, () => {});
        }
      } catch (e) { console.error('program_sub_record_failed', e?.message || e); }
      return json(200, { received: true, subscription: true });
    }

    // Idempotency: skip if this session already recorded.
    const { data: dupe } = await sb.from('orders').select('id').eq('stripe_payment_intent', s.payment_intent).maybeSingle();
    if (dupe) return json(200, { received: true, duplicate: true });

    const cart = parseCartMetadata(s.metadata?.cart);
    const subtotal = centsToAmount(s.amount_subtotal);
    const tax = centsToAmount(s.total_details?.amount_tax);
    const total = centsToAmount(s.amount_total);

    const { data: order, error: orderErr } = await sb.from('orders')
      .insert(orderRowFromSession(s, buyerEmailFromStripeSession(s)))
      .select('id').single();

    const insertOutcome = classifyOrderInsert(orderErr);
    // A concurrent Stripe delivery already inserted this payment's order: idempotent success.
    if (insertOutcome === 'duplicate') return json(200, { received: true, duplicate: true });
    // Transient/DB failure persisting the order: do NOT ack. Return a 5xx so Stripe
    // re-delivers the event — acking 200 here would lose a paid order with no fulfillment.
    if (insertOutcome === 'error') {
      console.error('order_insert_failed', orderErr?.message || orderErr);
      return json(503, { error: 'order_persist_failed' });
    }

    // Cart keys are variant SKUs; names come from checkout metadata ("Product — 55 gal drum").
    let lines = [];
    if (cart.length) {
      lines = cartLines(cart);
      if (order) {
        const { error: itemsErr } = await sb.from('order_items').insert(orderItemRows(lines, order.id));
        if (itemsErr) console.error('order_items_insert_failed', itemsErr.message);
      }
    }

    // Branded order-confirmation email (Stripe also sends its own card receipt).
    await sendOrderConfirmation({ env, session: s, order, lines, subtotal, tax, total });
    // Decrement inventory for stock-tracked SKUs (best-effort; never fails the webhook).
      if (order && lines.length) await decrementVariantStock(sb, lines);
    // Notify the buyer's company that the order was received (feeds the dashboard + nav badge).
    if (order && s.metadata?.company_id) {
      await sb.from('notifications').insert({
        company_id: s.metadata.company_id, type: 'order', title: 'Order received',
        body: `We received your order (${(s.currency || 'usd').toUpperCase()} ${total.toFixed(2)}) and are processing it.`,
        link: '/dashboard.html#orders',
      }).then(() => {}, () => {});
    }
    // QBO invoice + linked payment are created asynchronously by /api/qbo-sync
    // (order tagged qbo_sync_status='pending' on insert above).
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

  // Failed subscription payment → mark past_due + send a dunning notice (#24).
  if (event.type === 'invoice.payment_failed') {
    const sb = adminClient(env);
    const plan = planFailedPayment(event.data.object);
    if (plan.subscriptionId) {
      await sb.from('program_subscriptions').update({ status: plan.status })
        .eq('stripe_subscription_id', plan.subscriptionId).then(() => {}, () => {});
    }
    try { await notifyBillingFailure(env, sb, plan); }
    catch (e) { console.error('dunning_failure_notice', e?.message || e); }
    return json(200, { received: true });
  }

  // Subscription invoice paid → clear delinquency; email a recovery notice only if the
  // subscription was actually past_due, so ordinary renewals never trigger an email.
  if (event.type === 'invoice.paid' && event.data.object?.subscription) {
    const sb = adminClient(env);
    const inv = event.data.object;
    const { data: row } = await sb.from('program_subscriptions')
      .select('status,company_id').eq('stripe_subscription_id', inv.subscription).maybeSingle();
    const plan = planRecoveredPayment(inv);
    if (!plan.companyId && row?.company_id) plan.companyId = row.company_id;
    await sb.from('program_subscriptions').update({ status: plan.status })
      .eq('stripe_subscription_id', inv.subscription).then(() => {}, () => {});
    if (isDelinquentStatus(row?.status)) {
      try { await notifyBillingRecovered(env, sb, plan); }
      catch (e) { console.error('dunning_recovery_notice', e?.message || e); }
    }
    return json(200, { received: true });
  }

  // Card dispute opened → alert staff with the linked order for evidence gathering.
  if (event.type === 'charge.dispute.created') {
    const sb = adminClient(env);
    const plan = planDispute(event.data.object);
    let orderId = null;
    if (plan.paymentIntent) {
      const { data: ord } = await sb.from('orders').select('id')
        .eq('stripe_payment_intent', plan.paymentIntent).maybeSingle();
      orderId = ord?.id || null;
    }
    try { await alertStaffDispute(env, plan, orderId); }
    catch (e) { console.error('dispute_alert', e?.message || e); }
    return json(200, { received: true });
  }

  // Refund issued outside the admin flow (e.g. Stripe dashboard) → reconcile the order's
  // refunded_amount/status so the two never drift (idempotent via planRefundReconcile).
  if (event.type === 'charge.refunded') {
    const sb = adminClient(env);
    const charge = event.data.object;
    if (charge.payment_intent) {
      const { data: order } = await sb.from('orders')
        .select('id,company_id,status,total,refunded_amount')
        .eq('stripe_payment_intent', charge.payment_intent).maybeSingle();
      if (order) {
        const plan = planRefundReconcile(charge, order);
        const patch = { refunded_amount: plan.refundedAmount };
        if (plan.fullyRefunded) patch.status = 'refunded';
        await sb.from('orders').update(patch).eq('id', order.id).then(() => {}, () => {});
      }
    }
    return json(200, { received: true });
  }

  return json(200, { received: true });
}

// --- Billing-event notifications (#24). Defined below onRequestPost so the first DB
// write in this file stays inside the signature-verified handler; these run only when
// called from a verified event branch. ---

// Compact branded transactional email for billing events. Arial/Helvetica is the
// email-safe stack (web fonts don't render in mail clients), matching the order receipt.
function billingEmailHtml(env, heading, paragraphs, cta) {
  const body = (paragraphs || []).map((p) => `<p style="margin:0 0 14px;color:#445;font-size:14px;line-height:1.6">${p}</p>`).join('');
  const button = cta
    ? `<div style="margin:22px 0 0"><a href="${htmlEscape(cta.url)}" style="display:inline-block;background:#0e7c86;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:999px">${htmlEscape(cta.text)}</a></div>`
    : '';
  return `<div style="background:#f4f7f7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e4e6e9">
      <div style="background:#0e7c86;padding:18px 26px"><span style="color:#fff;font-size:19px;font-weight:800;letter-spacing:.04em">MASEST</span></div>
      <div style="padding:26px;color:#223"><h2 style="margin:0 0 12px;color:#15171c;font-size:18px">${htmlEscape(heading)}</h2>${body}${button}</div>
      <div style="background:#0b0d12;padding:16px 26px;color:#8a93a0;font-size:11px;line-height:1.7">MASEST Consulting LLC &middot; Questions? Reply to this email.</div>
    </div>
  </div>`;
}

function programsUrl(env) { return `${env.APP_URL || 'https://masest.co'}/dashboard.html#programs`; }

// invoice.payment_failed → in-app notice + dunning email to the company.
async function notifyBillingFailure(env, sb, plan) {
  const amount = `${plan.currency} ${plan.amountDue.toFixed(2)}`;
  const retryLine = plan.willRetry && plan.nextAttemptIso
    ? `We'll retry automatically on ${htmlEscape(plan.nextAttemptIso.slice(0, 10))}. To avoid any interruption, please make sure the card on file is current.`
    : 'This was the final automatic retry. Please update your payment method now to keep your program active.';
  if (plan.companyId) {
    await sb.from('notifications').insert({
      company_id: plan.companyId, type: 'account', title: 'Payment failed',
      body: `A subscription payment of ${amount} could not be collected.`, link: '/dashboard.html#programs',
    }).then(() => {}, () => {});
  }
  await sendEmail(env, {
    to: await companyEmails(sb, plan.companyId, 'billing'),
    bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
    subject: 'Action needed: your MASEST payment failed',
    html: billingEmailHtml(env, 'Your payment didn’t go through', [
      `We couldn’t collect <b>${amount}</b> for your MASEST program subscription (attempt ${plan.attempt}).`,
      retryLine,
    ], { url: programsUrl(env), text: 'Update payment method' }),
    category: 'billing',
  });
}

// invoice.paid after a delinquency → recovery notice (renewals stay silent; see caller).
async function notifyBillingRecovered(env, sb, plan) {
  if (plan.companyId) {
    await sb.from('notifications').insert({
      company_id: plan.companyId, type: 'account', title: 'Payment received',
      body: 'Your subscription is active again. Thank you.', link: '/dashboard.html#programs',
    }).then(() => {}, () => {});
  }
  await sendEmail(env, {
    to: await companyEmails(sb, plan.companyId, 'billing'),
    subject: 'Your MASEST subscription is active again',
    html: billingEmailHtml(env, 'Payment received — you’re all set', [
      `We collected <b>${plan.currency} ${plan.amountPaid.toFixed(2)}</b> and your program subscription is active again.`,
      'No further action is needed. Thank you for being a MASEST customer.',
    ], { url: programsUrl(env), text: 'View your programs' }),
    category: 'billing',
  });
}

// charge.dispute.created → staff alert with the linked order (best-effort recipient).
async function alertStaffDispute(env, plan, orderId) {
  const staff = env.ORDER_NOTIFY_EMAIL || env.SALES_EMAIL || env.ADMIN_EMAIL;
  if (!staff) return;
  await sendEmail(env, {
    to: [staff],
    subject: `⚠ Stripe dispute opened (${plan.reason})`,
    html: billingEmailHtml(env, 'A card dispute was opened', [
      `Charge <b>${htmlEscape(plan.chargeId || '?')}</b> (${plan.currency} ${plan.amount.toFixed(2)}) was disputed — reason <b>${htmlEscape(plan.reason)}</b>, status ${htmlEscape(plan.status)}.`,
      orderId
        ? `Linked order <b>${htmlEscape(orderId)}</b>. Respond in the Stripe dashboard before the evidence deadline.`
        : 'No local order matched this payment intent. Respond in the Stripe dashboard before the evidence deadline.',
    ]),
    category: 'billing',
  });
}
