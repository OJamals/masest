// /api/account/messages — support thread between the caller's company and MASEST staff.
//   GET             → { messages: [...] } (oldest→newest) + marks staff replies read_by_user
//   POST { body }   → buyer posts a message; also notifies staff (notification type 'message')
import { adminClient, userFromRequest, companyForUser, json, readBody } from '../lib/supabase.js';

export default async (req) => {
  const { user } = await userFromRequest(req);
  if (!user) return json(401, { error: 'unauthenticated' });

  const sb = adminClient();
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return json(403, { error: 'no_company' });

  if (req.method === 'GET') {
    const { data, error } = await sb
      .from('messages')
      .select('id,sender_role,body,order_id,created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) return json(500, { error: error.message });
    // Mark staff messages as read by the user (best-effort).
    await sb.from('messages').update({ read_by_user: true })
      .eq('company_id', companyId).eq('sender_role', 'staff').eq('read_by_user', false);
    return json(200, { messages: data || [] });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const text = String(body.body || '').trim();
    if (!text) return json(400, { error: 'empty_message' });
    if (text.length > 4000) return json(400, { error: 'message_too_long' });

    const { data, error } = await sb.from('messages').insert({
      company_id: companyId,
      user_id: user.id,
      sender_role: 'buyer',
      body: text,
      order_id: body.order_id || null,
      read_by_user: true,
      read_by_staff: false,
    }).select('id,created_at').single();
    if (error) return json(500, { error: error.message });
    return json(201, { id: data.id, created_at: data.created_at });
  }

  return json(405, { error: 'method_not_allowed' });
};

export const config = { path: '/api/account/messages' };
