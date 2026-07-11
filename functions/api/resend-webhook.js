// POST /api/resend-webhook — Resend (Svix) delivery-event + inbound-reply sink.
// Configure in Resend Dashboard → Webhooks → endpoint <domain>/api/resend-webhook,
// subscribe to delivered / bounced / complained / failed / delivery_delayed.
// Set RESEND_WEBHOOK_SECRET in CF env.
// Returns 200 for accepted/duplicate/unknown events (avoid Resend retry storms),
// 400 only on signature failure. No-op (200) if the secret is unset.
import { adminClient, emailsByIds, emailLayout, htmlEscape, json, recordSuppression, sendEmail, updateEmailStatus } from '../_lib/supabase.js';
import { htmlToText, verifySvixSignature, mapResendEvent, isSuppressingEvent } from '../_lib/email.js';
import { companyIdFromReplyAddress, inboundReplyText } from '../_lib/message-replies.js';
import { adminMessageAlertKind, adminMessageRecipients } from '../_lib/admin-message-notifications.js';
import { recordSupportMessage } from '../_lib/support-messages.js';

function emailAddress(value) {
  const match = String(value || '').match(/<([^>]+)>/);
  return String(match?.[1] || value || '').trim().toLowerCase();
}

async function receivedEmail(env, id) {
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

export async function routeInboundMessageReply(env, event) {
  const emailId = event?.data?.email_id || event?.data?.id;
  const companyId = await companyIdFromReplyAddress(env, event?.data?.to || []);
  if (!emailId || !companyId) return { routed: false };

  const sb = adminClient(env);
  const sender = emailAddress(event?.data?.from);
  const { data: members, error: memberError } = await sb.from('profiles').select('id').eq('company_id', companyId);
  if (memberError) throw memberError;
  const memberEmails = await emailsByIds(sb, (members || []).map((member) => member.id));
  const member = (members || []).find((candidate) => emailAddress(memberEmails[candidate.id]) === sender);
  if (!sender || !member) return { routed: false, reason: 'sender_not_member' };

  const existing = await sb.from('messages').select('id')
    .eq('source', 'email_reply').eq('external_message_id', emailId).maybeSingle();
  if (existing.data?.id) return { routed: true, duplicate: true };

  const received = await receivedEmail(env, emailId);
  const content = received?.data || received;
  const body = inboundReplyText(content?.text || htmlToText(content?.html || ''));
  if (!body) return { routed: false, reason: 'empty_reply' };

  const [{ data: previousMessage }, { data: company }] = await Promise.all([
    sb.from('messages').select('sender_role').eq('company_id', companyId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('companies').select('name,support_thread_status').eq('id', companyId).maybeSingle(),
  ]);
  const { data: inserted, error } = await sb.from('messages').insert({
    company_id: companyId, user_id: member.id, sender_role: 'buyer', body,
    source: 'email_reply', external_message_id: emailId, read_by_user: true, read_by_staff: false,
  }).select('id,created_at').single();
  if (error?.code === '23505') return { routed: true, duplicate: true };
  if (error) throw error;
  await recordSupportMessage(sb, {
    companyId, senderRole: 'buyer', body, createdAt: inserted.created_at,
  });

  const alertKind = adminMessageAlertKind({ previousMessage, threadStatus: company?.support_thread_status });
  const recipients = await adminMessageRecipients(sb, alertKind, env);
  if (recipients.length) await sendEmail(env, {
    to: recipients,
    subject: alertKind === 'support_request'
      ? `New support request from ${company?.name || companyId}`
      : `New customer email reply from ${company?.name || companyId}`,
    html: emailLayout({
      heading: 'New customer email reply',
      bodyHtml: `<p>From: ${htmlEscape(sender)}</p><blockquote style="border-left:3px solid #0e7c86;padding-left:12px;color:#334;margin:12px 0">${htmlEscape(body.slice(0, 500))}</blockquote>`,
      ctaText: 'Open customer support', ctaUrl: `${env.APP_URL || 'https://masest.co'}/admin.html#support-settings`,
    }),
    category: 'staff_alert',
  });
  return { routed: true };
}

export async function onRequestPost({ request, env }) {
  const secret = env.RESEND_WEBHOOK_SECRET;
  const raw = await request.text();
  if (!secret) return json(200, { ok: true, note: 'webhook unconfigured' });

  const ok = await verifySvixSignature(secret, {
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
  }, raw);
  if (!ok) return json(400, { error: 'invalid_signature' });

  let event;
  try { event = JSON.parse(raw); } catch { return json(200, { ok: true, note: 'unparseable' }); }

  const type = event?.type;
  const resendId = event?.data?.email_id || event?.data?.id || null;
  const email = Array.isArray(event?.data?.to) ? event.data.to[0] : event?.data?.to || null;

  if (type === 'email.received') {
    try {
      const result = await routeInboundMessageReply(env, event);
      return json(200, { ok: true, ...result });
    } catch {
      return json(500, { error: 'inbound_processing_failed' });
    }
  }

  const status = mapResendEvent(type);
  if (status && resendId) await updateEmailStatus(env, resendId, status);
  if (isSuppressingEvent(type) && email) {
    await recordSuppression(env, email, type === 'email.complained' ? 'complaint' : 'hard_bounce');
  }
  return json(200, { ok: true });
}
