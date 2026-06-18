// GET /api/admin/qbo/callback — stores Intuit OAuth tokens after staff-initiated connect.
import { adminClient, json } from '../../../_lib/supabase.js';
import { exchangeQboCode, verifyQboState } from '../../../_lib/qbo-oauth.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  if (error) return json(400, { error: 'qbo_oauth_error', detail: error });

  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const state = url.searchParams.get('state');
  if (!code || !realmId || !state) return json(400, { error: 'missing_qbo_oauth_params' });

  try {
    await verifyQboState(env, state);
  } catch (err) {
    return json(400, { error: 'invalid_qbo_oauth_state', detail: err?.message || String(err) });
  }

  let token;
  try {
    token = await exchangeQboCode(request, env, code);
  } catch (err) {
    return json(502, { error: 'qbo_oauth_exchange_failed', detail: err?.message || String(err) });
  }

  const now = new Date();
  const { error: upsertError } = await adminClient(env).from('qbo_tokens').upsert({
    id: 1,
    realm_id: realmId,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    access_expires_at: new Date(now.getTime() + Number(token.expires_in || 3600) * 1000).toISOString(),
    updated_at: now.toISOString(),
  }, { onConflict: 'id' });

  if (upsertError) return json(500, { error: upsertError.message || 'qbo_token_store_failed' });
  const done = new URL('/admin.html#overview', request.url);
  done.searchParams.set('qbo', 'connected');
  return new Response(null, { status: 302, headers: { location: done.toString() } });
}
