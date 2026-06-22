// POST /api/admin/qbo/retry - staff-only failed QBO sync requeue.
import { adminClient, json, readBody, requireStaff } from '../../../_lib/supabase.js';
import { staffCanWrite } from '../../../_lib/authz.js';

export async function onRequestPost({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });

  const body = await readBody(request);
  const id = String(body.id || '').trim();
  if (!id) return json(400, { error: 'order_id_required' });

  const { data, error } = await adminClient(env).from('orders')
    .update({
      qbo_sync_status: 'pending',
      qbo_attempts: 0,
      qbo_next_attempt_at: null,
      qbo_error: null,
    })
    .eq('id', id)
    .eq('qbo_sync_status', 'error')
    .select('id,qbo_sync_status,qbo_attempts,qbo_next_attempt_at')
    .maybeSingle();

  if (error) return json(500, { error: error.message || 'qbo_retry_failed' });
  if (!data) return json(404, { error: 'qbo_failed_order_not_found' });
  return json(200, { ok: true, order: data });
}
