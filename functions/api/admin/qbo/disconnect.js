import { adminClient, json, requireStaff } from '../../../_lib/supabase.js';
import { staffCanWrite } from '../../../_lib/authz.js';
import { revokeQboToken } from '../../../_lib/qbo-oauth.js';

// POST /api/admin/qbo/disconnect — revoke the Intuit grant and clear local tokens (#26).
export async function onRequestPost({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot disconnect QuickBooks.' });

  const sb = adminClient(env);
  const { data: tokenRow } = await sb.from('qbo_tokens')
    .select('refresh_token').eq('id', 1).maybeSingle();

  // Best-effort revoke at Intuit; clear local tokens regardless so a re-connect starts clean
  // even if the grant was already dead on their side.
  let revoked = false;
  try { revoked = await revokeQboToken(env, tokenRow?.refresh_token); }
  catch { /* fall through to local clear */ }

  const { error } = await sb.from('qbo_tokens')
    .update({ access_token: null, refresh_token: null, access_expires_at: null, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) return json(500, { error: error.message || 'qbo_disconnect_failed' });

  return json(200, { ok: true, revoked });
}
