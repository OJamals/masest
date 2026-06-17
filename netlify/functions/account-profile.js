// POST /api/account/profile — update the caller's own profile (name / phone). Self-scoped.
import { adminClient, userFromRequest, json, readBody } from '../lib/supabase.js';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const { user } = await userFromRequest(req);
  if (!user) return json(401, { error: 'unauthenticated' });

  const body = await readBody(req);
  const patch = {};
  if (body.full_name !== undefined) patch.full_name = String(body.full_name || '').slice(0, 120) || null;
  if (body.phone !== undefined) patch.phone = String(body.phone || '').slice(0, 40) || null;
  if (!Object.keys(patch).length) return json(400, { error: 'nothing_to_update' });

  const { error } = await sb_update(patch, user.id);
  if (error) return json(500, { error });
  return json(200, { ok: true });
};

async function sb_update(patch, id) {
  const sb = adminClient();
  const { error } = await sb.from('profiles').update(patch).eq('id', id);
  return { error: error?.message };
}

export const config = { path: '/api/account/profile' };
