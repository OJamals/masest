// GET /api/admin/audit — staff-only read of the audit trail.
//   ?limit= (<=200)  ?action=  ?target_type=
import { adminClient, requireStaff, json } from '../../_lib/supabase.js';

export async function onRequestGet({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);
  const params = new URL(request.url).searchParams;
  const limit = Math.min(200, parseInt(params.get('limit') || '100', 10) || 100);

  let q = sb.from('audit_log')
    .select('id,actor_email,action,target_type,target_id,detail,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  const action = params.get('action');
  const targetType = params.get('target_type');
  if (action) q = q.eq('action', action);
  if (targetType) q = q.eq('target_type', targetType);

  const { data, error } = await q;
  if (error) return json(500, { error: 'server_error' });
  return json(200, { events: data || [] });
}
