import {
  adminClient,
  companyEmails,
  emailLayout,
  htmlEscape,
  sendEmail,
  sendEmailResult,
} from './supabase.js';
import { renderCommerceEmail } from './email-renderers.js';
import { shipmentNotice } from './order-email.js';
import { orderReference } from './order-integrations.js';
import { computeRefund, qboFullDocumentRefund } from './refund.js';
import { linkOrderProviderObject } from './order-integrations.js';
import { getAccessToken, voidQboInvoice } from './qbo.js';
import { voidOrderLabel } from './shipstation-orders.js';
import {
  deliverSupportMessageEmail,
  isSupportEmailPolicySkip,
} from './support-email-delivery.js';
import Stripe from 'stripe';

async function defaultCreateStripeRefund(env, { paymentIntent, amountCents, idempotencyKey }) {
  if (!env?.STRIPE_SECRET_KEY) throw errorWithCode('stripe_not_configured');
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
  return stripe.refunds.create(
    { payment_intent: paymentIntent, amount: amountCents },
    { idempotencyKey },
  );
}

const PAYLOAD_KEYS = Object.freeze({
  stock_decrement: new Set(['order_id']),
  oversell_alert: new Set(['order_id']),
  order_confirmation: new Set(['order_id', 'pending', 'discount', 'store_credit']),
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
  shipstation_tracking_projection: new Set([
    'tracking_number',
    'tracking_status',
    'status_code',
    'event_code',
    'occurred_at',
    'note',
    'estimated_delivery_at',
    'event_key',
  ]),
  shipment_notification: new Set(['tracking_number', 'tracking_status']),
  order_label_void: new Set(['order_id', 'command_id', 'label_id', 'reason']),
  order_refund: new Set(['order_id', 'command_id', 'amount']),
  order_restock: new Set(['order_id', 'command_id']),
  order_accounting_reversal: new Set(['order_id', 'command_id']),
  order_refund_email: new Set(['order_id', 'command_id']),
  order_reversal_complete: new Set(['order_id', 'command_id']),
  order_credit_memo: new Set(['order_id']),
  order_cancelled: new Set(['order_id', 'command_id', 'reason']),
  order_cancellation_email: new Set(['order_id', 'command_id', 'reason']),
  quote_message: new Set(['quote_id', 'company_id']),
  quote_offer_email: new Set(['quote_id', 'email', 'product']),
  support_message_email: new Set(['message_id']),
  qbo_change_projection: new Set([
    'realm_id',
    'entity_name',
    'entity_id',
    'operation',
    'occurred_at',
  ]),
});

// Which provider inbox is allowed to emit each effect type. Keeping this beside
// PAYLOAD_KEYS means adding a workflow is one table edit, not a scattered provider check.
const STRIPE = Object.freeze(new Set(['stripe']));
// Staff-initiated workflows enter the ledger under the 'masest' inbox: same idempotency,
// retry, and timeline machinery as a provider webhook, but the trigger is an admin action.
const MASEST = Object.freeze(new Set(['masest']));
const EFFECT_PROVIDERS = Object.freeze({
  stock_decrement: STRIPE,
  oversell_alert: STRIPE,
  order_confirmation: STRIPE,
  ach_failure_email: STRIPE,
  billing_failure_email: STRIPE,
  billing_recovery_email: STRIPE,
  dispute_alert: STRIPE,
  company_notification: new Set(['stripe', 'masest']),
  shipment_notification: new Set(['shipstation']),
  order_label_void: MASEST,
  order_refund: MASEST,
  order_restock: MASEST,
  order_accounting_reversal: MASEST,
  order_refund_email: MASEST,
  order_reversal_complete: MASEST,
  order_credit_memo: MASEST,
  order_cancelled: MASEST,
  order_cancellation_email: MASEST,
  quote_message: MASEST,
  quote_offer_email: MASEST,
  support_message_email: MASEST,
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
  storeCredit = 0,
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
  const confirmationPayload = {
    order_id: orderId,
    pending: stage === 'ach_pending',
    discount: Number(discount) || 0,
  };
  const storeCreditAmount = Math.max(0, Number(storeCredit) || 0);
  if (storeCreditAmount > 0) confirmationPayload.store_credit = storeCreditAmount;
  effects.push(effect('buyer-confirmation', 'order_confirmation', confirmationPayload));
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

export function quoteOfferEffects({
  quoteId,
  companyId,
  email,
  product = '',
}) {
  return [
    companyNotification('quote-notification', 'quote_ready', { companyId }),
    effect('quote-message', 'quote_message', {
      quote_id: quoteId,
      company_id: companyId,
    }),
    effect('quote-email', 'quote_offer_email', {
      quote_id: quoteId,
      email: String(email || '').trim().toLowerCase(),
      product: String(product || '').trim().slice(0, 500),
    }),
  ].filter(Boolean).map((entry) => ({
    ...entry,
    aggregate_type: 'quote',
    aggregate_id: quoteId,
  }));
}

function cleanPayload(effectType, payload) {
  const allowed = PAYLOAD_KEYS[effectType];
  if (!allowed) throw new Error(`unknown integration effect type: ${effectType}`);
  const clean = JSON.parse(JSON.stringify(payload || {}));
  for (const key of Object.keys(clean)) {
    if (!allowed.has(key)) {
      throw new Error(`unexpected payload key "${key}" for ${effectType}`);
    }
  }
  return clean;
}

export function toIntegrationEffectRows(effects) {
  const source = Array.isArray(effects) ? effects : [];
  const keys = new Set();
  const rows = source.map((entry) => {
    const effectKey = String(entry?.effect_key || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(effectKey)) {
      throw new Error(`invalid integration effect key: ${effectKey}`);
    }
    if (keys.has(effectKey)) throw new Error(`duplicate integration effect key: ${effectKey}`);
    keys.add(effectKey);
    return {
      effect_key: effectKey,
      effect_type: entry.effect_type,
      aggregate_type: entry.aggregate_type || null,
      aggregate_id: entry.aggregate_id || null,
      payload: cleanPayload(entry.effect_type, entry.payload),
      depends_on_effect_key: entry.depends_on_effect_key || null,
      max_attempts: entry.max_attempts || 8,
    };
  });
  for (const row of rows) {
    if (row.depends_on_effect_key && !keys.has(row.depends_on_effect_key)) {
      throw new Error(`missing integration effect dependency: ${row.depends_on_effect_key}`);
    }
  }
  return rows;
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function ingestProviderEvent(sb, descriptor, rawBody, effects) {
  const provider = String(descriptor?.provider || '').trim().toLowerCase();
  const environmentOrTenant = String(descriptor?.environmentOrTenant || '').trim();
  const providerEventId = String(descriptor?.providerEventId || '').trim();
  const providerEventType = String(descriptor?.providerEventType || '').trim();
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(provider)) {
    return { error: new Error('invalid integration provider') };
  }
  if (!environmentOrTenant || environmentOrTenant.length > 128) {
    return { error: new Error('invalid integration environment') };
  }
  if (!providerEventId || providerEventId.length > 512) {
    return { error: new Error('invalid provider event id') };
  }
  if (!providerEventType || providerEventType.length > 160) {
    return { error: new Error('invalid provider event type') };
  }
  let rows;
  try {
    rows = toIntegrationEffectRows(effects);
  } catch (error) {
    return { error };
  }
  try {
    const { data, error } = await sb.rpc('ingest_provider_event', {
      p_provider: provider,
      p_environment_or_tenant: environmentOrTenant,
      p_provider_event_id: providerEventId,
      p_event_type: providerEventType,
      p_provider_object_id: String(descriptor?.providerObjectId || '').trim() || null,
      p_occurred_at: descriptor?.occurredAt || null,
      p_signature_verified_at: descriptor?.signatureVerifiedAt || new Date().toISOString(),
      p_payload_sha256: await sha256Hex(rawBody),
      p_metadata: descriptor?.metadata || {},
      p_effects: rows,
      p_transport_id: String(descriptor?.transportId || '').trim() || null,
    });
    return { data: data || null, error: error || null };
  } catch (error) {
    return { error };
  }
}

function stripeEventOccurredAt(stripeEvent) {
  const seconds = Number(stripeEvent?.created);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : null;
}

export async function enqueueIntegrationEffects(sb, stripeEvent, rawBody, effects) {
  const providerEventId = String(stripeEvent?.id || '').trim();
  const providerEventType = String(stripeEvent?.type || '').trim();
  if (!providerEventId || providerEventId.length > 512) {
    return { error: new Error('invalid Stripe event id') };
  }
  if (!providerEventType || providerEventType.length > 160) {
    return { error: new Error('invalid Stripe event type') };
  }
  const result = await ingestProviderEvent(sb, {
    provider: 'stripe',
    environmentOrTenant: stripeEvent?.livemode ? 'production' : 'test',
    providerEventId,
    providerEventType,
    providerObjectId: stripeEvent?.data?.object?.id,
    occurredAt: stripeEventOccurredAt(stripeEvent),
    metadata: { source: 'stripe_webhook' },
  }, rawBody, effects);
  return { error: result?.error || null };
}

export function effectIdempotencyKey(effectRow) {
  return `${effectRow.provider}/${effectRow.provider_event_id}/${effectRow.effect_key}`;
}

function errorWithCode(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function terminalErrorWithCode(code) {
  const error = errorWithCode(code);
  error.terminal = true;
  return error;
}

async function rpcData(sb, name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw errorWithCode(`${name}_failed`);
  return data;
}

async function loadOrder(sb, orderId) {
  const { data: order, error: orderError } = await sb.from('orders')
    .select('id,order_number,user_id,company_id,status,customer_email,subtotal,shipping,tax,total,refunded_amount,currency,purchase_order_number,ship_address')
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
  if (order.status === 'cancelled' || order.status === 'refunded') {
    return { skipped: 'order_terminal' };
  }
  if (!order.customer_email) throw errorWithCode('effect_order_email_missing');
  const pending = Boolean(effectRow.payload.pending);
  const reference = orderReference(order);
  const appUrl = String(env.APP_URL || 'https://masest.co').replace(/\/+$/, '');
  const discount = Number(effectRow.payload.discount) || 0;
  const storeCredit = Math.max(0, Number(effectRow.payload.store_credit) || 0);
  const originalSubtotal = Math.round((Number(order.subtotal || 0) + storeCredit) * 100) / 100;
  const rendered = renderCommerceEmail({
    event: 'confirmed',
    appUrl,
    order: {
      ...order,
      reference,
      subtotal: originalSubtotal,
      shipping_address: addressOf(order),
      viewUrl: order.user_id
        ? `${appUrl}/dashboard.html#orders`
        : `${appUrl}/contact.html?message=${encodeURIComponent(`Question about order ${reference || order.id}`)}`,
      ctaText: order.user_id ? 'View your order' : 'Get order help',
    },
    items: lines,
    payment: {
      pending,
      status: pending ? 'pending' : 'paid',
      label: pending ? 'Bank payment processing' : 'Paid',
    },
    adjustments: { discount, storeCredit },
    notes: ['MASEST will reconcile freight and required documentation before fulfillment.'],
  });
  return send(env, {
    to: [order.customer_email],
    bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    category: 'order',
    idempotencyKey: effectIdempotencyKey(effectRow),
  });
}

async function sendQuoteOfferEffect(env, effectRow, send) {
  const email = String(effectRow.payload?.email || '').trim().toLowerCase();
  if (!email) return { skipped: 'no_recipients' };
  const appUrl = String(env.APP_URL || 'https://masest.co').replace(/\/+$/, '');
  return send(env, {
    to: [email],
    subject: 'Your MASEST quote is ready',
    html: emailLayout({
      heading: 'Your quote is ready',
      bodyHtml: `<p>Review the pricing for ${htmlEscape(effectRow.payload?.product || 'your saved requisition')}, accept it, and continue to secure checkout.</p>`,
      ctaText: 'Review your quote',
      ctaUrl: `${appUrl}/dashboard.html#orders`,
    }),
    category: 'quote',
    idempotencyKey: effectIdempotencyKey(effectRow),
  });
}

async function dependencyResult(sb, effectRow) {
  const { data, error } = await sb.from('integration_effects')
    .select('provider_result')
    .eq('event_id', effectRow.event_id)
    .eq('effect_key', effectRow.depends_on_effect_key)
    .maybeSingle();
  if (error || !data) throw errorWithCode('effect_dependency_missing');
  return data.provider_result || {};
}

async function sendOversellEffect(env, sb, effectRow, send) {
  const result = await dependencyResult(sb, effectRow);
  if (result.skipped) return { skipped: result.skipped };
  const shorted = Array.isArray(result.shorted_skus) ? result.shorted_skus : [];
  if (!shorted.length) return { skipped: 'no_oversell' };
  const staff = env.ORDER_NOTIFY_EMAIL || env.SALES_EMAIL || env.ADMIN_EMAIL;
  if (!staff) throw errorWithCode('effect_staff_email_missing');
  const { order } = await loadOrder(sb, effectRow.payload.order_id);
  const reference = orderReference(order) || '?';
  return send(env, {
    to: [staff],
    subject: `⚠ Oversell on paid order ${reference}`,
    html: billingEmailHtml(env, 'Paid order exceeds available stock', [
      `Order <b>${htmlEscape(reference)}</b> was paid, but inventory could not cover: <b>${shorted.map(htmlEscape).join(', ')}</b>.`,
      'Stock was not decremented for those lines. Restock and ship, split the shipment, or refund the affected lines from the admin orders tab.',
    ]),
    category: 'order',
    idempotencyKey: effectIdempotencyKey(effectRow),
  });
}

// Carrier scan → buyer notice. The projection already decided whether this transition is
// worth an email; this effect only renders and delivers it. Recipients are the buyer plus
// the company's order contacts, deduped, exactly like the manual staff update.
async function sendShipmentNotificationEffect(env, sb, effectRow, send) {
  const projection = await dependencyResult(sb, effectRow);
  if (!projection.notify || !projection.order_id) {
    return { skipped: projection.skipped || 'no_notifiable_transition' };
  }
  const { data: order, error } = await sb.from('orders')
    .select('id,order_number,user_id,company_id,customer_email,carrier,tracking_number,tracking_url,estimated_delivery_at')
    .eq('id', projection.order_id)
    .maybeSingle();
  if (error || !order) throw errorWithCode('effect_order_not_found');
  const notice = shipmentNotice(projection.tracking_status, {
    carrier: order.carrier,
    trackingNumber: order.tracking_number,
  });
  const reference = orderReference(order);
  const appUrl = String(env.APP_URL || 'https://masest.co').replace(/\/+$/, '');
  const companyRecipients = order.company_id
    ? await companyEmails(sb, order.company_id, 'orders')
    : [];
  const recipients = [...new Set([order.customer_email, ...companyRecipients]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean))];
  if (!recipients.length) return { skipped: 'no_recipients' };
  if (order.company_id) {
    await sb.from('notifications').insert({
      company_id: order.company_id,
      type: 'order',
      title: `Order ${reference} ${notice.label}`,
      body: notice.body,
      link: '/dashboard.html#orders',
    }).then(() => {}, () => {});
  }
  const event = projection.tracking_status === 'delivered'
    ? 'delivered'
    : projection.tracking_status === 'shipped'
      ? 'shipped'
      : 'delivery_update';
  const rendered = renderCommerceEmail({
    event,
    appUrl,
    order,
    fulfillment: {
      label: notice.label,
      summary: notice.body,
      carrier: order.carrier,
      trackingNumber: order.tracking_number,
      trackingUrl: order.tracking_url,
      estimatedDelivery: order.estimated_delivery_at,
    },
  });
  return send(env, {
    to: recipients,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    category: 'order',
    idempotencyKey: effectIdempotencyKey(effectRow),
  });
}

// ── Cancellation chain ────────────────────────────────────────────────────────────────
// Each handler is idempotent on its own: re-running one after a lease expiry or a worker
// restart must not double-void, double-refund, or double-post.

async function voidLabelEffect(env, sb, effectRow, dependencies) {
  const labelId = effectRow.payload.label_id;
  if (!labelId) return { skipped: 'no_label_to_void' };
  const voidLabel = dependencies.voidOrderLabel || voidOrderLabel;
  const result = await voidLabel(env, {
    order_id: effectRow.payload.order_id,
    label_id: labelId,
    confirm: true,
    reason: effectRow.payload.reason || 'Order cancelled by MASEST staff',
  }, { user: { email: 'system@masest.co' } });
  // Success means the provider void was durably finalized, or canonical ownership was
  // reloaded and proved this exact label inactive. Refusals must block dependent effects.
  return { voided: true, label_id: labelId, refunded: result?.refunded ?? null };
}

async function loadReversalCommand(sb, effectRow) {
  const commandId = String(effectRow.payload?.command_id || '').trim();
  const orderId = String(effectRow.payload?.order_id || '').trim();
  if (!commandId || !orderId) throw errorWithCode('reversal_command_identity_missing');
  const { data: command, error } = await sb.from('order_reversal_commands')
    .select('id,order_id,type,status,amount_minor,currency,reason,provider_idempotency_key,provider_object_id,provider_result,accounting_result,snapshot')
    .eq('id', commandId)
    .eq('order_id', orderId)
    .maybeSingle();
  if (error || !command) throw errorWithCode('reversal_command_not_found');
  return command;
}

async function legacyRefundOrderEffect(env, sb, effectRow, dependencies) {
  const amount = Number(effectRow.payload.amount) || 0;
  if (amount <= 0) return { skipped: 'nothing_to_refund' };
  const { data: order, error } = await sb.from('orders')
    .select('id,order_number,total,refunded_amount,currency,status,payment_method,stripe_payment_intent,qbo_sync_status')
    .eq('id', effectRow.payload.order_id)
    .maybeSingle();
  if (error || !order) throw errorWithCode('effect_order_not_found');
  if (order.payment_method !== 'stripe' || !order.stripe_payment_intent) {
    return { skipped: 'not_stripe_paid' };
  }
  const plan = computeRefund({
    total: order.total,
    refundedAmount: order.refunded_amount,
    requestedAmount: amount,
  });
  // `already_refunded` here means a concurrent path (dashboard refund, Stripe webhook)
  // got there first. That is success, not failure.
  if (!plan.ok) return { skipped: plan.error };

  const createRefund = dependencies.createStripeRefund || defaultCreateStripeRefund;
  const refund = await createRefund(env, {
    paymentIntent: order.stripe_payment_intent,
    amountCents: plan.amountCents,
    // Same key shape the admin refund action uses, so a staff refund and a cancellation
    // refund for the same money settle once at Stripe rather than twice.
    idempotencyKey: `refund:${order.id}:${order.refunded_amount || 0}:${plan.amountCents}`,
  });
  if (!refund?.id) throw errorWithCode('stripe_refund_id_missing');

  await linkOrderProviderObject(sb, {
    orderId: order.id,
    provider: 'stripe',
    objectType: 'refund',
    providerObjectId: refund.id,
    metadata: { order_number: order.order_number, amount: plan.amount, currency: order.currency },
  }).catch(() => {});

  const patch = { refunded_amount: plan.newRefundedAmount };
  const { error: updateError } = await sb.from('orders').update(patch).eq('id', order.id);
  if (updateError) throw errorWithCode('refund_reconcile_failed');

  return {
    refunded: true,
    stripe_refund_id: refund.id,
    amount: plan.amount,
    fully_refunded: qboFullDocumentRefund({
      total: order.total,
      refundedAmount: order.refunded_amount,
      amount: plan.amount,
    }),
    qbo_sync_status: order.qbo_sync_status,
  };
}

async function refundOrderEffect(env, sb, effectRow, dependencies) {
  // Pre-cutover cancellation events carried an amount directly. Keep them drainable;
  // every new admin command carries only immutable command identity.
  if (!effectRow.payload?.command_id) {
    return legacyRefundOrderEffect(env, sb, effectRow, dependencies);
  }
  const command = await loadReversalCommand(sb, effectRow);
  const amountCents = Number(command.amount_minor);
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw errorWithCode('reversal_command_amount_invalid');
  }
  if (amountCents === 0) return { skipped: 'nothing_to_refund', command_id: command.id };
  if (command.provider_object_id) {
    if (!command.provider_result) throw errorWithCode('refund_provider_result_missing');
    return command.provider_result;
  }
  const paymentIntent = String(command.snapshot?.stripe_payment_intent || '').trim();
  const idempotencyKey = String(command.provider_idempotency_key || '').trim();
  if (!paymentIntent || !idempotencyKey) throw errorWithCode('refund_command_provider_identity_missing');

  const createRefund = dependencies.createStripeRefund || defaultCreateStripeRefund;
  const refund = await createRefund(env, { paymentIntent, amountCents, idempotencyKey });
  if (!refund?.id) throw errorWithCode('stripe_refund_id_missing');

  // Persist provider success and the cumulative Order projection under one DB lock before
  // returning to the generic effect worker. Response loss after this point reuses both the
  // command and Stripe idempotency key; it cannot add money twice.
  return rpcData(sb, 'record_order_refund_provider_success', {
    p_command_id: command.id,
    p_stripe_refund_id: refund.id,
  });
}

async function accountingReversalEffect(env, sb, effectRow, dependencies) {
  const command = await loadReversalCommand(sb, effectRow);
  if (command.accounting_result) return command.accounting_result;
  const accounting = command.snapshot?.accounting || {};
  const action = String(accounting.action || '').trim();
  if (action === 'review') throw errorWithCode('accounting_review_required');
  if (!['credit_memo', 'void_invoice', 'skip_pending_invoice', 'skip'].includes(action)) {
    throw errorWithCode('accounting_reversal_action_invalid');
  }

  let providerObjectId = null;
  let providerResult = {};
  if (action === 'void_invoice') {
    providerObjectId = String(accounting.document_id || '').trim();
    if (!providerObjectId) throw errorWithCode('accounting_document_identity_missing');
    const loadAccess = dependencies.getQboAccessToken || getAccessToken;
    const voidInvoice = dependencies.voidQboInvoice || voidQboInvoice;
    const credentials = await loadAccess(sb, env);
    const options = dependencies.fetch ? { fetchImpl: dependencies.fetch } : {};
    providerResult = await voidInvoice(
      env,
      credentials.accessToken,
      credentials.realmId,
      providerObjectId,
      options,
    );
  }
  return rpcData(sb, 'record_order_accounting_reversal_success', {
    p_command_id: command.id,
    p_action: action,
    p_provider_object_id: providerObjectId,
    p_result: providerResult,
  });
}

async function creditMemoEffect(sb, effectRow) {
  const refund = await dependencyResult(sb, effectRow);
  if (!refund.refunded || !refund.stripe_refund_id) {
    return { skipped: refund.skipped || 'no_refund_to_reverse' };
  }
  if (refund.qbo_sync_status === 'skipped') return { skipped: 'qbo_sync_skipped' };
  // qbo_refunds is unique on stripe_refund_id, so a replayed effect collides instead of
  // queueing a second credit memo.
  const { error } = await sb.from('qbo_refunds').insert({
    order_id: effectRow.payload.order_id,
    amount: refund.amount,
    fully_refunded: Boolean(refund.fully_refunded),
    stripe_refund_id: refund.stripe_refund_id,
  });
  if (error && error.code !== '23505') throw errorWithCode('qbo_refund_queue_failed');
  return { queued: true, duplicate: error?.code === '23505' };
}

function reversalRecipients(command) {
  const snapshot = command?.snapshot || {};
  const source = Array.isArray(snapshot.notification?.recipients)
    ? snapshot.notification.recipients
    : [snapshot.recipient, snapshot.notification?.buyer];
  return [...new Set(source
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)))];
}

async function sendRefundEmailEffect(env, sb, effectRow, send) {
  const command = await loadReversalCommand(sb, effectRow);
  if (!command.provider_object_id) throw errorWithCode('refund_provider_identity_missing');
  const recipients = reversalRecipients(command);
  if (!recipients.length) return { skipped: 'no_recipient' };
  const reference = String(command.snapshot?.order_number || command.order_id);
  const amount = Number(command.amount_minor) / 100;
  const currency = String(command.currency || 'usd');
  const fullyRefunded = command.provider_result?.fully_refunded === true;
  const totalMinor = Number(command.snapshot?.total_minor);
  const refundedBeforeMinor = Number(command.snapshot?.refunded_before_minor || 0);
  const remainingTotal = Number.isSafeInteger(totalMinor)
    ? Math.max(0, totalMinor - refundedBeforeMinor - Number(command.amount_minor)) / 100
    : undefined;
  const appUrl = String(env.APP_URL || 'https://masest.co').replace(/\/+$/, '');
  const rendered = renderCommerceEmail({
    event: 'refunded',
    appUrl,
    order: {
      id: command.order_id,
      order_number: reference,
      currency,
      viewUrl: `${appUrl}/contact.html?message=${encodeURIComponent(`Question about refund for order ${reference}`)}`,
      ctaText: 'Get refund help',
    },
    refund: {
      amount,
      currency,
      remainingTotal,
      methodLabel: 'the original payment method',
    },
    notes: fullyRefunded ? [] : ['This was a partial refund; unrefunded order items remain unchanged.'],
  });
  return send(env, {
    to: recipients,
    bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    category: 'order',
    idempotencyKey: effectIdempotencyKey(effectRow),
  });
}

async function sendCancellationEmailEffect(env, sb, effectRow, send) {
  if (effectRow.payload?.command_id) {
    const command = await loadReversalCommand(sb, effectRow);
    const recipients = reversalRecipients(command);
    if (!recipients.length) return { skipped: 'no_recipient' };
    const reference = String(command.snapshot?.order_number || command.order_id);
    const refunded = Number(command.amount_minor) / 100;
    const currency = String(command.currency || 'usd');
    const appUrl = String(env.APP_URL || 'https://masest.co').replace(/\/+$/, '');
    const rendered = renderCommerceEmail({
      event: 'canceled',
      appUrl,
      order: {
        id: command.order_id,
        order_number: reference,
        currency,
        viewUrl: `${appUrl}/contact.html?message=${encodeURIComponent(`Question about canceled order ${reference}`)}`,
        ctaText: 'Get order help',
      },
      refund: { amount: refunded, currency },
      notes: command.reason ? [`Reason: ${command.reason}`] : [],
    });
    return send(env, {
      to: recipients,
      bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      category: 'order',
      idempotencyKey: effectIdempotencyKey(effectRow),
    });
  }
  const cancellation = await dependencyResult(sb, effectRow);
  if (cancellation.skipped === 'already_refunded') return { skipped: 'already_refunded' };
  const { order } = await loadOrder(sb, effectRow.payload.order_id);
  if (!order.customer_email) return { skipped: 'no_recipient' };
  const reference = orderReference(order);
  const refunded = Number(order.refunded_amount) || 0;
  const currency = (order.currency || 'usd').toUpperCase();
  const reason = effectRow.payload.reason;
  const companyRecipients = effectRow.payload.order_id && order.company_id
    ? await companyEmails(sb, order.company_id, 'orders')
    : [];
  const recipients = [...new Set([order.customer_email, ...companyRecipients]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean))];
  const appUrl = String(env.APP_URL || 'https://masest.co').replace(/\/+$/, '');
  const rendered = renderCommerceEmail({
    event: 'canceled',
    appUrl,
    order: {
      ...order,
      reference,
      shipping_address: addressOf(order),
      viewUrl: order.user_id || order.company_id
        ? `${appUrl}/dashboard.html#orders`
        : `${appUrl}/contact.html?message=${encodeURIComponent(`Question about canceled order ${reference}`)}`,
      ctaText: order.user_id || order.company_id ? 'View order' : 'Get order help',
    },
    refund: { amount: refunded, currency },
    notes: reason ? [`Reason: ${reason}`] : [],
  });
  return send(env, {
    to: recipients,
    bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    category: 'order',
    idempotencyKey: effectIdempotencyKey(effectRow),
  });
}

async function sendAchFailureEffect(env, sb, effectRow, send) {
  const { order } = await loadOrder(sb, effectRow.payload.order_id);
  if (!order.customer_email) throw errorWithCode('effect_order_email_missing');
  const reference = orderReference(order);
  return send(env, {
    to: [order.customer_email],
    bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
    subject: `Your MASEST order #${reference} could not be completed`,
    html: billingEmailHtml(env, 'Your bank payment didn’t go through', [
      `The bank (ACH) payment for order <b>${htmlEscape(reference)}</b> failed, so the order was cancelled and nothing will ship.`,
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
    case 'quote_ready':
      return {
        company_id: payload.company_id,
        type: 'offer',
        title: 'Your quote is ready',
        body: 'Requested pricing is ready to review and accept.',
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

export async function deliverIntegrationEffect({ env, sb, effect: effectRow }, dependencies = {}) {
  // sendEmailResult keeps the retryable/non-retryable distinction that the boolean
  // sendEmail throws away; handlers may still return their own {skipped} object.
  const send = dependencies.sendEmail || sendEmailResult;
  const localProjectionRpc = {
    shipstation_tracking_projection: 'apply_shipstation_tracking_integration_effect',
    qbo_change_projection: 'apply_qbo_change_integration_effect',
    quote_message: 'deliver_quote_message_effect',
  }[effectRow.effect_type];
  if (localProjectionRpc) {
    const result = await rpcData(sb, localProjectionRpc, {
      p_effect_id: effectRow.id,
      p_worker_id: effectRow.lease_owner,
    });
    return {
      providerRecorded: true,
      providerResult: result || {},
      skipped: Boolean(result?.skipped),
    };
  }
  // Each effect type declares which provider inbox may produce it. This used to be a bare
  // `provider === 'stripe'` gate, which silently blocks every non-Stripe workflow the
  // moment one is added.
  const allowedProvider = EFFECT_PROVIDERS[effectRow.effect_type];
  if (!allowedProvider) throw errorWithCode('unknown_integration_effect_type');
  if (!allowedProvider.has(effectRow.provider)) throw errorWithCode('unsupported_integration_provider');

  if (effectRow.effect_type === 'support_message_email') {
    const loadMessage = dependencies.loadSupportMessage || supportMessageForEffect;
    const message = await loadMessage(sb, effectRow);
    const delivery = await deliverSupportMessageEmail(env, sb, message, {
      ...dependencies,
      deliveryEffect: effectRow,
    });
    return supportProviderResult(delivery);
  }

  // Cancellation chain. The two database-owned steps (restock, close) record their own
  // success inside the transaction that performs them; the provider-calling steps report
  // back so the next link can read their result.
  const reversalRpc = effectRow.payload?.command_id ? {
    order_restock: 'apply_order_reversal_restock_effect',
    order_cancelled: 'apply_order_reversal_cancellation_effect',
    order_reversal_complete: 'apply_order_reversal_complete_effect',
  }[effectRow.effect_type] : null;
  if (reversalRpc) {
    const result = await rpcData(sb, reversalRpc, {
      p_effect_id: effectRow.id,
      p_worker_id: effectRow.lease_owner,
    });
    return {
      providerRecorded: true,
      providerResult: result || {},
      skipped: Boolean(result?.skipped),
    };
  }
  const cancellationRpc = {
    order_restock: 'apply_order_restock_effect',
    order_cancelled: 'apply_order_cancellation_effect',
  }[effectRow.effect_type];
  if (cancellationRpc) {
    const result = await rpcData(sb, cancellationRpc, {
      p_effect_id: effectRow.id,
      p_worker_id: effectRow.lease_owner,
    });
    return {
      providerRecorded: true,
      providerResult: result || {},
      skipped: Boolean(result?.skipped),
    };
  }
  if (effectRow.effect_type === 'order_label_void') {
    const result = await voidLabelEffect(env, sb, effectRow, dependencies);
    return { providerRecorded: false, providerResult: result, skipped: Boolean(result.skipped) };
  }
  if (effectRow.effect_type === 'order_refund') {
    const result = await refundOrderEffect(env, sb, effectRow, dependencies);
    return { providerRecorded: false, providerResult: result, skipped: Boolean(result.skipped) };
  }
  if (effectRow.effect_type === 'order_accounting_reversal') {
    const result = await accountingReversalEffect(env, sb, effectRow, dependencies);
    return { providerRecorded: false, providerResult: result, skipped: Boolean(result.skipped) };
  }
  if (effectRow.effect_type === 'order_credit_memo') {
    const result = await creditMemoEffect(sb, effectRow);
    return { providerRecorded: false, providerResult: result, skipped: Boolean(result.skipped) };
  }

  if (effectRow.effect_type === 'stock_decrement') {
    const result = await rpcData(sb, 'apply_integration_stock_effect', {
      p_effect_id: effectRow.id,
      p_worker_id: effectRow.lease_owner,
    });
    return {
      providerRecorded: true,
      providerResult: result || {},
      skipped: Boolean(result?.skipped),
    };
  }
  if (effectRow.effect_type === 'company_notification') {
    const result = await rpcData(sb, 'deliver_integration_notification_effect', {
      p_effect_id: effectRow.id,
      p_worker_id: effectRow.lease_owner,
      p_notification: notificationFromEffect(effectRow),
    });
    return {
      providerRecorded: true,
      providerResult: result || {},
      skipped: Boolean(result?.skipped),
    };
  }

  let delivered;
  if (effectRow.effect_type === 'shipment_notification') {
    delivered = await sendShipmentNotificationEffect(env, sb, effectRow, send);
  } else if (effectRow.effect_type === 'order_confirmation') {
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
  } else if (effectRow.effect_type === 'order_refund_email') {
    delivered = await sendRefundEmailEffect(env, sb, effectRow, send);
  } else if (effectRow.effect_type === 'order_cancellation_email') {
    delivered = await sendCancellationEmailEffect(env, sb, effectRow, send);
  } else if (effectRow.effect_type === 'quote_offer_email') {
    delivered = await sendQuoteOfferEffect(env, effectRow, send);
  } else {
    throw errorWithCode('unknown_integration_effect_type');
  }
  if (delivered && typeof delivered === 'object' && delivered.skipped) {
    return { providerRecorded: false, providerResult: delivered, skipped: true };
  }
  if (delivered && typeof delivered === 'object' && 'ok' in delivered) {
    if (delivered.ok) {
      const providerResult = {};
      if (delivered.providerMessageId) {
        providerResult.provider_message_id = String(delivered.providerMessageId).slice(0, 512);
      }
      if (Number.isInteger(delivered.status)) providerResult.http_status = delivered.status;
      return { providerRecorded: false, providerResult, skipped: false };
    }
    // A hard-suppressed recipient or an unconfigured mailer will never succeed. Retrying
    // eight times and dead-lettering the row buries the genuinely transient failures.
    if (delivered.retryable === false) {
      return {
        providerRecorded: false,
        providerResult: { skipped: delivered.error || 'email_not_deliverable' },
        skipped: true,
      };
    }
    throw errorWithCode('effect_provider_failed');
  }
  // Tests and callers that inject the boolean sendEmail still work.
  if (delivered !== true) throw errorWithCode('effect_provider_failed');
  return { providerRecorded: false, providerResult: {}, skipped: false };
}

function errorCode(error) {
  return String(error?.code || error?.name || 'effect_failed')
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, '_')
    .slice(0, 80);
}

async function integrationEventForEffect(sb, effectRow) {
  const { data, error } = await sb.from('integration_events')
    .select('provider,environment_or_tenant,provider_event_id,provider_event_type,provider_object_id')
    .eq('id', effectRow.event_id)
    .maybeSingle();
  if (error || !data) throw errorWithCode('integration_event_not_found');
  return data;
}

async function supportMessageForEffect(sb, effectRow) {
  const messageId = String(effectRow.payload?.message_id || '');
  if (!messageId
    || Object.keys(effectRow.payload || {}).length !== 1
    || effectRow.effect_type !== 'support_message_email'
    || effectRow.effect_key !== 'email-counterpart'
    || effectRow.aggregate_type !== 'support_ticket') {
    throw terminalErrorWithCode('support_effect_identity_invalid');
  }
  const { data: message, error } = await sb.from('messages')
    .select('id,thread_id,ticket_id,company_id,user_id,recipient_user_id,sender_role,body,order_id,source,external_alert_kind,email_delivery_id,email_message_id,email_references,created_at')
    .eq('id', messageId)
    .maybeSingle();
  if (error) throw errorWithCode('support_effect_message_load_failed');
  if (!message) throw terminalErrorWithCode('support_effect_message_not_found');
  if (message.ticket_id !== effectRow.aggregate_id) {
    throw terminalErrorWithCode('support_effect_ticket_mismatch');
  }
  if (effectRow.provider !== 'masest'
    || effectRow.environment_or_tenant !== 'production'
    || effectRow.provider_event_id !== `support-message/${message.id}`
    || effectRow.provider_event_type !== 'support.message.created'
    || effectRow.provider_object_id !== message.id) {
    throw terminalErrorWithCode('support_effect_event_identity_mismatch');
  }
  return message;
}

function supportProviderResult(delivery) {
  if (delivery?.skipped === 'already_delivered') {
    if (!delivery.providerMessageId) throw terminalErrorWithCode('support_delivery_result_missing');
    return {
      providerRecorded: false,
      providerResult: {
        provider_message_id: String(delivery.providerMessageId).slice(0, 512),
        delivery_state: 'delivered',
      },
      skipped: false,
    };
  }
  if (delivery?.skipped && isSupportEmailPolicySkip(delivery.skipped)) {
    return {
      providerRecorded: false,
      providerResult: { skipped: delivery.skipped },
      skipped: true,
    };
  }
  if (delivery?.ok) {
    if (!delivery.providerMessageId) throw errorWithCode('support_email_delivery_id_missing');
    return {
      providerRecorded: false,
      providerResult: {
        provider_message_id: String(delivery.providerMessageId).slice(0, 512),
        delivery_state: 'delivered',
      },
      skipped: false,
    };
  }
  const code = String(delivery?.error || 'effect_provider_failed');
  if (delivery?.retryable === false) throw terminalErrorWithCode(code);
  throw errorWithCode(code);
}

export async function processClaimedIntegrationEffect({
  env,
  sb,
  effect: claimedEffect,
  workerId,
}, dependencies = {}) {
  if (!claimedEffect?.id || claimedEffect.lease_owner !== workerId) {
    throw errorWithCode('effect_lease_owner_mismatch');
  }
  const deliverEffect = dependencies.deliverEffect || deliverIntegrationEffect;
  const loadEvent = dependencies.loadEvent || integrationEventForEffect;
  let providerAcknowledged = false;
  let providerCallSkipped = false;
  let skipped = false;
  try {
    const integrationEvent = claimedEffect.provider
      ? {}
      : await loadEvent(sb, claimedEffect);
    const effectRow = { ...claimedEffect, ...integrationEvent };
    let outcome = null;
    if (!effectRow.provider_succeeded_at) {
      outcome = await deliverEffect({ env, sb, effect: effectRow });
      if (!outcome?.providerRecorded) {
        const recorded = await rpcData(sb, 'record_integration_effect_success', {
          p_effect_id: effectRow.id,
          p_worker_id: workerId,
          p_result: outcome?.providerResult || {},
        });
        if (recorded !== true) throw errorWithCode('effect_success_record_failed');
      }
      skipped = Boolean(outcome?.skipped);
      providerAcknowledged = !skipped;
    } else {
      providerCallSkipped = true;
      outcome = {
        providerRecorded: true,
        providerResult: effectRow.provider_result || {},
        skipped: Boolean(effectRow.provider_result?.skipped),
      };
      skipped = outcome.skipped;
    }
    const completed = await rpcData(sb, 'complete_integration_effect', {
      p_effect_id: effectRow.id,
      p_worker_id: workerId,
    });
    if (completed !== true) throw errorWithCode('effect_completion_failed');
    return {
      state: outcome?.skipped ? 'skipped' : 'delivered',
      effectId: effectRow.id,
      ...(outcome?.skipped ? { reason: outcome.providerResult?.skipped } : {}),
      providerAcknowledged,
      providerCallSkipped,
      skipped,
    };
  } catch (error) {
    const maxAttempts = error?.terminal
      ? Math.max(Number(claimedEffect.attempt_count) || 1, 1)
      : 8;
    const reason = errorCode(error);
    const status = await rpcData(sb, 'fail_integration_effect', {
      p_effect_id: claimedEffect.id,
      p_worker_id: workerId,
      p_error_code: reason,
      p_max_attempts: maxAttempts,
      p_base_backoff_seconds: 30,
    });
    return {
      state: status === 'dead' ? 'dead' : 'queued',
      effectId: claimedEffect.id,
      reason,
      providerAcknowledged,
      providerCallSkipped,
      skipped,
    };
  }
}

export async function runIntegrationEffectsWorker({
  env,
  sb = adminClient(env),
  workerId,
  limit = 10,
  leaseSeconds = 60,
}, dependencies = {}) {
  const batchLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);
  const boundedLeaseSeconds = Math.min(Math.max(Number(leaseSeconds) || 60, 15), 900);
  const summary = {
    claimed: 0,
    completed: 0,
    retried: 0,
    dead: 0,
    skipped: 0,
    providerAcknowledged: 0,
    providerCallSkipped: 0,
  };
  // Claim one at a time so later rows do not burn their leases while earlier provider
  // calls run. The invocation remains bounded by batchLimit.
  for (let index = 0; index < batchLimit; index++) {
    const claimed = await rpcData(sb, 'claim_integration_effects', {
      p_worker_id: workerId,
      p_limit: 1,
      p_lease_seconds: boundedLeaseSeconds,
    });
    if (!Array.isArray(claimed) || !claimed.length) break;
    const claimedEffect = claimed[0];
    summary.claimed += 1;
    const result = await processClaimedIntegrationEffect({
      env,
      sb,
      effect: claimedEffect,
      workerId,
    }, dependencies);
    if (result.skipped) summary.skipped += 1;
    if (result.providerAcknowledged) summary.providerAcknowledged += 1;
    if (result.providerCallSkipped) summary.providerCallSkipped += 1;
    if (result.state === 'delivered' || result.state === 'skipped') {
      summary.completed += 1;
    } else if (result.state === 'dead') {
      summary.dead += 1;
    } else {
      summary.retried += 1;
    }
  }
  return summary;
}
