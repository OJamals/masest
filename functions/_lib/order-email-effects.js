import { companyEmails, sendEmailResult } from './supabase.js';
import { renderCommerceEmail } from './email-renderers.js';
import { shipmentNotice } from './order-email.js';
import { orderReference } from './order-integrations.js';

function errorWithCode(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

async function loadOrder(sb, orderId) {
  const { data, error } = await sb.from('orders')
    .select('id,order_number,company_id,customer_email,carrier,tracking_status,tracking_number,tracking_url,estimated_delivery_at,shipstation_return_label_id,shipstation_return_tracking_number')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw errorWithCode('order_email_order_load_failed');
  if (!data) throw errorWithCode('order_email_order_missing');
  return data;
}

async function effectMetadata(sb, effectRow) {
  if (effectRow.metadata && typeof effectRow.metadata === 'object'
      && Object.keys(effectRow.metadata).length) return effectRow.metadata;
  if (!effectRow.event_id) throw errorWithCode('order_email_snapshot_missing');
  const { data, error } = await sb.from('integration_events')
    .select('metadata').eq('id', effectRow.event_id).maybeSingle();
  if (error || !data?.metadata || typeof data.metadata !== 'object') {
    throw errorWithCode('order_email_snapshot_missing');
  }
  return data.metadata;
}

async function deliverTracking({ env, sb, effect: effectRow }, dependencies = {}) {
  const orderId = text(effectRow.payload?.order_id, 80);
  const operationId = text(effectRow.payload?.operation_id, 80);
  if (!orderId || !operationId) throw errorWithCode('order_tracking_email_invalid');
  const order = await (dependencies.loadOrder || loadOrder)(sb, orderId);
  const snapshot = await effectMetadata(sb, effectRow);
  if (!snapshot.tracking_status || !Object.hasOwn(snapshot, 'customer_email')) {
    throw errorWithCode('order_email_snapshot_missing');
  }
  const notice = shipmentNotice(snapshot.tracking_status, {
    carrier: snapshot.carrier,
    trackingNumber: snapshot.tracking_number,
  });
  const companyRecipients = snapshot.company_id
    ? await (dependencies.companyEmails || companyEmails)(sb, snapshot.company_id, 'orders', { strict: true })
    : [];
  const recipients = [...new Set([snapshot.customer_email, ...companyRecipients]
    .map((value) => text(value, 254).toLowerCase())
    .filter(Boolean))];
  if (!recipients.length) return { skipped: 'no_recipients' };
  const appUrl = String(env.APP_URL || 'https://masest.co').replace(/\/+$/, '');
  const rendered = renderCommerceEmail({
    event: snapshot.tracking_status === 'delivered' ? 'delivered'
      : snapshot.tracking_status === 'shipped' ? 'shipped' : 'delivery_update',
    appUrl,
    order: { ...order, order_number: snapshot.order_number, customer_email: snapshot.customer_email,
      carrier: snapshot.carrier, tracking_number: snapshot.tracking_number,
      tracking_url: snapshot.tracking_url, estimated_delivery_at: snapshot.estimated_delivery_at },
    fulfillment: {
      label: notice.label,
      summary: notice.body,
      carrier: snapshot.carrier,
      trackingNumber: snapshot.tracking_number,
      trackingUrl: snapshot.tracking_url,
      estimatedDelivery: snapshot.estimated_delivery_at,
    },
  });
  const send = dependencies.sendEmail || sendEmailResult;
  const result = await send(env, {
    to: recipients,
    subject: rendered.subject || `Order ${snapshot.order_number || orderReference(order)} ${notice.label}`,
    html: rendered.html,
    text: rendered.text,
    category: 'order',
    idempotencyKey: `order-tracking:${operationId}`,
  });
  if (result?.ok) return result;
  if (result?.retryable === false) return { skipped: result.error || 'order_tracking_email_not_deliverable' };
  throw errorWithCode('order_tracking_email_failed');
}

async function deliverReturnLabel({ env, sb, effect: effectRow }, dependencies = {}) {
  const orderId = text(effectRow.payload?.order_id, 80);
  const returnId = text(effectRow.payload?.return_id, 100);
  if (!orderId || !returnId) throw errorWithCode('return_label_email_invalid');
  const order = await (dependencies.loadOrder || loadOrder)(sb, orderId);
  if (text(order.shipstation_return_label_id, 100) !== returnId) {
    throw errorWithCode('return_label_email_identity_mismatch');
  }
  const snapshot = await effectMetadata(sb, effectRow);
  const to = text(snapshot.customer_email, 254).toLowerCase();
  if (!to) return { skipped: 'no_recipient' };
  const appUrl = String(env.APP_URL || 'https://masest.co').replace(/\/+$/, '');
  const rendered = renderCommerceEmail({
    event: 'return_label',
    appUrl,
    order: {
      ...order,
      order_number: snapshot.order_number,
      customer_email: snapshot.customer_email,
      carrier: snapshot.carrier,
      reference: snapshot.order_number || orderReference(order),
      viewUrl: `${appUrl}/dashboard.html#orders`,
      ctaText: snapshot.cta_text || 'View your orders',
    },
    fulfillment: {
      labelUrl: snapshot.label_url || null,
      trackingNumber: snapshot.tracking_number,
      carrier: snapshot.carrier || 'Return carrier',
    },
    notes: snapshot.reason ? [`Reason on file: ${snapshot.reason}`] : [],
  });
  const send = dependencies.sendEmail || sendEmailResult;
  const result = await send(env, {
    to: [to],
    bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    category: 'order',
    idempotencyKey: `return-label:${returnId}`,
  });
  if (result?.ok) return result;
  if (result?.retryable === false) return { skipped: result.error || 'return_label_email_not_deliverable' };
  throw errorWithCode('return_label_email_failed');
}

export async function deliverOrderEmailEffect({ env, sb, effect }, dependencies = {}) {
  if (effect?.provider !== 'masest') throw errorWithCode('unsupported_integration_provider');
  if (effect.effect_type === 'order_tracking_email') return deliverTracking({ env, sb, effect }, dependencies);
  if (effect.effect_type === 'return_label_email') return deliverReturnLabel({ env, sb, effect }, dependencies);
  throw errorWithCode('unknown_order_email_effect_type');
}
