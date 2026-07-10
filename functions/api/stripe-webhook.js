// POST /api/stripe-webhook — Stripe event sink. Verifies signature, records paid orders.
// Configure in Stripe Dashboard → Webhooks → endpoint <your-domain>/api/stripe-webhook,
// events checkout.session.completed + checkout.session.async_payment_succeeded +
// checkout.session.async_payment_failed (the async pair settles ACH debits that clear
// or fail days after the session completes). Signing secret in STRIPE_WEBHOOK_SECRET.
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
import { qboFullDocumentRefund } from '../_lib/refund.js';
import {
  centsToAmount,
  assembleCartMetadata,
  parseCartMetadata,
  orderRowFromSession,
  cartLines,
  orderItemRows,
  stockDecrements,
  isSubscriptionCheckout,
  subscriptionRow,
  qboSubscriptionInvoiceRow,
} from '../_lib/order-shape.js';

export { htmlEscape as escapeHtml } from '../_lib/supabase.js';

// Postgres unique-constraint violation (e.g. the orders.stripe_payment_intent guard).
export function isUniqueViolation(error) {
  return error?.code === '23505';
}

// Classify the atomic paid-order transaction so the webhook reacts correctly to each outcome:
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
// pending=true is the ACH variant: the debit is still processing, so the copy says
// "received" not "confirmed" and a distinct idempotency key lets the real
// confirmation follow once async_payment_succeeded lands.
async function sendOrderConfirmation({ env, session, order, lines, subtotal, tax, total, pending = false }) {
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
        <h2 style="margin:0 0 4px;color:#15171c">${pending ? `Order received${htmlEscape(ref)}` : `Order confirmed${htmlEscape(ref)}`}</h2>
        <p style="margin:0 0 20px;color:#556;font-size:14px;line-height:1.5">${pending
          ? 'Thank you. Your bank payment is processing — we’ll email a confirmation once it clears (usually within a few business days). MASEST will reconcile freight and documentation before fulfillment.'
          : 'Thank you. MASEST will reconcile freight and documentation before fulfillment. Your payment processor sends a separate card receipt.'}</p>
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
          ${centsToAmount(session.total_details?.amount_discount) > 0 ? `<tr><td style="padding:3px 0;color:#556">Discount</td><td style="padding:3px 0;text-align:right">&minus;${fmt(centsToAmount(session.total_details.amount_discount))}</td></tr>` : ''}
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
  const keyPrefix = pending ? 'order-received' : 'order-confirm';
  await sendEmail(env, {
    to: [to],
    bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
    subject: pending ? `Your MASEST order${ref} is received (payment processing)` : `Your MASEST order${ref} is confirmed`,
    html,
    category: 'order',
    attachments,
    // Stripe retries checkout.session.completed; key on the order so a retry can't re-send.
    idempotencyKey: order?.id ? `${keyPrefix}:${order.id}` : (session?.id ? `${keyPrefix}:${session.id}` : null),
  });
}

// Compact cart metadata carries no display names (Stripe's 500-char cap); resolve them
// from product_variants once per order. Best-effort — the SKU fallback is acceptable.
async function enrichLineNames(sb, lines) {
  const skus = (lines || []).filter((l) => l.sku && (!l.name || l.name === l.sku)).map((l) => l.sku);
  if (!skus.length) return;
  try {
    const { data } = await sb.from('product_variants').select('vsku,label,products(name)').in('vsku', skus);
    const names = new Map((data || []).map((v) => [v.vsku, v.products?.name ? `${v.products.name} - ${v.label || 'Each'}` : null]));
    for (const l of lines) {
      const name = names.get(l.sku);
      if (name && (!l.name || l.name === l.sku)) l.name = name;
    }
  } catch (e) {
    console.error('line_name_enrich_failed', e?.message || e);
  }
}

// Best-effort stock decrement for paid lines. Product-level (matches the admin stock UI). Never throws:
// inventory drift must not fail the webhook (Stripe would retry the whole event).
// Returns the SKUs whose decrement failed or was refused (RPC returns false when
// stock < qty) — the buyer already paid, so staff must be alerted to the oversell.
async function decrementVariantStock(sb, lines) {
  const shorted = [];
  for (const args of stockDecrements(lines)) {
    try {
      const { data, error } = await sb.rpc('decrement_variant_stock', args);
      if (error || data !== true) {
        shorted.push(args.p_vsku);
        if (error) console.error('stock_decrement_failed', args.p_vsku, error.message);
      }
    } catch (e) {
      shorted.push(args.p_vsku);
      console.error('stock_decrement_failed', args.p_vsku, e?.message || e);
    }
  }
  return shorted;
}

// A paid order hit insufficient stock (two buyers raced for the last units). The money
// already moved, so this can only be resolved by a human: restock, partial-ship, or refund.
async function alertStaffOversell(env, order, shortedSkus) {
  const staff = env.ORDER_NOTIFY_EMAIL || env.SALES_EMAIL || env.ADMIN_EMAIL;
  if (!staff) return;
  await sendEmail(env, {
    to: [staff],
    subject: `⚠ Oversell on paid order ${order?.id || '?'}`,
    html: billingEmailHtml(env, 'Paid order exceeds available stock', [
      `Order <b>${htmlEscape(order?.id || '?')}</b> was paid, but inventory could not cover: <b>${shortedSkus.map(htmlEscape).join(', ')}</b>.`,
      'Stock was not decremented for those lines. Restock and ship, split the shipment, or refund the affected lines from the admin orders tab.',
    ]),
    category: 'order',
    idempotencyKey: order?.id ? `oversell:${order.id}` : null,
  });
}

function qboRefundRowsFromCharge(charge, order, plan) {
  if (!order?.id || !plan?.amount) return [];
  const total = Number(order.total) || 0;
  const refunds = Array.isArray(charge?.refunds?.data) ? charge.refunds.data : [];
  const rows = refunds
    .filter((refund) => refund?.id && Number(refund.amount || 0) > 0 && refund.status !== 'failed' && refund.status !== 'canceled')
    .map((refund) => {
      const amount = centsToAmount(refund.amount);
      return {
        order_id: order.id,
        amount,
        fully_refunded: qboFullDocumentRefund({ total, refundedAmount: 0, amount }),
        stripe_refund_id: refund.id,
      };
    });
  if (rows.length) return rows;
  const syntheticId = charge?.id ? `charge:${charge.id}:refunded:${plan.refundedAmount}` : null;
  return [{
    order_id: order.id,
    amount: plan.amount,
    fully_refunded: qboFullDocumentRefund({ total, refundedAmount: order.refunded_amount, amount: plan.amount }),
    stripe_refund_id: syntheticId,
  }];
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
  } catch {
    // Signature failures are unauthenticated input. Do not reflect Stripe parser
    // details that could help an attacker distinguish configuration or payload issues.
    return json(400, { error: 'invalid_signature' });
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

    const cart = parseCartMetadata(assembleCartMetadata(s.metadata));
    const subtotal = centsToAmount(s.amount_subtotal);
    const tax = centsToAmount(s.total_details?.amount_tax);
    const total = centsToAmount(s.amount_total);
    // ACH debits complete with payment_status 'unpaid' and settle (or fail) days later
    // via the async_payment_* events. Until then: order is pending_payment, stock stays
    // untouched, and the buyer gets a "received" email instead of a confirmation.
    const settled = !s.payment_status || s.payment_status === 'paid';

    // Cart keys are variant SKUs; compact metadata has no names — resolve from the DB
    // before persistence so the header and all historical line snapshots commit together.
    let lines = cart.length ? cartLines(cart) : [];
    if (lines.length) await enrichLineNames(sb, lines);
    const itemRows = orderItemRows(lines, null);
    const { data: persisted, error: persistErr } = await sb.rpc('persist_stripe_order', {
      p_order: orderRowFromSession(s, buyerEmailFromStripeSession(s)),
      p_items: itemRows,
    });
    const order = persisted?.id ? { id: persisted.id } : null;
    const orderErr = persistErr || (order ? null : { message: 'persist_stripe_order returned no id' });

    const insertOutcome = classifyOrderInsert(orderErr);
    // A concurrent Stripe delivery already inserted this payment's order: idempotent success.
    if (insertOutcome === 'duplicate') return json(200, { received: true, duplicate: true });
    // Transient/DB failure persisting the order: do NOT ack. Return a 5xx so Stripe
    // re-delivers the event — acking 200 here would lose a paid order with no fulfillment.
    if (insertOutcome === 'error') {
      console.error('order_insert_failed', orderErr?.message || orderErr);
      return json(503, { error: 'order_persist_failed' });
    }

    // Branded order-confirmation email (Stripe also sends its own card receipt).
    await sendOrderConfirmation({ env, session: s, order, lines, subtotal, tax, total, pending: !settled });
    // Decrement inventory for stock-tracked SKUs (best-effort; never fails the webhook).
    // Deferred for unsettled ACH — async_payment_succeeded decrements when the money lands.
    if (order && lines.length && settled) {
      const shorted = await decrementVariantStock(sb, lines);
      if (shorted.length) {
        try { await alertStaffOversell(env, order, shorted); }
        catch (e) { console.error('oversell_alert_failed', e?.message || e); }
      }
    }
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

  // ACH debit cleared (days after checkout.session.completed): promote the pending
  // order to paid, decrement stock, and send the real confirmation.
  if (event.type === 'checkout.session.async_payment_succeeded') {
    const s = event.data.object;
    const sb = adminClient(env);
    if (isSubscriptionCheckout(s) || !s.payment_intent) return json(200, { received: true });
    const { data: order } = await sb.from('orders')
      .select('id,status,company_id')
      .eq('stripe_payment_intent', s.payment_intent).maybeSingle();
    // completed hasn't landed yet (out-of-order delivery): 5xx so Stripe re-delivers.
    if (!order) return json(503, { error: 'order_not_recorded_yet' });
    if (order.status !== 'pending_payment') return json(200, { received: true, duplicate: true });

    // qbo_sync_status was held at null while the debit processed; 'pending' releases
    // the order to the QBO invoice+payment worker now the money actually landed.
    const { error: updErr } = await sb.from('orders')
      .update({ status: 'paid', qbo_sync_status: 'pending' }).eq('id', order.id);
    if (updErr) return json(503, { error: 'order_update_failed' });

    const lines = cartLines(parseCartMetadata(assembleCartMetadata(s.metadata)));
    await enrichLineNames(sb, lines);
    if (lines.length) {
      const shorted = await decrementVariantStock(sb, lines);
      if (shorted.length) {
        try { await alertStaffOversell(env, order, shorted); }
        catch (e) { console.error('oversell_alert_failed', e?.message || e); }
      }
    }
    await sendOrderConfirmation({
      env, session: s, order, lines,
      subtotal: centsToAmount(s.amount_subtotal),
      tax: centsToAmount(s.total_details?.amount_tax),
      total: centsToAmount(s.amount_total),
    });
    if (order.company_id) {
      await sb.from('notifications').insert({
        company_id: order.company_id, type: 'order', title: 'Payment cleared',
        body: 'Your bank payment cleared and the order is confirmed.', link: '/dashboard.html#orders',
      }).then(() => {}, () => {});
    }
    return json(200, { received: true });
  }

  // ACH debit failed after the session completed: cancel the pending order (stock was
  // never decremented) and tell the buyer their order did not go through.
  if (event.type === 'checkout.session.async_payment_failed') {
    const s = event.data.object;
    const sb = adminClient(env);
    if (isSubscriptionCheckout(s) || !s.payment_intent) return json(200, { received: true });
    const { data: order } = await sb.from('orders')
      .select('id,status,company_id')
      .eq('stripe_payment_intent', s.payment_intent).maybeSingle();
    if (!order) return json(503, { error: 'order_not_recorded_yet' });
    if (order.status !== 'pending_payment') return json(200, { received: true, duplicate: true });

    await sb.from('orders').update({ status: 'cancelled' }).eq('id', order.id).then(() => {}, () => {});
    const to = buyerEmailFromStripeSession(s);
    if (to) {
      try {
        await sendEmail(env, {
          to: [to],
          bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
          subject: `Your MASEST order #${order.id} could not be completed`,
          html: billingEmailHtml(env, 'Your bank payment didn’t go through', [
            `The bank (ACH) payment for order <b>${htmlEscape(order.id)}</b> failed, so the order was cancelled and nothing will ship.`,
            'No products were charged to you beyond the failed debit. To reorder, return to the cart and pay by card, or reply to this email for help.',
          ], { url: `${env.APP_URL || 'https://masest.co'}/cart.html`, text: 'Return to cart' }),
          category: 'order',
          idempotencyKey: `order-achfail:${order.id}`,
        });
      } catch (e) { console.error('ach_fail_email', e?.message || e); }
    }
    if (order.company_id) {
      await sb.from('notifications').insert({
        company_id: order.company_id, type: 'order', title: 'Payment failed',
        body: 'A bank payment for your order failed, so the order was cancelled.', link: '/dashboard.html#orders',
      }).then(() => {}, () => {});
    }
    return json(200, { received: true });
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
    const { data: row, error: subscriptionError } = await sb.from('program_subscriptions')
      .select('status,company_id,tier').eq('stripe_subscription_id', inv.subscription).maybeSingle();
    if (subscriptionError) return json(503, { error: 'program_subscription_lookup_failed' });
    const qboRow = qboSubscriptionInvoiceRow(inv, { companyId: row?.company_id, tier: row?.tier });
    if (!qboRow.company_id) return json(503, { error: 'program_subscription_not_recorded_yet' });
    const { error: qboQueueError } = await sb.from('qbo_subscription_invoices')
      .upsert(qboRow, { onConflict: 'stripe_invoice_id', ignoreDuplicates: true });
    if (qboQueueError) return json(503, { error: 'qbo_subscription_queue_failed' });
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
        await enqueueQboRefundRows(sb, qboRefundRowsFromCharge(charge, order, plan));
      }
    }
    return json(200, { received: true });
  }

  return json(200, { received: true });
}

async function enqueueQboRefundRows(sb, rows) {
  if (!rows.length) return;
  const withIds = rows.filter((row) => row.stripe_refund_id);
  const withoutIds = rows.filter((row) => !row.stripe_refund_id);
  if (withIds.length) {
    await sb.from('qbo_refunds')
      .upsert(withIds, { onConflict: 'stripe_refund_id', ignoreDuplicates: true })
      .then(() => {}, () => {});
  }
  if (withoutIds.length) {
    await sb.from('qbo_refunds').insert(withoutIds).then(() => {}, () => {});
  }
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
