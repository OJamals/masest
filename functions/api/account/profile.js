// POST /api/account/profile — update the caller's own profile (name / phone). Self-scoped.
import { adminClient, userFromRequest, json, readBody } from '../../_lib/supabase.js';

export async function onRequestPost({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const body = await readBody(request);
  const patch = {};
  if (body.full_name !== undefined) patch.full_name = String(body.full_name || '').slice(0, 120) || null;
  if (body.phone !== undefined) patch.phone = String(body.phone || '').slice(0, 40) || null;
  if (!Object.keys(patch).length) return json(400, { error: 'nothing_to_update' });

  const sb = adminClient(env);
  const { error } = await sb.from('profiles').update(patch).eq('id', user.id);
  if (error) return json(500, { error: 'server_error' });
  return json(200, { ok: true });
}
