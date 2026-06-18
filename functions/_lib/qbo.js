const OAUTH_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

export function qboBaseUrl(env = {}) {
  return String(env.QBO_ENVIRONMENT || 'sandbox').toLowerCase() === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

function basicAuth(clientId, clientSecret) {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

export async function getAccessToken(sb, env = {}, options = {}) {
  const now = options.now || new Date();
  const fetchImpl = options.fetchImpl || fetch;
  const { data: tokenRow, error } = await sb
    .from('qbo_tokens')
    .select('realm_id,refresh_token,access_token,access_expires_at')
    .eq('id', 1)
    .maybeSingle();

  if (error) throw new Error(error.message || 'qbo_token_read_failed');
  if (!tokenRow?.refresh_token && !tokenRow?.access_token) throw new Error('qbo_not_connected');

  const expiresAt = tokenRow.access_expires_at ? new Date(tokenRow.access_expires_at).getTime() : 0;
  if (tokenRow.access_token && expiresAt - now.getTime() > TOKEN_REFRESH_SKEW_MS) {
    return { accessToken: tokenRow.access_token, realmId: tokenRow.realm_id || env.QBO_REALM_ID || '' };
  }

  if (!tokenRow.refresh_token) throw new Error('qbo_refresh_token_missing');
  if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET) throw new Error('qbo_oauth_not_configured');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokenRow.refresh_token,
  });
  const response = await fetchImpl(OAUTH_URL, {
    method: 'POST',
    headers: {
      authorization: basicAuth(env.QBO_CLIENT_ID, env.QBO_CLIENT_SECRET),
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`qbo_token_refresh_failed:${response.status}:${detail.slice(0, 200)}`);
  }

  const refreshed = await response.json();
  const accessToken = refreshed.access_token;
  if (!accessToken) throw new Error('qbo_token_refresh_missing_access_token');

  const realmId = tokenRow.realm_id || env.QBO_REALM_ID || '';
  const payload = {
    realm_id: realmId,
    access_token: accessToken,
    refresh_token: refreshed.refresh_token || tokenRow.refresh_token,
    access_expires_at: new Date(now.getTime() + Number(refreshed.expires_in || 3600) * 1000).toISOString(),
    updated_at: now.toISOString(),
  };
  await sb.from('qbo_tokens').update(payload).eq('id', 1);

  return { accessToken, realmId };
}
