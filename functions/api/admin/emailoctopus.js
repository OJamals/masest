import { adminClient, json, requireStaff } from '../../_lib/supabase.js';

export async function onRequestGet({ request, env }, { authorize, createClient = adminClient } = {}) {
  const { user, staff } = authorize ? await authorize(request, env) : await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  try {
    const { data, error } = await createClient(env).rpc('emailoctopus_status');
    if (error || !data) return json(503, { error: 'emailoctopus_status_unavailable' });
    return json(200, {
      checked_at: data.checked_at || null,
      last_synced_at: data.last_synced_at || null,
      pending: Number(data.pending) || 0, synced: Number(data.synced) || 0,
      dead: Number(data.dead) || 0, blocked: Number(data.blocked) || 0,
    });
  } catch { return json(503, { error: 'emailoctopus_status_unavailable' }); }
}
