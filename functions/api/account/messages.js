// /api/account/messages — support thread between the caller's company and MASEST staff.
//   GET → thread (marks staff msgs read by user unless ?peek=1) · POST { body } → buyer posts (+ staff notification)
import { adminClient, userFromRequest, companyForUser, json, readBody, sendEmail, emailLayout } from '../../_lib/supabase.js';
import { rateLimit, clientIp } from '../../_lib/ratelimit.js';

export async function onRequest({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const sb = adminClient(env);
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return json(403, { error: 'no_company' });

  if (request.method === 'GET') {
    const peek = new URL(request.url).searchParams.get('peek') === '1';
    const { data, error } = await sb
      .from('messages')
      .select('id,sender_role,body,order_id,created_at')
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
    // Throttle per author: each post fires a staff-alert email.
    const rl = await rateLimit(env, 'support-message', user.id || clientIp(request), { limit: 10, windowSec: 60 });
    if (!rl.ok) return json(429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfter || 60) });
    const body = await readBody(request);
    const text = String(body.body || '').trim();
    if (!text) return json(400, { error: 'empty_message' });
    if (text.length > 4000) return json(400, { error: 'message_too_long' });
    const { data, error } = await sb.from('messages').insert({
      company_id: companyId, user_id: user.id, sender_role: 'buyer', body: text,
      order_id: body.order_id || null, read_by_user: true, read_by_staff: false,
    }).select('id,created_at').single();
    if (error) return json(500, { error: 'server_error' });

    // Best-effort staff email alert (rate-limited above).
    const staffTo = (env.ADMIN_EMAILS || env.ADMIN_EMAIL || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (staffTo.length) {
      let companyName = companyId;
      try {
        const { data: co } = await sb.from('companies').select('name').eq('id', companyId).maybeSingle();
        if (co?.name) companyName = co.name;
      } catch { /* fall back to id */ }
      await sendEmail(env, {
        to: staffTo,
        subject: `New message from ${companyName}`,
        html: emailLayout({
          heading: 'New customer message',
          bodyHtml: `<p>Company: ${companyName}</p><p>${text.slice(0, 500)}</p>`,
          ctaText: 'Open admin messages',
          ctaUrl: 'https://masest.co/admin.html#messages',
        }),
        category: 'staff_alert',
      });
    }

    return json(201, { id: data.id, created_at: data.created_at });
  }

  return json(405, { error: 'method_not_allowed' });
}
