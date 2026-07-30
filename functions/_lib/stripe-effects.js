import { adminClient, companyEmails, htmlEscape, sendEmail } from './supabase.js';
import { technicalDocumentRequestNoteHtml } from './order-email.js';

const PAYLOAD_KEYS = Object.freeze({
  stock_decrement: new Set(['order_id']),
  oversell_alert: new Set(['order_id']),
  order_confirmation: new Set(['order_id', 'pending', 'discount']),
  ach_failure_email: new Set(['order_id']),
  company_notification: new Set([
    'kind',
    'company_id',
    'order_id',
    'currency',
    'total',
    'tier',
    'amount',
  ]),
  billing_failure_email: new Set([
    'company_id',
    'amount_due',
    'currency',
    'attempt',
    'will_retry',
    'next_attempt_iso',
  ]),
  billing_recovery_email: new Set(['company_id', 'amount_paid', 'currency']),
  dispute_alert: new Set([
    'order_id',
    'charge_id',
    'amount',
    'currency',
    'reason',
    'status',
  ]),
});

function effect(effectKey, effectType, payload, dependsOnEffectKey = null) {
  return {
    effect_key: effectKey,
    effect_type: effectType,
    depends_on_effect_key: dependsOnEffectKey,
    payload,
  };
}

function companyNotification(effectKey, kind, values) {
  if (!values.companyId) return null;
  const payload = { kind, company_id: values.companyId };
  if (values.orderId) payload.order_id = values.orderId;
  if (values.currency) payload.currency = values.currency;
  if (Number.isFinite(Number(values.total))) payload.total = Number(values.total);
  if (values.tier) payload.tier = values.tier;
  if (Number.isFinite(Number(values.amount))) payload.amount = Number(values.amount);
  return effect(effectKey, 'company_notification', payload);
}

export function checkoutOrderEffects({
  orderId,
  companyId = null,
  stage,
  currency = 'USD',
  total = 0,
  discount = 0,
}) {
  const effects = [];
  if (stage === 'card' || stage === 'ach_succeeded') {
    effects.push(effect('stock-decrement', 'stock_decrement', { order_id: orderId }));
    effects.push(effect(
      'oversell-alert',
      'oversell_alert',
      { order_id: orderId },
      'stock-decrement',
    ));
  }
  effects.push(effect('buyer-confirmation', 'order_confirmation', {
    order_id: orderId,
    pending: stage === 'ach_pending',
    discount: Number(discount) || 0,
  }));
  const notification = companyNotification(
    stage === 'ach_succeeded' ? 'company-payment-cleared' : 'company-order-received',
    stage === 'ach_succeeded' ? 'payment_cleared' : 'order_received',
    { companyId, orderId, currency, total },
  );
  if (notification) effects.push(notification);
  return effects;
}

export function achFailedEffects({ orderId, companyId = null }) {
  const effects = [effect('buyer-ach-failure', 'ach_failure_email', { order_id: orderId })];
  const notification = companyNotification(
    'company-payment-failed',
    'payment_failed',
    { companyId, orderId },
  );
  if (notification) effects.push(notification);
  return effects;
}

export function subscriptionActivationEffects({ companyId = null, tier = null }) {
  const notification = companyNotification(
    'company-program-active',
    'program_active',
    { companyId, tier },
  );
  return notification ? [notification] : [];
}

export function billingFailureEffects({
  companyId = null,
  amountDue = 0,
  currency = 'USD',
  attempt = 0,
  willRetry = false,
  nextAttemptIso = null,
}) {
  const effects = [effect('billing-failure-email', 'billing_failure_email', {
    company_id: companyId,
    amount_due: Number(amountDue) || 0,
    currency,
    attempt: Number(attempt) || 0,
    will_retry: Boolean(willRetry),
    next_attempt_iso: nextAttemptIso,
  })];
  const notification = companyNotification(
    'company-billing-failed',
    'billing_failed',
    { companyId, currency, amount: amountDue },
  );
  if (notification) effects.push(notification);
  return effects;
}

export function billingRecoveryEffects({
  companyId = null,
  amountPaid = 0,
  currency = 'USD',
}) {
  const effects = [effect('billing-recovery-email', 'billing_recovery_email', {
    company_id: companyId,
    amount_paid: Number(amountPaid) || 0,
    currency,
  })];
  const notification = companyNotification(
    'company-billing-recovered',
    'billing_recovered',
    { companyId },
  );
  if (notification) effects.push(notification);
  return effects;
}

export function disputeEffects({
  orderId = null,
  chargeId = null,
  amount = 0,
  currency = 'USD',
  reason = 'unknown',
  status = 'needs_response',
}) {
  return [effect('dispute-alert', 'dispute_alert', {
    order_id: orderId,
    charge_id: chargeId,
    amount: Number(amount) || 0,
    currency,
    reason,
    status,
  })];
}

function cleanPayload(effectType, payload) {
  const allowed = PAYLOAD_KEYS[effectType];
  if (!allowed) throw new Error(`unknown Stripe effect type: ${effectType}`);
  const clean = JSON.parse(JSON.stringify(payload || {}));
  for (const key of Object.keys(clean)) {
    if (!allowed.has(key)) {
      throw new Error(`unexpected payload key "${key}" for ${effectType}`);
    }
  }
  return clean;
}

export function toStripeEffectRows(stripeEventId, effects) {
  const eventId = String(stripeEventId || '').trim();
  if (!eventId || eventId.length > 255) throw new Error('invalid Stripe event id');
  const source = Array.isArray(effects) ? effects : [];
  const keys = new Set();
  const rows = source.map((entry) => {
    const effectKey = String(entry?.effect_key || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(effectKey)) {
      throw new Error(`invalid Stripe effect key: ${effectKey}`);
    }
    if (keys.has(effectKey)) throw new Error(`duplicate Stripe effect key: ${effectKey}`);
    keys.add(effectKey);
    return {
      stripe_event_id: eventId,
      effect_key: effectKey,
      effect_type: entry.effect_type,
      payload: cleanPayload(entry.effect_type, entry.payload),
      depends_on_effect_key: entry.depends_on_effect_key || null,
    };
  });
  for (const row of rows) {
    if (row.depends_on_effect_key && !keys.has(row.depends_on_effect_key)) {
      throw new Error(`missing Stripe effect dependency: ${row.depends_on_effect_key}`);
    }
  }
  return rows;
}

export async function enqueueStripeEffects(sb, stripeEventId, effects) {
  let rows;
  try {
    rows = toStripeEffectRows(stripeEventId, effects);
  } catch (error) {
    return { error };
  }
  if (!rows.length) return { error: null };
  try {
    const { error } = await sb.from('stripe_webhook_effects').upsert(rows, {
      onConflict: 'stripe_event_id,effect_key',
      ignoreDuplicates: true,
    });
    return { error: error || null };
  } catch (error) {
    return { error };
  }
}

export function effectIdempotencyKey(effectRow) {
  return `stripe/${effectRow.stripe_event_id}/${effectRow.effect_key}`;
}

function errorWithCode(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function rpcData(sb, name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw errorWithCode(`${name}_failed`);
  return data;
}

async function loadOrder(sb, orderId) {
  const { data: order, error: orderError } = await sb.from('orders')
    .select('id,status,customer_email,subtotal,shipping,tax,total,currency,purchase_order_number,ship_address')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError || !order) throw errorWithCode('effect_order_not_found');
  const { data: items, error: itemsError } = await sb.from('order_items')
    .select('sku,name,qty,unit_price,backordered')
    .eq('order_id', orderId);
  if (itemsError) throw errorWithCode('effect_order_items_failed');
  return { order, lines: items || [] };
}

function billingEmailHtml(env, heading, paragraphs, cta) {
  const body = (paragraphs || [])
    .map((paragraph) => `<p style="margin:0 0 14px;color:#445;font-size:14px;line-height:1.6">${paragraph}</p>`)
    .join('');
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

function programsUrl(env) {
  return `${env.APP_URL || 'https://masest.co'}/dashboard.html#programs`;
}

function addressOf(order) {
  const value = order?.ship_address;
  return value?.address || value || null;
}

async function sendOrderConfirmationEffect(env, sb, effectRow, send) {
  const { order, lines } = await loadOrder(sb, effectRow.payload.order_id);
  if (order.status === 'cancelled' || order.status === 'refunded') return true;
  if (!order.customer_email) throw errorWithCode('effect_order_email_missing');
  const pending = Boolean(effectRow.payload.pending);
  const currency = (order.currency || 'usd').toUpperCase();
  const money = (value) => `${currency} ${Number(value || 0).toFixed(2)}`;
  const ref = order.id ? ` #${order.id}` : '';
  const rows = lines.map((line) =>
    `<tr>`
    + `<td style="padding:8px 0;border-bottom:1px solid #eef">${htmlEscape(line.name)} `
    + `<span style="color:#789">(${htmlEscape(line.sku)})</span></td>`
    + `<td style="padding:8px 0;border-bottom:1px solid #eef;text-align:center">${line.qty}</td>`
    + `<td style="padding:8px 0;border-bottom:1px solid #eef;text-align:right">${money(line.unit_price * line.qty)}</td>`
    + '</tr>').join('');
  const address = addressOf(order);
  const shipBlock = address
    ? `<p style="margin:18px 0 0;color:#445"><b>Ship to</b><br>${[
      address.line1,
      address.line2,
      [address.city, address.state, address.postal_code].filter(Boolean).join(', '),
      address.country,
    ].filter(Boolean).map(htmlEscape).join('<br>')}</p>`
    : '';
  const appUrl = env.APP_URL || 'https://masest.co';
  const documentNote = technicalDocumentRequestNoteHtml(appUrl);
  const discount = Number(effectRow.payload.discount) || 0;
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
        ${order.purchase_order_number ? `<p style="margin:0 0 20px;color:#556;font-size:14px"><b>Purchase order:</b> ${htmlEscape(order.purchase_order_number)}</p>` : ''}
        ${documentNote}
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead><tr>
            <th style="text-align:left;padding:6px 0;border-bottom:2px solid #d7e3e3">Product</th>
            <th style="text-align:center;padding:6px 0;border-bottom:2px solid #d7e3e3">Qty</th>
            <th style="text-align:right;padding:6px 0;border-bottom:2px solid #d7e3e3">Amount</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:10px">
          <tr><td style="padding:3px 0;color:#556">Subtotal</td><td style="padding:3px 0;text-align:right">${money(order.subtotal)}</td></tr>
          ${discount > 0 ? `<tr><td style="padding:3px 0;color:#556">Discount</td><td style="padding:3px 0;text-align:right">&minus;${money(discount)}</td></tr>` : ''}
          ${Number(order.shipping) > 0 ? `<tr><td style="padding:3px 0;color:#556">Shipping</td><td style="padding:3px 0;text-align:right">${money(order.shipping)}</td></tr>` : ''}
          <tr><td style="padding:3px 0;color:#556">Tax</td><td style="padding:3px 0;text-align:right">${money(order.tax)}</td></tr>
          <tr><td style="padding:6px 0;font-weight:bold;border-top:1px solid #ccd">Total</td><td style="padding:6px 0;text-align:right;font-weight:bold;border-top:1px solid #ccd">${money(order.total)}</td></tr>
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
  return send(env, {
    to: [order.customer_email],
    bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
    subject: pending
      ? `Your MASEST order${ref} is received (payment processing)`
      : `Your MASEST order${ref} is confirmed`,
    html,
    category: 'order',
    idempotencyKey: effectIdempotencyKey(effectRow),
  });
}

async function dependencyResult(sb, effectRow) {
  const { data, error } = await sb.from('stripe_webhook_effects')
    .select('provider_result')
    .eq('stripe_event_id', effectRow.stripe_event_id)
    .eq('effect_key', effectRow.depends_on_effect_key)
    .maybeSingle();
  if (error || !data) throw errorWithCode('effect_dependency_missing');
  return data.provider_result || {};
}

async function sendOversellEffect(env, sb, effectRow, send) {
  const result = await dependencyResult(sb, effectRow);
  const shorted = Array.isArray(result.shorted_skus) ? result.shorted_skus : [];
  if (!shorted.length) return true;
  const staff = env.ORDER_NOTIFY_EMAIL || env.SALES_EMAIL || env.ADMIN_EMAIL;
  if (!staff) throw errorWithCode('effect_staff_email_missing');
  const { order } = await loadOrder(sb, effectRow.payload.order_id);
  return send(env, {
    to: [staff],
    subject: `⚠ Oversell on paid order ${order.id || '?'}`,
    html: billingEmailHtml(env, 'Paid order exceeds available stock', [
      `Order <b>${htmlEscape(order.id || '?')}</b> was paid, but inventory could not cover: <b>${shorted.map(htmlEscape).join(', ')}</b>.`,
      'Stock was not decremented for those lines. Restock and ship, split the shipment, or refund the affected lines from the admin orders tab.',
    ]),
    category: 'order',
    idempotencyKey: effectIdempotencyKey(effectRow),
  });
}

async function sendAchFailureEffect(env, sb, effectRow, send) {
  const { order } = await loadOrder(sb, effectRow.payload.order_id);
  if (!order.customer_email) throw errorWithCode('effect_order_email_missing');
  return send(env, {
    to: [order.customer_email],
    bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
    subject: `Your MASEST order #${order.id} could not be completed`,
    html: billingEmailHtml(env, 'Your bank payment didn’t go through', [
      `The bank (ACH) payment for order <b>${htmlEscape(order.id)}</b> failed, so the order was cancelled and nothing will ship.`,
      'No products were charged to you beyond the failed debit. To reorder, return to the cart and pay by card, or reply to this email for help.',
    ], { url: `${env.APP_URL || 'https://masest.co'}/cart.html`, text: 'Return to cart' }),
    category: 'order',
    idempotencyKey: effectIdempotencyKey(effectRow),
  });
}

async function sendBillingFailureEffect(env, sb, effectRow, send) {
  const payload = effectRow.payload;
  const amount = `${payload.currency} ${Number(payload.amount_due || 0).toFixed(2)}`;
  const retryLine = payload.will_retry && payload.next_attempt_iso
    ? `We'll retry automatically on ${htmlEscape(payload.next_attempt_iso.slice(0, 10))}. To avoid any interruption, please make sure the card on file is current.`
    : 'This was the final automatic retry. Please update your payment method now to keep your program active.';
  const recipients = payload.company_id
    ? await companyEmails(sb, payload.company_id, 'billing')
    : [];
  return send(env, {
    to: recipients,
    bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
    subject: 'Action needed: your MASEST payment failed',
    html: billingEmailHtml(env, 'Your payment didn’t go through', [
      `We couldn’t collect <b>${amount}</b> for your MASEST program subscription (attempt ${payload.attempt}).`,
      retryLine,
    ], { url: programsUrl(env), text: 'Update payment method' }),
    category: 'billing',
    idempotencyKey: effectIdempotencyKey(effectRow),
  });
}

async function sendBillingRecoveryEffect(env, sb, effectRow, send) {
  const payload = effectRow.payload;
  const recipients = payload.company_id
    ? await companyEmails(sb, payload.company_id, 'billing')
    : [];
  return send(env, {
    to: recipients,
    subject: 'Your MASEST subscription is active again',
    html: billingEmailHtml(env, 'Payment received — you’re all set', [
      `We collected <b>${payload.currency} ${Number(payload.amount_paid || 0).toFixed(2)}</b> and your program subscription is active again.`,
      'No further action is needed. Thank you for being a MASEST customer.',
    ], { url: programsUrl(env), text: 'View your programs' }),
    category: 'billing',
    idempotencyKey: effectIdempotencyKey(effectRow),
  });
}

async function sendDisputeEffect(env, effectRow, send) {
  const payload = effectRow.payload;
  const staff = env.ORDER_NOTIFY_EMAIL || env.SALES_EMAIL || env.ADMIN_EMAIL;
  if (!staff) throw errorWithCode('effect_staff_email_missing');
  return send(env, {
    to: [staff],
    subject: `⚠ Stripe dispute opened (${payload.reason})`,
    html: billingEmailHtml(env, 'A card dispute was opened', [
      `Charge <b>${htmlEscape(payload.charge_id || '?')}</b> (${payload.currency} ${Number(payload.amount || 0).toFixed(2)}) was disputed — reason <b>${htmlEscape(payload.reason)}</b>, status ${htmlEscape(payload.status)}.`,
      payload.order_id
        ? `Linked order <b>${htmlEscape(payload.order_id)}</b>. Respond in the Stripe dashboard before the evidence deadline.`
        : 'No local order matched this payment intent. Respond in the Stripe dashboard before the evidence deadline.',
    ]),
    category: 'billing',
    idempotencyKey: effectIdempotencyKey(effectRow),
  });
}

function notificationFromEffect(effectRow) {
  const payload = effectRow.payload;
  switch (payload.kind) {
    case 'program_active':
      return {
        company_id: payload.company_id,
        type: 'account',
        title: `${payload.tier || 'Program'} program active`,
        body: 'Your VertKleen service program is now active.',
        link: '/dashboard.html#business',
      };
    case 'order_received':
      return {
        company_id: payload.company_id,
        type: 'order',
        title: 'Order received',
        body: `We received your order (${String(payload.currency || 'USD').toUpperCase()} ${Number(payload.total || 0).toFixed(2)}) and are processing it.`,
        link: '/dashboard.html#orders',
      };
    case 'payment_cleared':
      return {
        company_id: payload.company_id,
        type: 'order',
        title: 'Payment cleared',
        body: 'Your bank payment cleared and the order is confirmed.',
        link: '/dashboard.html#orders',
      };
    case 'payment_failed':
      return {
        company_id: payload.company_id,
        type: 'order',
        title: 'Payment failed',
        body: 'A bank payment for your order failed, so the order was cancelled.',
        link: '/dashboard.html#orders',
      };
    case 'billing_failed':
      return {
        company_id: payload.company_id,
        type: 'account',
        title: 'Payment failed',
        body: `A subscription payment of ${payload.currency} ${Number(payload.amount || 0).toFixed(2)} could not be collected.`,
        link: '/dashboard.html#programs',
      };
    case 'billing_recovered':
      return {
        company_id: payload.company_id,
        type: 'account',
        title: 'Payment received',
        body: 'Your subscription is active again. Thank you.',
        link: '/dashboard.html#programs',
      };
    default:
      throw errorWithCode('unknown_notification_kind');
  }
}

export async function deliverStripeEffect({ env, sb, effect: effectRow }, dependencies = {}) {
  const send = dependencies.sendEmail || sendEmail;
  if (effectRow.effect_type === 'stock_decrement') {
    await rpcData(sb, 'apply_stripe_stock_effect', {
      p_effect_id: effectRow.id,
      p_worker_id: effectRow.lease_owner,
    });
    return { providerRecorded: true };
  }
  if (effectRow.effect_type === 'company_notification') {
    await rpcData(sb, 'deliver_stripe_notification_effect', {
      p_effect_id: effectRow.id,
      p_worker_id: effectRow.lease_owner,
      p_notification: notificationFromEffect(effectRow),
    });
    return { providerRecorded: true };
  }

  let delivered;
  if (effectRow.effect_type === 'order_confirmation') {
    delivered = await sendOrderConfirmationEffect(env, sb, effectRow, send);
  } else if (effectRow.effect_type === 'oversell_alert') {
    delivered = await sendOversellEffect(env, sb, effectRow, send);
  } else if (effectRow.effect_type === 'ach_failure_email') {
    delivered = await sendAchFailureEffect(env, sb, effectRow, send);
  } else if (effectRow.effect_type === 'billing_failure_email') {
    delivered = await sendBillingFailureEffect(env, sb, effectRow, send);
  } else if (effectRow.effect_type === 'billing_recovery_email') {
    delivered = await sendBillingRecoveryEffect(env, sb, effectRow, send);
  } else if (effectRow.effect_type === 'dispute_alert') {
    delivered = await sendDisputeEffect(env, effectRow, send);
  } else {
    throw errorWithCode('unknown_stripe_effect_type');
  }
  if (delivered !== true) throw errorWithCode('effect_provider_failed');
  return { providerRecorded: false };
}

function errorCode(error) {
  return String(error?.code || error?.name || 'effect_failed')
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, '_')
    .slice(0, 80);
}

export async function runStripeEffectsWorker({
  env,
  sb = adminClient(env),
  workerId,
  limit = 10,
  leaseSeconds = 60,
}, dependencies = {}) {
  const deliverEffect = dependencies.deliverEffect || deliverStripeEffect;
  const batchLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);
  const boundedLeaseSeconds = Math.min(Math.max(Number(leaseSeconds) || 60, 15), 900);
  const summary = {
    claimed: 0,
    completed: 0,
    retried: 0,
    dead: 0,
  };
  // Claim one at a time so later rows do not burn their leases while earlier provider
  // calls run. The invocation remains bounded by batchLimit.
  for (let index = 0; index < batchLimit; index++) {
    const claimed = await rpcData(sb, 'claim_stripe_webhook_effects', {
      p_worker_id: workerId,
      p_limit: 1,
      p_lease_seconds: boundedLeaseSeconds,
    });
    if (!Array.isArray(claimed) || !claimed.length) break;
    const effectRow = claimed[0];
    summary.claimed += 1;
    try {
      if (!effectRow.provider_succeeded_at) {
        const outcome = await deliverEffect({ env, sb, effect: effectRow });
        if (!outcome?.providerRecorded) {
          const recorded = await rpcData(sb, 'record_stripe_webhook_effect_success', {
            p_effect_id: effectRow.id,
            p_worker_id: workerId,
            p_result: {},
          });
          if (recorded !== true) throw errorWithCode('effect_success_record_failed');
        }
      }
      const completed = await rpcData(sb, 'complete_stripe_webhook_effect', {
        p_effect_id: effectRow.id,
        p_worker_id: workerId,
      });
      if (completed !== true) throw errorWithCode('effect_completion_failed');
      summary.completed += 1;
    } catch (error) {
      const status = await rpcData(sb, 'retry_stripe_webhook_effect', {
        p_effect_id: effectRow.id,
        p_worker_id: workerId,
        p_error_code: errorCode(error),
        p_max_attempts: 8,
        p_base_backoff_seconds: 30,
      });
      if (status === 'dead') summary.dead += 1;
      else summary.retried += 1;
    }
  }
  return summary;
}
