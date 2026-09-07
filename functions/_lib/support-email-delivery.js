import { adminMessageAlertKind, adminMessageRecipients } from './admin-message-notifications.js';
import { renderSupportEmail } from './email-renderers.js';
import { shouldEmailSupportRecipient } from './message-notifications.js';
import { messageReplyAddress } from './message-replies.js';
import {
  resolveSupportRecipient,
  supportOrderContextsById,
} from './support-messages.js';
import { formatSupportTicketNumber } from './support-tickets.js';
import { sendEmailResult } from './supabase.js';

const MESSAGE_ID_RE = /<[^<>\s]+>/g;
const MAX_REFERENCE_IDS = 30;
export const SUPPORT_THREAD_PARENT_COLUMNS = 'id,email_message_id,email_references,sender_role,body,created_at';
const POLICY_SKIPS = new Set([
  'recipient_not_found',
  'recipient_email_missing',
  'recipient_opted_out',
  'recipient_in_chat',
  'no_admin_recipients',
]);

function errorWithCode(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function messageIds(...values) {
  const ids = values.flatMap((value) => String(value || '').match(MESSAGE_ID_RE) || []);
  return [...new Set(ids)].slice(-MAX_REFERENCE_IDS);
}

function threadHeaders(parent) {
  const parentId = messageIds(parent?.messageId)[0] || null;
  if (!parentId) return { headers: {}, references: null };
  const references = messageIds(parent?.references, parentId).join(' ');
  return {
    headers: { 'In-Reply-To': parentId, References: references },
    references,
  };
}

async function orderContext(sb, message) {
  if (!message?.order_id) return null;
  const contexts = await supportOrderContextsById(sb, [message.order_id]);
  return contexts.get(message.order_id) || null;
}

async function threadParent(sb, message) {
  if (!message?.thread_id && !message?.company_id) return null;
  let query = sb.from('messages')
    .select(SUPPORT_THREAD_PARENT_COLUMNS)
    .or('email_message_id.not.is.null,email_references.not.is.null')
    .order('created_at', { ascending: false })
    .limit(3);
  query = message.thread_id
    ? query.eq('thread_id', message.thread_id)
    : query.eq('company_id', message.company_id);
  if (message.id) query = query.neq('id', message.id);
  if (message.ticket_id) {
    query = query.eq('ticket_id', message.ticket_id);
  } else if (message.order_id) {
    query = query.eq('order_id', message.order_id);
  } else {
    query = query.is('order_id', null);
  }
  if (!message.thread_id && !message.ticket_id) {
    const participantId = message.sender_role === 'staff' ? message.recipient_user_id : message.user_id;
    if (participantId) query = query.or(`user_id.eq.${participantId},recipient_user_id.eq.${participantId}`);
  }
  const { data, error } = await query;
  if (error) throw error;
  const priorMessages = Array.isArray(data) ? data : [];
  const parent = priorMessages.find((row) => row?.email_message_id || row?.email_references) || null;
  const messageId = parent?.email_message_id || messageIds(parent?.email_references).at(-1) || null;
  return messageId ? {
    messageId,
    references: parent.email_references || null,
    history: priorMessages.slice(0, 2).map(({ sender_role, body, created_at }) => ({
      sender_role,
      body,
      created_at,
    })),
  } : null;
}

async function saveDelivery(sb, { messageId, deliveryId, emailMessageId, references }) {
  const { data, error } = await sb.from('messages')
    .update({
      email_delivery_id: deliveryId,
      email_message_id: emailMessageId,
      email_references: references,
    })
    .eq('id', messageId)
    .select('id,email_delivery_id,email_message_id,email_references')
    .maybeSingle();
  if (error) throw error;
  if (!data?.id
    || data.id !== messageId
    || data.email_delivery_id !== deliveryId
    || data.email_message_id !== emailMessageId) {
    const missing = errorWithCode('support_email_delivery_persistence_missing');
    missing.terminal = true;
    throw missing;
  }
  return data;
}

async function saveProviderDelivery(sb, message, deliveryId, references, dependencies) {
  const emailMessageId = messageIds(deliveryId)[0] || null;
  await (dependencies.saveDelivery || saveDelivery)(sb, {
    messageId: message.id,
    deliveryId,
    emailMessageId,
    references,
  });
  return emailMessageId
    ? { ok: true, providerMessageId: deliveryId, emailMessageId, references }
    : {
        ok: true,
        providerMessageId: deliveryId,
        emailMessageId: null,
        references,
        threadingPending: true,
        warning: 'support_email_message_id_pending',
      };
}

async function supportTicketContext(sb, ticketId) {
  if (!ticketId) return null;
  const { data, error } = await sb.from('support_tickets')
    .select('id,ticket_number,subject,status,priority,category')
    .eq('id', ticketId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) return null;
  return {
    ...data,
    display_number: formatSupportTicketNumber(data.ticket_number),
  };
}

async function storeEnvelope(sb, { effectId, workerId, messageId, envelope }) {
  const { data, error } = await sb.rpc('store_support_message_email_envelope', {
    p_effect_id: effectId,
    p_worker_id: workerId,
    p_envelope: envelope,
  });
  if (error) throw errorWithCode('support_email_envelope_store_failed');
  const stored = data?.envelope || data;
  if (stored == null) return null;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    throw errorWithCode('support_email_envelope_invalid');
  }
  return stored;
}

function validateFrozenEnvelope(envelope, message) {
  const request = envelope?.request;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw errorWithCode('support_email_envelope_invalid');
  }
  if (request.idempotencyKey !== `support-message/${message.id}/${message.sender_role}`) {
    throw errorWithCode('support_email_envelope_identity_mismatch');
  }
  if (!Array.isArray(request.to) || !request.to.length || request.to.some((value) => typeof value !== 'string')) {
    throw errorWithCode('support_email_envelope_invalid');
  }
  for (const field of ['subject', 'html', 'text', 'replyTo', 'category']) {
    if (typeof request[field] !== 'string' || !request[field]) {
      throw errorWithCode('support_email_envelope_invalid');
    }
  }
  if (request.emailHeaders != null
    && (!request.emailHeaders || typeof request.emailHeaders !== 'object'
      || Array.isArray(request.emailHeaders))) {
    throw errorWithCode('support_email_envelope_invalid');
  }
  return {
    request,
    references: typeof envelope.references === 'string' ? envelope.references : null,
  };
}

export function isSupportEmailPolicySkip(reason) {
  return POLICY_SKIPS.has(String(reason || ''));
}

export async function deliverSupportMessageEmail(env, sb, message, dependencies = {}) {
  const hasThreadOwner = message?.thread_id || message?.company_id
    || message?.user_id || message?.recipient_user_id;
  if (!message?.id || !hasThreadOwner || !['buyer', 'staff'].includes(message.sender_role)) {
    return { ok: false, retryable: false, error: 'invalid_support_message' };
  }
  if (message.email_delivery_id && message.email_message_id) {
    return {
      ok: true,
      skipped: 'already_delivered',
      providerMessageId: message.email_delivery_id,
      emailMessageId: message.email_message_id,
      references: message.email_references || null,
    };
  }
  if (message.email_delivery_id) {
    return {
      ok: true,
      skipped: 'already_delivered',
      providerMessageId: message.email_delivery_id,
      emailMessageId: message.email_message_id || null,
      references: message.email_references || null,
    };
  }

  const deliveryEffect = dependencies.deliveryEffect;
  if (!deliveryEffect?.id || !deliveryEffect?.lease_owner) {
    return { ok: false, retryable: false, error: 'support_delivery_effect_required' };
  }

  const freezeEnvelope = dependencies.freezeEnvelope || storeEnvelope;
  let exact = null;
  let existing = null;
  try {
    existing = await freezeEnvelope(sb, {
      effectId: deliveryEffect.id,
      workerId: deliveryEffect.lease_owner,
      messageId: message.id,
      envelope: null,
    });
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      error: String(error?.code || 'support_email_envelope_load_failed'),
    };
  }
  if (existing) {
    try {
      exact = validateFrozenEnvelope(existing, message);
    } catch (error) {
      return {
        ok: false,
        retryable: false,
        error: String(error?.code || 'support_email_envelope_invalid'),
      };
    }
  }

  let recipients = [];
  let resolvedRecipient = null;
  if (!exact && message.sender_role === 'staff') {
    resolvedRecipient = dependencies.buyerRecipient
      ? await dependencies.buyerRecipient(sb, {
          companyId: message.company_id,
          userId: message.recipient_user_id,
        })
      : await resolveSupportRecipient(sb, {
          companyId: message.company_id,
          userId: message.recipient_user_id,
        }, { strictEmailLookup: true });
    if (!resolvedRecipient) return { ok: true, skipped: 'recipient_not_found' };
    if (!resolvedRecipient.email) return { ok: true, skipped: 'recipient_email_missing' };
    if (!shouldEmailSupportRecipient(resolvedRecipient, resolvedRecipient.email)) {
      return {
        ok: true,
        skipped: resolvedRecipient.notify_messages === false ? 'recipient_opted_out' : 'recipient_in_chat',
      };
    }
    recipients = [resolvedRecipient.email];
  } else if (!exact) {
    const kind = message.alert_kind || message.external_alert_kind || adminMessageAlertKind({
      previousMessage: message.previous_sender_role
        ? { sender_role: message.previous_sender_role }
        : null,
      threadStatus: message.prior_thread_status,
    });
    recipients = dependencies.adminRecipients
      ? await dependencies.adminRecipients(sb, kind, env)
      : await adminMessageRecipients(sb, kind, env, Date.now(), { strictEmailLookup: true });
    if (!recipients.length) return { ok: true, skipped: 'no_admin_recipients' };
  }

  if (!exact) {
    const replyTo = await (dependencies.replyAddress || messageReplyAddress)(env, message.id);
    if (!replyTo) return { ok: false, retryable: false, error: 'support_reply_address_not_configured' };
    const [order, parent, rawTicket] = await Promise.all([
      (dependencies.orderContext || orderContext)(sb, message),
      (dependencies.threadParent || threadParent)(sb, message),
      message.ticket_id
        ? (dependencies.ticketContext || supportTicketContext)(sb, message.ticket_id)
        : null,
    ]);
    const ticket = rawTicket?.id ? {
      ...rawTicket,
      display_number: rawTicket.display_number || formatSupportTicketNumber(rawTicket.ticket_number),
    } : null;
    const inheritedIds = messageIds(message.email_references);
    const threading = inheritedIds.length ? {
      headers: {
        'In-Reply-To': inheritedIds.at(-1),
        References: inheritedIds.join(' '),
      },
      references: inheritedIds.join(' '),
    } : threadHeaders(parent);
    const companyName = message.company_name || message.customer_name
      || resolvedRecipient?.full_name || message.company_id || 'Customer';
    const isStaffMessage = message.sender_role === 'staff';
    const appUrl = String(env?.APP_URL || 'https://masest.co').replace(/\/+$/, '');
    const ctaPath = isStaffMessage
      ? (order ? `/dashboard.html?order=${encodeURIComponent(order.id)}#messages` : '/dashboard.html#messages')
      : '/admin.html#support';
    const rendered = renderSupportEmail({
      thread: {
        headers: threading.headers,
        viewUrl: `${appUrl}${ctaPath}`,
      },
      message,
      priorMessages: parent?.history || [],
      participant: { name: companyName },
      ticket,
      order: order ? {
        ...order,
        viewUrl: isStaffMessage
          ? `${appUrl}/dashboard.html?order=${encodeURIComponent(order.id)}#orders`
          : `${appUrl}/admin.html?order=${encodeURIComponent(order.id)}#orders`,
      } : null,
      audience: isStaffMessage ? 'buyer' : 'staff',
    });
    const candidate = {
      request: {
        to: recipients,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        replyTo,
        emailHeaders: rendered.headers,
        category: isStaffMessage ? 'messages' : 'staff_alert',
        idempotencyKey: `support-message/${message.id}/${message.sender_role}`,
      },
      references: threading.references,
    };
    let frozen;
    try {
      frozen = await freezeEnvelope(sb, {
        effectId: deliveryEffect.id,
        workerId: deliveryEffect.lease_owner,
        messageId: message.id,
        envelope: candidate,
      });
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        error: String(error?.code || 'support_email_envelope_store_failed'),
      };
    }
    try {
      exact = validateFrozenEnvelope(frozen, message);
    } catch (error) {
      return {
        ok: false,
        retryable: false,
        error: String(error?.code || 'support_email_envelope_invalid'),
      };
    }
  }
  const delivery = await (dependencies.sendEmail || sendEmailResult)(env, exact.request);
  if (delivery === false || delivery?.ok === false) {
    return typeof delivery === 'object'
      ? delivery
      : { ok: false, retryable: true, error: 'support_email_failed' };
  }
  if (!delivery?.providerMessageId) {
    return { ok: false, retryable: true, error: 'support_email_delivery_id_missing' };
  }
  const captured = await saveProviderDelivery(
    sb,
    message,
    delivery.providerMessageId,
    exact.references,
    dependencies,
  );
  return { ...delivery, ...captured };
}
