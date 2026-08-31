import {
  adminClient,
  emailsByIds,
  emailLayout,
  htmlEscape,
  sendEmailResult,
} from './supabase.js';
import { htmlToText } from './email.js';
import { isStaffEmail } from './authz.js';
import { adminMessageAlertKind, adminMessageRecipients } from './admin-message-notifications.js';
import { shouldEmailSupportRecipient } from './message-notifications.js';
import {
  companyIdFromReplyAddress,
  inboundReplyText,
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

function threadSubject(companyName, hasParent) {
  const company = String(companyName || 'Customer').replace(/[\r\n]+/g, ' ').trim().slice(0, 120) || 'Customer';
  const base = `MASEST support · ${company}`;
  return hasParent ? `Re: ${base}` : base;
}

function orderLine(order) {
  if (!order?.id) return '';
  const reference = htmlEscape(order.reference || order.id);
  const status = order.status
    ? ` · ${htmlEscape(String(order.status).replaceAll('_', ' '))}`
    : '';
  return `<p><strong>Order ${reference}</strong>${status}</p>`;
}

async function fetchResendEmail(env, path, fetchImpl = globalThis.fetch) {
  if (!env?.RESEND_API_KEY) throw new Error('resend_email_not_configured');
  let response;
  try {
    response = await fetchImpl(`https://api.resend.com${path}`, {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    });
  } catch (error) {
    throw new Error('resend_email_unavailable', { cause: error });
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`resend_email_http_${response.status}`);
  const payload = await response.json().catch(() => null);
  if (!payload) throw new Error('resend_email_response_invalid');
  return payload;
}

async function fetchReceivedEmail(env, id, fetchImpl = globalThis.fetch) {
  return fetchResendEmail(env, `/emails/receiving/${encodeURIComponent(id)}`, fetchImpl);
}

async function fetchSentEmail(env, id, fetchImpl = globalThis.fetch) {
  return fetchResendEmail(env, `/emails/${encodeURIComponent(id)}`, fetchImpl);
}

async function orderContext(sb, message) {
  if (!message?.order_id) return null;
  const contexts = await supportOrderContextsById(sb, [message.order_id], message.company_id);
  return contexts.get(message.order_id) || null;
}

async function threadParent(sb, message) {
  if (!message?.company_id || !message?.sender_role) return null;
  let query = sb.from('messages')
    .select('id,email_message_id,email_references,created_at')
    .eq('company_id', message.company_id)
    .eq('sender_role', message.sender_role)
    .not('email_message_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (message.id) query = query.neq('id', message.id);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data?.email_message_id ? {
    messageId: data.email_message_id,
    references: data.email_references || null,
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

async function captureSentMessageId(env, sb, message, deliveryId, references, dependencies) {
  let emailMessageId = null;
  try {
    const sent = await (dependencies.sentEmail || fetchSentEmail)(env, deliveryId);
    const sentContent = sent?.data || sent;
    emailMessageId = messageIds(sentContent?.message_id)[0] || null;
  } catch {
    // Resend accepted the email already. Its verified delivery webhook can fill
    // the RFC Message-ID without risking a duplicate send.
  }
  await (dependencies.saveDelivery || saveDelivery)(sb, {
    messageId: message.id,
    deliveryId,
    emailMessageId,
    references,
  });
  return emailMessageId
    ? { ok: true, resendId: deliveryId, emailMessageId, references }
    : {
        ok: true,
        resendId: deliveryId,
        emailMessageId: null,
        references,
        threadingPending: true,
        warning: 'support_email_message_id_pending',
      };
}

async function senderIdentity(sb, sender, companyId, env) {
  const address = emailAddress(sender);
  if (!address) return null;
  const [{ data: members, error: memberError }, { data: staff, error: staffError }] = await Promise.all([
    sb.from('profiles').select('id').eq('company_id', companyId),
    sb.from('profiles').select('id,is_staff').eq('is_staff', true),
  ]);
  if (memberError) throw memberError;
  if (staffError) throw staffError;
  const profiles = [...(members || []), ...(staff || [])];
  const emails = await emailsByIds(sb, profiles.map((profile) => profile.id));
  const staffProfile = (staff || []).find((profile) => emailAddress(emails[profile.id]) === address);
  if (staffProfile || isStaffEmail(address, env)) {
    return { role: 'staff', userId: staffProfile?.id || null };
  }
  const member = (members || []).find((profile) => emailAddress(emails[profile.id]) === address);
  if (member) return { role: 'buyer', userId: member.id };
  return null;
}

async function replyContext(sb, { companyId, senderRole, userId, inReplyTo, references }) {
  const candidates = [...new Set([
    ...messageIds(inReplyTo),
    ...messageIds(references).reverse(),
  ])];
  let parent = null;
  if (candidates.length) {
    const { data, error } = await sb.from('messages')
      .select('id,sender_role,user_id,recipient_user_id,order_id,email_message_id,created_at')
      .eq('company_id', companyId)
      .in('email_message_id', candidates);
    if (error) throw error;
    const byMessageId = new Map((data || []).map((message) => [message.email_message_id, message]));
    parent = candidates.map((id) => byMessageId.get(id)).find(Boolean) || null;
  }
  if (!parent) {
    const { data, error } = await sb.from('messages')
      .select('id,sender_role,user_id,recipient_user_id,order_id,created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    parent = data || null;
  }
  const recipientUserId = senderRole === 'staff'
    ? parent?.user_id || parent?.recipient_user_id || null
    : null;
  if (senderRole === 'staff' && !recipientUserId) return null;
  if (senderRole === 'buyer' && parent?.recipient_user_id && parent.recipient_user_id !== userId) {
    return { recipientUserId: null, orderId: null };
  }
  return { recipientUserId, orderId: parent?.order_id || null };
}

async function upsertInboundMessage(sb, input) {
  const { data, error } = await sb.rpc('upsert_resend_inbound_message', {
    p_company_id: input.companyId,
    p_user_id: input.userId,
    p_external_message_id: input.emailId,
    p_body: input.body,
    p_sender_role: input.senderRole,
    p_recipient_user_id: input.recipientUserId,
    p_order_id: input.orderId,
  });
  if (error) throw error;
  if (!data?.message_id && !data?.id) throw new Error('resend_inbound_message_upsert_failed');
  return data;
}

export async function deliverSupportMessageEmail(env, sb, message, dependencies = {}) {
  if (!message?.id || !message?.company_id || !['buyer', 'staff'].includes(message.sender_role)) {
    return { ok: false, retryable: false, error: 'invalid_support_message' };
  }
  if (message.email_delivery_id && message.email_message_id) {
    return { ok: true, skipped: 'already_delivered' };
  }
  if (message.email_delivery_id) {
    return captureSentMessageId(
      env,
      sb,
      message,
      message.email_delivery_id,
      message.email_references || null,
      dependencies,
    );
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

  const replyTo = await (dependencies.replyAddress || messageReplyAddress)(env, message.company_id);
  if (!replyTo) return { ok: false, retryable: false, error: 'support_reply_address_not_configured' };
  const [order, parent] = await Promise.all([
    (dependencies.orderContext || orderContext)(sb, message),
    (dependencies.threadParent || threadParent)(sb, message),
  ]);
  const threading = threadHeaders(parent);
  const companyName = message.company_name || message.company_id;
  const isStaffMessage = message.sender_role === 'staff';
  const appUrl = String(env?.APP_URL || 'https://masest.co').replace(/\/+$/, '');
  const ctaPath = isStaffMessage
    ? (order ? `/dashboard.html?order=${encodeURIComponent(order.id)}#messages` : '/dashboard.html#messages')
    : '/admin.html#support';
  const heading = isStaffMessage ? 'New message from MASEST' : 'New customer message';
  const bodyHtml = `${orderLine(order)}<blockquote style="border-left:3px solid #0e7c86;padding-left:12px;color:#334;margin:12px 0;white-space:pre-wrap">${htmlEscape(String(message.body).slice(0, 4000))}</blockquote>`;
  const send = dependencies.sendEmail || sendEmailResult;
  const delivery = await send(env, {
    to: recipients,
    subject: threadSubject(companyName, Boolean(threading.headers['In-Reply-To'])),
    html: emailLayout({
      heading,
      bodyHtml,
      ctaText: isStaffMessage ? 'Open your messages' : 'Open customer support',
      ctaUrl: `${appUrl}${ctaPath}`,
    }),
    replyTo,
    emailHeaders: threading.headers,
    category: isStaffMessage ? 'messages' : 'staff_alert',
    idempotencyKey: `support-message/${message.id}/${message.sender_role}`,
  });
  if (delivery === false || delivery?.ok === false) {
    return typeof delivery === 'object'
      ? delivery
      : { ok: false, retryable: true, error: 'support_email_failed' };
  }
  if (!delivery?.resendId) {
    return { ok: false, retryable: true, error: 'support_email_delivery_id_missing' };
  }
  const captured = await captureSentMessageId(
    env,
    sb,
    message,
    delivery.resendId,
    threading.references,
    dependencies,
  );
  return { ...delivery, ...captured };
}

export async function routeInboundMessageReply(env, event, dependencies = {}) {
  const emailId = event?.data?.email_id || event?.data?.id;
  if (!emailId) return { routed: false };
  const received = await (dependencies.receivedEmail || fetchReceivedEmail)(env, emailId);
  if (!received) return { routed: false, reason: 'received_email_not_found' };
  const content = received?.data || received;
  const recipients = event?.data?.to || content?.to || [];
  const companyId = await (dependencies.companyIdFromReplyAddress || companyIdFromReplyAddress)(env, recipients);
  if (!companyId) return { routed: false, reason: 'invalid_reply_address' };
  const sb = dependencies.sb || adminClient(env);
  const sender = emailAddress(event?.data?.from || content?.from);
  const identity = await (dependencies.senderIdentity || senderIdentity)(sb, sender, companyId, env);
  if (!identity) return { routed: false, reason: 'sender_not_participant' };
  const body = inboundReplyText(content?.text || htmlToText(content?.html || ''));
  if (!body) return { routed: false, reason: 'empty_reply' };
  const headers = content?.headers || {};
  const inReplyTo = headerValue(headers, 'in-reply-to');
  const references = headerValue(headers, 'references');
  const context = await (dependencies.replyContext || replyContext)(sb, {
    companyId,
    senderRole: identity.role,
    userId: identity.userId,
    inReplyTo,
    references,
  });
  if (!context && identity.role === 'staff') {
    return { routed: false, reason: 'reply_context_not_found' };
  }
  const result = await (dependencies.upsertMessage || upsertInboundMessage)(sb, {
    companyId,
    userId: identity.role === 'buyer' ? identity.userId : null,
    senderRole: identity.role,
    recipientUserId: identity.role === 'staff' ? context?.recipientUserId || null : null,
    orderId: context?.orderId || null,
    emailId,
    body,
  });
  const message = {
    ...result,
    id: result.id || result.message_id,
    company_id: result.company_id || companyId,
    sender_role: result.sender_role || identity.role,
    user_id: result.user_id ?? (identity.role === 'buyer' ? identity.userId : null),
    recipient_user_id: result.recipient_user_id
      ?? (identity.role === 'staff' ? context?.recipientUserId || null : null),
    order_id: result.order_id ?? context?.orderId ?? null,
    body: result.body || body,
  };
  const deliver = dependencies.deliverMessage || deliverSupportMessageEmail;
  const delivery = await deliver(env, sb, message);
  if (delivery === false || delivery?.ok === false) {
    throw new Error(delivery?.error || 'resend_inbound_delivery_failed');
  }
  return { routed: true, duplicate: result.inserted === false };
}
