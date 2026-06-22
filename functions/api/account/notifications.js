// /api/account/notifications - in-app notifications for the caller's company.
// GET -> { notifications, unread } | POST { id } | { all:true } -> mark read
import { adminClient, userFromRequest, companyForUser, json, readBody } from '../../_lib/supabase.js';

export async function onRequest({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const sb = adminClient(env);
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return json(403, { error: 'no_company' });

  if (request.method === 'GET') {
    const { data, error } = await sb
      .from('notifications')
      .select('id,type,title,body,link,read,created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return json(500, { error: 'server_error' });
    const unread = (data || []).filter((n) => !n.read).length;
    return json(200, { notifications: data || [], unread });
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    let q = sb.from('notifications').update({ read: true }).eq('company_id', companyId);
    if (body.all) q = q.eq('read', false);
    else if (body.id) q = q.eq('id', body.id);
    else return json(400, { error: 'id_or_all_required' });
    const { error } = await q;
    if (error) return json(500, { error: 'server_error' });
    return json(200, { ok: true });
  }

  return json(405, { error: 'method_not_allowed' });
}
