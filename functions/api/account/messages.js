// /api/account/messages — support thread between the caller's company and MASEST staff.
//   GET → thread (marks staff msgs read by user unless ?peek=1) · POST { body } → buyer post
//   POST { action: 'chat_presence', chat_open } → authenticated buyer chat state
import { requireCompany, json, readBody, sendEmail, emailLayout, htmlEscape } from '../../_lib/supabase.js';
import { rateLimit, clientIp } from '../../_lib/ratelimit.js';
import { adminMessageAlertKind, adminMessageRecipients } from '../../_lib/admin-message-notifications.js';

export async function onRequest({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { user, companyId, sb } = ctx;

  if (request.method === 'GET') {
    const peek = new URL(request.url).searchParams.get('peek') === '1';
    const { data, error } = await sb
      .from('messages')
      .select('id,sender_role,body,order_id,source,created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) return json(500, { error: 'server_error' });
    if (!peek) {
      await sb.from('messages').update({ read_by_user: true })
        .eq('company_id', companyId).eq('sender_role', 'staff').eq('read_by_user', false);
    }
    return json(200, { messages: data || [] });
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    if (body.action === 'chat_presence') {
      if (typeof body.chat_open !== 'boolean') return json(400, { error: 'chat_open_required' });
      const { error } = await sb.from('profiles').update({ support_chat_open: body.chat_open })
        .eq('id', user.id);
      if (error) return json(500, { error: 'server_error' });
      return json(200, { support_chat_open: body.chat_open });
    }

    // Throttle customer messages. Staff receive these in the admin inbox; no email per post.
    const rl = await rateLimit(env, 'support-message', user.id || clientIp(request), { limit: 10, windowSec: 60 });
    if (!rl.ok) return json(429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfter || 60) });
    const text = String(body.body || '').trim();
    if (!text) return json(400, { error: 'empty_message' });
    if (text.length > 4000) return json(400, { error: 'message_too_long' });
    const source = body.source === 'customer_chat' ? 'customer_chat' : 'dashboard';
    const [{ data: previousMessage }, { data: company }, { data: profile }] = await Promise.all([
      sb.from('messages').select('sender_role').eq('company_id', companyId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      sb.from('companies').select('name,support_thread_status').eq('id', companyId).maybeSingle(),
      sb.from('profiles').select('support_chat_open').eq('id', user.id).maybeSingle(),
    ]);
    const { data, error } = await sb.from('messages').insert({
      company_id: companyId, user_id: user.id, sender_role: 'buyer', body: text,
      order_id: body.order_id || null, source, read_by_user: true, read_by_staff: false,
    }).select('id,created_at').single();
    if (error) return json(500, { error: 'server_error' });

    // A new buyer message reopens a completed thread.
    await sb.from('companies').update({
      support_thread_status: 'open', support_thread_completed_at: null, support_thread_completed_by: null,
    }).eq('id', companyId);

    const alertKind = adminMessageAlertKind({
      previousMessage,
      threadStatus: company?.support_thread_status,
      chatOpen: profile?.support_chat_open,
    });
    if (alertKind) {
      const recipients = await adminMessageRecipients(sb, alertKind);
      if (recipients.length) {
        const firstRequest = alertKind === 'support_request';
        await sendEmail(env, {
          to: recipients,
          subject: firstRequest ? `New support request from ${company?.name || companyId}` : `New message from ${company?.name || companyId}`,
          html: emailLayout({
            heading: firstRequest ? 'New support request' : 'New customer message',
            bodyHtml: `<p>Company: ${htmlEscape(company?.name || companyId)}</p><p>${htmlEscape(text.slice(0, 500))}</p>`,
            ctaText: 'Open customer messages',
            ctaUrl: `${env.APP_URL || new URL(request.url).origin}/admin.html#messages`,
          }),
          category: 'staff_alert',
        });
      }
    }

    return json(201, { id: data.id, created_at: data.created_at });
  }

  return json(405, { error: 'method_not_allowed' });
}
