import {
  adminClient,
  emailsByIds,
  sendEmailResult,
} from './supabase.js';
import { htmlToText } from './email.js';
import { renderSupportEmail } from './email-renderers.js';
import { isStaffEmail } from './authz.js';
import { adminMessageAlertKind, adminMessageRecipients } from './admin-message-notifications.js';
import { shouldEmailSupportRecipient } from './message-notifications.js';
import {
  inboundReplyText,
  messageIdFromReplyAddress,
  messageReplyAddress,
} from './message-replies.js';
import {
  resolveSupportRecipient,
  supportOrderContextsById,
} from './support-messages.js';

const MESSAGE_ID_RE = /<[^<>\s]+>/g;
const MAX_REFERENCE_IDS = 30;

function emailAddress(value) {
  const match = String(value || '').match(/<([^>]+)>/);
  return String(match?.[1] || value || '').trim().toLowerCase();
}

function headerValue(headers, name) {
  const target = String(name).toLowerCase();
  if (Array.isArray(headers)) {
    return headers.find((header) => String(header?.name || '').toLowerCase() === target)?.value || '';
  }
  if (!headers || typeof headers !== 'object') return '';
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === target);
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? value.join(' ') : String(value || '');
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
    .select('id,email_message_id,email_references,sender_role,sender_name,body,created_at')
    .or('email_message_id.not.is.null,email_references.not.is.null')
    .order('created_at', { ascending: false })
    .limit(3);
  query = message.thread_id
    ? query.eq('thread_id', message.thread_id)
    : query.eq('company_id', message.company_id);
  if (message.id) query = query.neq('id', message.id);
  if (message.order_id) query = query.eq('order_id', message.order_id);
  else query = query.is('order_id', null);
  if (!message.thread_id) {
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
    history: priorMessages.slice(0, 2).map(({ sender_role, sender_name, body, created_at }) => ({
      sender_role,
      sender_name,
      body,
      created_at,
    })),
  } : null;
}

async function saveDelivery(sb, { messageId, deliveryId, emailMessageId, references }) {
  const { error } = await sb.from('messages').update({
    email_delivery_id: deliveryId,
    email_message_id: emailMessageId,
    email_references: references,
  }).eq('id', messageId);
  if (error) throw error;
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

async function senderIdentity(sb, sender, thread, env) {
  const address = emailAddress(sender);
  if (!address) return null;
  const buyerQuery = thread?.participant_user_id
    ? sb.from('profiles').select('id').eq('id', thread.participant_user_id)
    : thread?.company_id
      ? sb.from('profiles').select('id').eq('company_id', thread.company_id)
      : Promise.resolve({ data: [], error: null });
  const [{ data: buyers, error: buyerError }, { data: staff, error: staffError }] = await Promise.all([
    buyerQuery,
    sb.from('profiles').select('id,is_staff').eq('is_staff', true),
  ]);
  if (buyerError) throw buyerError;
  if (staffError) throw staffError;
  const profiles = [...(buyers || []), ...(staff || [])];
  const emails = await emailsByIds(sb, profiles.map((profile) => profile.id));
  const staffProfile = (staff || []).find((profile) => emailAddress(emails[profile.id]) === address);
  if (staffProfile || isStaffEmail(address, env)) {
    return { role: 'staff', userId: staffProfile?.id || null };
  }
  const buyer = (buyers || []).find((profile) => emailAddress(emails[profile.id]) === address);
  if (buyer) return { role: 'buyer', userId: buyer.id };
  return null;
}

async function loadReplyMessage(sb, messageId) {
  const { data, error } = await sb.from('messages')
    .select('id,thread_id,company_id,sender_role,user_id,recipient_user_id,order_id')
    .eq('id', messageId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadReplyThread(sb, threadId) {
  if (!threadId) return null;
  const { data, error } = await sb.from('support_threads')
    .select('id,participant_user_id,company_id')
    .eq('id', threadId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function upsertInboundMessage(sb, input) {
  const { data, error } = await sb.rpc('upsert_email_inbound_message', {
    p_company_id: input.companyId,
    p_user_id: input.userId,
    p_external_message_id: input.emailId,
    p_body: input.body,
    p_sender_role: input.senderRole,
    p_recipient_user_id: input.recipientUserId,
    p_order_id: input.orderId,
    p_email_references: input.emailReferences,
    p_thread_id: input.threadId,
  });
  if (error) throw error;
  if (!data?.message_id && !data?.id) throw new Error('email_inbound_message_upsert_failed');
  return data;
}

export async function deliverSupportMessageEmail(env, sb, message, dependencies = {}) {
  const hasThreadOwner = message?.thread_id || message?.company_id
    || message?.user_id || message?.recipient_user_id;
  if (!message?.id || !hasThreadOwner || !['buyer', 'staff'].includes(message.sender_role)) {
    return { ok: false, retryable: false, error: 'invalid_support_message' };
  }
  if (message.email_delivery_id && message.email_message_id) {
    return { ok: true, skipped: 'already_delivered' };
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
  let recipients = [];
  if (message.sender_role === 'staff') {
    const recipient = await (dependencies.buyerRecipient || resolveSupportRecipient)(sb, {
      companyId: message.company_id,
      userId: message.recipient_user_id,
    });
    if (!recipient) return { ok: false, skipped: 'recipient_not_found', retryable: false };
    if (!recipient.email) return { ok: true, skipped: 'recipient_email_missing' };
    if (!shouldEmailSupportRecipient(recipient, recipient.email)) {
      return { ok: true, skipped: recipient.notify_messages === false ? 'recipient_opted_out' : 'recipient_in_chat' };
    }
    recipients = [recipient.email];
  } else {
    const kind = message.alert_kind || adminMessageAlertKind({
      previousMessage: message.previous_sender_role
        ? { sender_role: message.previous_sender_role }
        : null,
      threadStatus: message.prior_thread_status,
    });
    recipients = await (dependencies.adminRecipients || adminMessageRecipients)(sb, kind, env);
    if (!recipients.length) return { ok: true, skipped: 'no_admin_recipients' };
  }

  const replyTo = await (dependencies.replyAddress || messageReplyAddress)(env, message.id);
  if (!replyTo) return { ok: false, retryable: false, error: 'support_reply_address_not_configured' };
  const [order, parent] = await Promise.all([
    (dependencies.orderContext || orderContext)(sb, message),
    (dependencies.threadParent || threadParent)(sb, message),
  ]);
  const inheritedIds = messageIds(message.email_references);
  const threading = inheritedIds.length ? {
    headers: {
      'In-Reply-To': inheritedIds.at(-1),
      References: inheritedIds.join(' '),
    },
    references: inheritedIds.join(' '),
  } : threadHeaders(parent);
  const companyName = message.company_name || message.customer_name || message.company_id || 'Customer';
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
    order: order ? {
      ...order,
      viewUrl: isStaffMessage
        ? `${appUrl}/dashboard.html?order=${encodeURIComponent(order.id)}#orders`
        : `${appUrl}/admin.html?order=${encodeURIComponent(order.id)}#orders`,
    } : null,
    audience: isStaffMessage ? 'buyer' : 'staff',
  });
  const send = dependencies.sendEmail || sendEmailResult;
  const delivery = await send(env, {
    to: recipients,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    replyTo,
    emailHeaders: rendered.headers,
    category: isStaffMessage ? 'messages' : 'staff_alert',
    idempotencyKey: `support-message/${message.id}/${message.sender_role}`,
  });
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
    threading.references,
    dependencies,
  );
  return { ...delivery, ...captured };
}

export async function routeInboundMessageReply(env, input, dependencies = {}) {
  const emailId = String(input?.id || '').trim();
  if (!emailId) return { routed: false };
  const replyMessageId = await (
    dependencies.messageIdFromReplyAddress || messageIdFromReplyAddress
  )(env, input?.to || []);
  if (!replyMessageId) return { routed: false, reason: 'invalid_reply_address' };
  const sb = dependencies.sb || adminClient(env);
  const parent = await (dependencies.replyMessage || loadReplyMessage)(sb, replyMessageId);
  if (!parent?.id) return { routed: false, reason: 'reply_message_not_found' };
  const thread = parent.thread_id
    ? await (dependencies.replyThread || loadReplyThread)(sb, parent.thread_id)
    : {
        id: null,
        participant_user_id: parent.recipient_user_id || parent.user_id || null,
        company_id: parent.company_id || null,
      };
  if (!thread) return { routed: false, reason: 'reply_thread_not_found' };
  const companyId = thread.company_id || null;
  const sender = emailAddress(input?.from);
  const identity = await (dependencies.senderIdentity || senderIdentity)(sb, sender, thread, env);
  if (!identity) return { routed: false, reason: 'sender_not_participant' };
  if (identity.role === 'buyer'
    && (parent.sender_role !== 'staff' || parent.recipient_user_id !== identity.userId)) {
    return { routed: false, reason: 'sender_not_recipient' };
  }
  if (identity.role === 'staff' && (parent.sender_role !== 'buyer' || !parent.user_id)) {
    return { routed: false, reason: 'reply_context_not_found' };
  }
  const body = inboundReplyText(input?.text || htmlToText(input?.html || ''));
  if (!body) return { routed: false, reason: 'empty_reply' };
  const headers = input?.headers || {};
  const inReplyTo = headerValue(headers, 'in-reply-to');
  const references = headerValue(headers, 'references');
  const emailReferences = messageIds(
    references,
    inReplyTo,
    headerValue(headers, 'message-id'),
  ).join(' ') || null;
  const result = await (dependencies.upsertMessage || upsertInboundMessage)(sb, {
    threadId: thread.id || parent.thread_id || null,
    companyId,
    userId: identity.role === 'buyer' ? identity.userId : null,
    senderRole: identity.role,
    recipientUserId: identity.role === 'staff' ? parent.user_id : null,
    orderId: parent.order_id || null,
    emailId,
    body,
    emailReferences,
  });
  const message = {
    ...result,
    id: result.id || result.message_id,
    thread_id: result.thread_id || thread.id || parent.thread_id || null,
    company_id: result.company_id ?? companyId,
    sender_role: result.sender_role || identity.role,
    user_id: result.user_id ?? (identity.role === 'buyer' ? identity.userId : null),
    recipient_user_id: result.recipient_user_id
      ?? (identity.role === 'staff' ? parent.user_id : null),
    order_id: result.order_id ?? parent.order_id ?? null,
    body: result.body || body,
    email_references: result.email_references || emailReferences,
  };
  const deliver = dependencies.deliverMessage || deliverSupportMessageEmail;
  const delivery = await deliver(env, sb, message);
  if (delivery === false || delivery?.ok === false) {
    throw new Error(delivery?.error || 'inbound_delivery_failed');
  }
  return { routed: true, duplicate: result.inserted === false };
}
