// /api/admin/messages — staff side of company support threads.
//   GET → thread list · GET ?company_id= → full thread (marks read) · POST { company_id, body } → reply
import { adminClient, requireStaff, json, readBody, companyEmails, sendEmail, htmlEscape, emailLayout } from '../../_lib/supabase.js';

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    const companyId = new URL(request.url).searchParams.get('company_id');
    if (companyId) {
      const { data, error } = await sb.from('messages')
        .select('id,sender_role,body,order_id,created_at,read_by_staff')
        .eq('company_id', companyId).order('created_at', { ascending: true }).limit(300);
      if (error) return json(500, { error: error.message });
      await sb.from('messages').update({ read_by_staff: true })
        .eq('company_id', companyId).eq('sender_role', 'buyer').eq('read_by_staff', false);
      return json(200, { messages: data || [] });
    }
    const { data, error } = await sb.from('messages')
      .select('company_id,sender_role,body,read_by_staff,created_at,companies(name)')
      .order('created_at', { ascending: false }).limit(1000);
    if (error) return json(500, { error: error.message });
    const threads = {};
    for (const m of data || []) {
      const t = threads[m.company_id] || (threads[m.company_id] = {
        company_id: m.company_id, company_name: m.companies?.name || '—',
        last_body: m.body, last_at: m.created_at, unread: 0,
      });
      if (m.sender_role === 'buyer' && !m.read_by_staff) t.unread += 1;
    }
    return json(200, { threads: Object.values(threads) });
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    const companyId = body.company_id;
    const text = String(body.body || '').trim();
    if (!companyId) return json(400, { error: 'company_id_required' });
    if (!text) return json(400, { error: 'empty_message' });
    const { data, error } = await sb.from('messages').insert({
      company_id: companyId, user_id: null, sender_role: 'staff', body: text,
      read_by_staff: true, read_by_user: false,
    }).select('id,created_at').single();
    if (error) return json(500, { error: error.message });
    await sb.from('notifications').insert({
      company_id: companyId, type: 'message', title: 'New message from MASEST',
      body: text.slice(0, 140), link: '/dashboard.html#messages',
    }).then(() => {}, () => {});
    // Email the company (best-effort) so buyers see the reply without checking the dashboard.
    const appUrl = env.APP_URL || new URL(request.url).origin;
    const emails = await companyEmails(sb, companyId);
    await sendEmail(env, { to: emails, subject: 'New message from MASEST',
      html: emailLayout({
        heading: 'New message from MASEST',
        bodyHtml: `<p>You have a new message from the MASEST team:</p><blockquote style="border-left:3px solid #0e7c86;padding-left:12px;color:#334;margin:12px 0">${htmlEscape(text)}</blockquote>`,
        ctaText: 'Reply in your dashboard', ctaUrl: `${appUrl}/dashboard.html#messages`,
      }) });
    return json(201, { id: data.id, created_at: data.created_at });
  }

  return json(405, { error: 'method_not_allowed' });
}
