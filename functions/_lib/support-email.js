import {
  adminClient,
  emailsByIds,
} from './supabase.js';
import { htmlToText } from './email.js';
import { isStaffEmail, platformStaffRole, staffCanWrite } from './authz.js';
import {
  inboundReplyText,
  messageIdFromReplyAddress,
} from './message-replies.js';
import { attemptSupportMessageDelivery, createSupportDeliveryWorkerId } from './support-delivery.js';

// Outbound rendering lives in the acyclic delivery owner while this facade
// retains the inbound routing API and its compatibility export.
export { deliverSupportMessageEmail } from './support-email-delivery.js';

const MESSAGE_ID_RE = /<[^<>\s]+>/g;
const MAX_REFERENCE_IDS = 30;

function safeDeliveryReason(value) {
  const reason = String(value || '').trim();
  return /^[a-z][a-z0-9_:-]{0,79}$/.test(reason)
    ? reason
    : 'support_delivery_attention_required';
}

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
    sb.from('profiles').select('id,is_staff,staff_role').eq('is_staff', true),
  ]);
  if (buyerError) throw buyerError;
  if (staffError) throw staffError;
  const profiles = [...(buyers || []), ...(staff || [])];
  const emails = await emailsByIds(sb, profiles.map((profile) => profile.id));
  const staffProfile = (staff || []).find((profile) => emailAddress(emails[profile.id]) === address);
  const staffRole = typeof staffProfile?.staff_role === 'string'
    ? platformStaffRole(staffProfile)
    : null;
  if (staffCanWrite(staffRole) || isStaffEmail(address, env)) {
    return { role: 'staff', userId: staffProfile?.id || null };
  }
  const buyer = (buyers || []).find((profile) => emailAddress(emails[profile.id]) === address);
  if (buyer) return { role: 'buyer', userId: buyer.id };
  return null;
}

async function loadReplyMessage(sb, messageId) {
  const { data, error } = await sb.from('messages')
    .select('id,thread_id,ticket_id,company_id,sender_role,user_id,recipient_user_id,order_id')
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
    p_ticket_id: input.ticketId,
  });
  if (error) throw error;
  if (!data?.message_id && !data?.id) throw new Error('email_inbound_message_upsert_failed');
  return data;
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
    ticketId: parent.ticket_id || null,
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
    ticket_id: result.ticket_id ?? parent.ticket_id ?? null,
    company_id: result.company_id ?? companyId,
    sender_role: result.sender_role || identity.role,
    user_id: result.user_id ?? (identity.role === 'buyer' ? identity.userId : null),
    recipient_user_id: result.recipient_user_id
      ?? (identity.role === 'staff' ? parent.user_id : null),
    order_id: result.order_id ?? parent.order_id ?? null,
    body: result.body || body,
    email_references: result.email_references || emailReferences,
  };
  const workerId = (dependencies.createDeliveryWorkerId || createSupportDeliveryWorkerId)('inbound');
  const delivery = await (dependencies.attemptDelivery || attemptSupportMessageDelivery)({
    env,
    sb,
    message,
    workerId,
  });
  return {
    routed: true,
    duplicate: result.inserted === false,
    email_delivery: delivery,
    ...(delivery?.state === 'dead' ? {
      reason: safeDeliveryReason(delivery.reason),
    } : {}),
  };
}
