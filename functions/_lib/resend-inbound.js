import {
  adminClient,
  emailsByIds,
  emailLayout,
  htmlEscape,
  sendEmailResult,
} from './supabase.js';
import { htmlToText } from './email.js';
import { companyIdFromReplyAddress, inboundReplyText } from './message-replies.js';
import { adminMessageAlertKind, adminMessageRecipients } from './admin-message-notifications.js';

function emailAddress(value) {
  const match = String(value || '').match(/<([^>]+)>/);
  return String(match?.[1] || value || '').trim().toLowerCase();
}

export async function fetchReceivedEmail(env, id, request = fetch) {
  if (!env.RESEND_API_KEY) throw new Error('resend_receiving_not_configured');
  let response;
  try {
    response = await request(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    });
  } catch (error) {
    throw new Error('resend_receiving_unavailable', { cause: error });
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`resend_receiving_http_${response.status}`);
  const payload = await response.json().catch(() => null);
  if (!payload) throw new Error('resend_receiving_response_invalid');
  return payload;
}

async function upsertInboundMessage(sb, input) {
  const { data, error } = await sb.rpc('upsert_resend_inbound_message', {
    p_company_id: input.companyId,
    p_user_id: input.userId,
    p_external_message_id: input.emailId,
    p_body: input.body,
  });
  if (error) throw error;
  if (!data?.message_id) throw new Error('resend_inbound_message_upsert_failed');
  return data;
}

export async function routeInboundMessageReply(env, event, dependencies = {}) {
  const emailId = event?.data?.email_id || event?.data?.id;
  if (!emailId) return { routed: false };
  const received = await (dependencies.receivedEmail || fetchReceivedEmail)(env, emailId);
  if (!received) return { routed: false, reason: 'received_email_not_found' };
  const content = received?.data || received;
  const recipients = event?.data?.to || content?.to || [];
  const companyId = await (dependencies.companyIdFromReplyAddress || companyIdFromReplyAddress)(env, recipients);
  if (!companyId) return { routed: false };

  const sb = dependencies.sb || adminClient(env);
  const sender = emailAddress(event?.data?.from || content?.from);
  const { data: members, error: memberError } = await sb.from('profiles').select('id').eq('company_id', companyId);
  if (memberError) throw memberError;
  const memberEmails = await emailsByIds(sb, (members || []).map((member) => member.id));
  const member = (members || []).find((candidate) => emailAddress(memberEmails[candidate.id]) === sender);
  if (!sender || !member) return { routed: false, reason: 'sender_not_member' };

  const body = inboundReplyText(content?.text || htmlToText(content?.html || ''));
  if (!body) return { routed: false, reason: 'empty_reply' };

  const upsert = dependencies.upsertMessage || upsertInboundMessage;
  const result = await upsert(sb, {
    companyId, userId: member.id, emailId, body,
  });
  const alertKind = result.alert_kind || adminMessageAlertKind({
    previousMessage: result.previous_sender_role ? { sender_role: result.previous_sender_role } : null,
    threadStatus: result.prior_thread_status,
  });
  const recipientsForAlert = await (dependencies.adminMessageRecipients || adminMessageRecipients)(sb, alertKind, env);
  if (recipientsForAlert.length) {
    const sendAlert = dependencies.sendEmailResult || dependencies.sendEmail || sendEmailResult;
    const delivery = await sendAlert(env, {
      to: recipientsForAlert,
      subject: alertKind === 'support_request'
        ? `New support request from ${result.company_name || companyId}`
        : `New customer email reply from ${result.company_name || companyId}`,
      html: emailLayout({
        heading: 'New customer email reply',
        bodyHtml: `<p>From: ${htmlEscape(sender)}</p><blockquote style="border-left:3px solid #0e7c86;padding-left:12px;color:#334;margin:12px 0">${htmlEscape(body.slice(0, 500))}</blockquote>`,
        // #support opens the support console over the admin console. This alert
        // is about a message, so it lands staff on the message — it used to land
        // them on notification preferences instead.
        ctaText: 'Open customer support',
        ctaUrl: `${env.APP_URL || 'https://masest.co'}/admin.html#support`,
      }),
      category: 'staff_alert',
      idempotencyKey: `resend-inbound-alert/${emailId}`,
    });
    if (delivery === false || delivery?.ok === false) {
      throw new Error(delivery?.error || 'resend_inbound_alert_failed');
    }
  }
  return { routed: true, duplicate: result.inserted === false };
}
