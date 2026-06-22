// /api/account/notifications - in-app notifications for the caller's company.
// GET -> { notifications, unread } | POST { id } | { all:true } -> mark read
import { requireCompany, json, readBody } from '../../_lib/supabase.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';

export async function onRequest({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, sb } = ctx;

  if (request.method === 'GET') {
    const { limit, offset } = parsePage(new URL(request.url).searchParams, { defaultLimit: 50, maxLimit: 100 });
    const { data, error, count } = await sb
      .from('notifications')
      .select('id,type,title,body,link,read,created_at', { count: 'exact' })
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) return json(500, { error: 'server_error' });
    // True unread count, independent of the current page.
    const { count: unread } = await sb
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('read', false);
    return json(200, { notifications: data || [], unread: unread || 0, ...pageEnvelope(data, { limit, offset, count }) });
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
