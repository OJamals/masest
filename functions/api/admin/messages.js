// /api/admin/messages — staff side of company support threads.
//   GET → thread list · GET ?company_id= → full thread · PATCH → lifecycle · POST → reply
import { adminClient, requireStaff, json, readBody, emailsByIds, sendEmail, htmlEscape, emailLayout } from '../../_lib/supabase.js';
import { staffCanWrite } from '../../_lib/authz.js';
import { messageReplyAddress } from '../../_lib/message-replies.js';
import { shouldEmailClosedChatReply } from '../../_lib/message-notifications.js';
import {
  messagePage,
  recordSupportMessage,
  SUPPORT_PAGE_SIZE,
  supportThreadPatch,
} from '../../_lib/support-messages.js';

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const companyId = params.get('company_id');
    if (companyId) {
      const before = params.get('before');
      let query = sb.from('messages')
        .select('id,sender_role,body,order_id,created_at,read_by_staff,source,external_thread_id,external_message_id')
        .eq('company_id', companyId).order('created_at', { ascending: false }).limit(SUPPORT_PAGE_SIZE + 1);
      if (before) query = query.lt('created_at', before);
      const { data, error } = await query;
      if (error) return json(500, { error: error.message });
      await sb.from('messages').update({ read_by_staff: true })
        .eq('company_id', companyId).eq('sender_role', 'buyer').eq('read_by_staff', false);
      const { data: company } = await sb.from('companies')
        .select('name,support_thread_status,support_thread_completed_at').eq('id', companyId).maybeSingle();
      return json(200, {
        ...messagePage(data, SUPPORT_PAGE_SIZE),
        thread: {
          company_id: companyId,
          company_name: company?.name || '—',
          status: company?.support_thread_status || 'open',
          completed_at: company?.support_thread_completed_at || null,
        },
      });
    }
    const { data, error } = await sb.from('companies')
      .select('id,name,support_thread_status,support_thread_completed_at,support_last_message_at,support_last_message_body,support_last_sender_role')
      .not('support_last_message_at', 'is', null)
      .neq('support_thread_status', 'complete')
      .order('support_last_message_at', { ascending: false })
      .limit(500);
    if (error) return json(500, { error: error.message });
    const threads = (data || []).map((company) => ({
      company_id: company.id,
      company_name: company.name || '—',
      last_body: company.support_last_message_body || '',
      last_at: company.support_last_message_at,
      status: company.support_thread_status || 'open',
      completed_at: company.support_thread_completed_at || null,
      unanswered: company.support_last_sender_role === 'buyer',
    }));
    return json(200, { threads });
  }

  if (request.method === 'PATCH') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);
    const companyId = body.company_id;
    const status = body.status;
    if (!companyId) return json(400, { error: 'company_id_required' });
    const patch = supportThreadPatch(status, user.id);
    if (!patch) return json(400, { error: 'invalid_status' });
    const { error } = await sb.from('companies').update(patch).eq('id', companyId);
    if (error) return json(500, { error: error.message });
    return json(200, { status });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);
    const companyId = body.company_id;
    const text = String(body.body || '').trim();
    if (!companyId) return json(400, { error: 'company_id_required' });
    if (!text) return json(400, { error: 'empty_message' });
    if (text.length > 4000) return json(400, { error: 'message_too_long' });
    const { data: lastMessage } = await sb.from('messages')
      .select('sender_role,user_id').eq('company_id', companyId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await sb.from('messages').insert({
      company_id: companyId, user_id: null, sender_role: 'staff', body: text,
      read_by_staff: true, read_by_user: false,
    }).select('id,created_at').single();
    if (error) return json(500, { error: error.message });
    let summarySynced = true;
    try {
      await recordSupportMessage(sb, {
        companyId, senderRole: 'staff', body: text, createdAt: data.created_at, reopen: false,
      });
    } catch { summarySynced = false; }
    await sb.from('notifications').insert({
      company_id: companyId, type: 'message', title: 'New message from MASEST',
      body: text.slice(0, 140), link: '/dashboard.html#messages',
    }).then(() => {}, () => {});
    // Email only an unanswered buyer after they close chat. Live chat stays in-app.
    if (lastMessage?.user_id) {
      const { data: recipient } = await sb.from('profiles')
        .select('id,notify_messages,support_chat_open,support_chat_seen_at').eq('id', lastMessage.user_id).maybeSingle();
      const recipientEmails = recipient ? await emailsByIds(sb, [recipient.id]) : {};
      const recipientEmail = recipient ? recipientEmails[recipient.id] : null;
      if (shouldEmailClosedChatReply(lastMessage, recipient, recipientEmail)) {
        const appUrl = env.APP_URL || new URL(request.url).origin;
        const replyTo = await messageReplyAddress(env, companyId);
        await sendEmail(env, { to: [recipientEmail], subject: 'New message from MASEST',
          html: emailLayout({
            heading: 'New message from MASEST',
            bodyHtml: `<p>You have a new message from the MASEST team:</p><blockquote style="border-left:3px solid #0e7c86;padding-left:12px;color:#334;margin:12px 0">${htmlEscape(text)}</blockquote>`,
            ctaText: 'Reply in your dashboard', ctaUrl: `${appUrl}/dashboard.html#messages`,
          }), replyTo });
      }
    }
    return json(201, { id: data.id, created_at: data.created_at, summary_synced: summarySynced });
  }

  return json(405, { error: 'method_not_allowed' });
}
