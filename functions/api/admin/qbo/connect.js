// GET /api/admin/qbo/connect — staff-only Intuit OAuth consent bootstrap.
import { json, requireStaff } from '../../../_lib/supabase.js';
import { makeQboState, qboAuthorizationUrl } from '../../../_lib/qbo-oauth.js';

export async function onRequestGet({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET) {
    return json(500, { error: 'qbo_oauth_not_configured' });
  }

  const state = await makeQboState(env);
  const url = qboAuthorizationUrl(request, env, state);
  if (new URL(request.url).searchParams.get('format') === 'json') return json(200, { url });
  return new Response(null, { status: 302, headers: { location: url } });
}
