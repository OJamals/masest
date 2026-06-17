// /api/account/messages — support thread between the caller's company and MASEST staff.
//   GET → thread (marks staff msgs read by user) · POST { body } → buyer posts (+ staff notification)
import { adminClient, userFromRequest, companyForUser, json, readBody } from '../../_lib/supabase.js';

export async function onRequest({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const sb = adminClient(env);
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return json(403, { error: 'no_company' });

  if (request.method === 'GET') {
    const { data, error } = await sb
      .from('messages')
      .select('id,sender_role,body,order_id,created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) return json(500, { error: error.message });
    await sb.from('messages').update({ read_by_user: true })
      .eq('company_id', companyId).eq('sender_role', 'staff').eq('read_by_user', false);
    return json(200, { messages: data || [] });
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    const text = String(body.body || '').trim();
    if (!text) return json(400, { error: 'empty_message' });
    if (text.length > 4000) return json(400, { error: 'message_too_long' });
    const { data, error } = await sb.from('messages').insert({
      company_id: companyId, user_id: user.id, sender_role: 'buyer', body: text,
      order_id: body.order_id || null, read_by_user: true, read_by_staff: false,
    }).select('id,created_at').single();
    if (error) return json(500, { error: error.message });
    return json(201, { id: data.id, created_at: data.created_at });
  }

  return json(405, { error: 'method_not_allowed' });
}
