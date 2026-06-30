// GET /api/admin/qbo/connect — staff-only Intuit OAuth consent bootstrap.
import { json, requireStaff } from '../../../_lib/supabase.js';
import { makeQboState, qboAuthorizationUrl } from '../../../_lib/qbo-oauth.js';
import { staffCanWrite } from '../../../_lib/authz.js';
import { qboConfigEnv, qboConfigStatus } from '../../../_lib/qbo-config.js';

export async function onRequestGet({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot connect QuickBooks.' });
  const qboEnv = qboConfigEnv(env);
  const qbo_config = qboConfigStatus(env);
  if (!qbo_config.ready) {
    return json(500, { error: 'qbo_oauth_not_configured', qbo_config, missing: qbo_config.missing });
  }

  const state = await makeQboState(qboEnv);
  const url = qboAuthorizationUrl(request, qboEnv, state);
  if (new URL(request.url).searchParams.get('format') === 'json') return json(200, { url });
  return new Response(null, { status: 302, headers: { location: url } });
}
