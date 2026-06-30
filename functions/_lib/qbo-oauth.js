import { qboConfigEnv } from './qbo-config.js';

const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const INTUIT_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const STATE_TTL_MS = 10 * 60 * 1000;

function stateSecret(env) {
  const qboEnv = qboConfigEnv(env);
  return qboEnv.QBO_OAUTH_STATE_SECRET || qboEnv.QBO_SYNC_SECRET || qboEnv.QBO_CLIENT_SECRET;
}

function base64Url(bytes) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signState(payload, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return base64Url(signature);
}

export function qboRedirectUri(request, env) {
  const qboEnv = qboConfigEnv(env);
  return qboEnv.QBO_REDIRECT_URI || new URL('/api/admin/qbo/callback', request.url).toString();
}

export async function makeQboState(env, nowMs = Date.now()) {
  const secret = stateSecret(env);
  if (!secret) throw new Error('qbo_oauth_state_secret_not_configured');
  const nonce = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  const payload = `${nowMs + STATE_TTL_MS}.${nonce}`;
  return `${payload}.${await signState(payload, secret)}`;
}

export async function verifyQboState(env, state, nowMs = Date.now()) {
  const secret = stateSecret(env);
  if (!secret) throw new Error('qbo_oauth_state_secret_not_configured');
  const parts = String(state || '').split('.');
  if (parts.length !== 3) throw new Error('qbo_oauth_state_invalid');
  const payload = `${parts[0]}.${parts[1]}`;
  const expiresAt = Number(parts[0]);
  if (!Number.isFinite(expiresAt) || expiresAt < nowMs) throw new Error('qbo_oauth_state_expired');
  const expected = await signState(payload, secret);
  if (!timingSafeEqual(expected, parts[2])) throw new Error('qbo_oauth_state_invalid');
  return true;
}

export function qboAuthorizationUrl(request, env, state) {
  const qboEnv = qboConfigEnv(env);
  const params = new URLSearchParams({
    client_id: qboEnv.QBO_CLIENT_ID || '',
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: qboRedirectUri(request, qboEnv),
    state,
  });
  return `${INTUIT_AUTH_URL}?${params.toString()}`;
}

export async function exchangeQboCode(request, env, code) {
  const qboEnv = qboConfigEnv(env);
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', code);
  body.set('redirect_uri', qboRedirectUri(request, qboEnv));

  const response = await fetch(INTUIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${qboEnv.QBO_CLIENT_ID}:${qboEnv.QBO_CLIENT_SECRET}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`qbo_oauth_exchange_failed:${response.status}:${detail.slice(0, 200)}`);
  }
  return response.json();
}

// #26 — revoke a token at Intuit so the grant is killed on their side too (not just
// cleared locally). Pass the refresh token; revoking it invalidates the whole grant.
export async function revokeQboToken(env, token, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const qboEnv = qboConfigEnv(env);
  if (!token) return false;
  if (!qboEnv.QBO_CLIENT_ID || !qboEnv.QBO_CLIENT_SECRET) throw new Error('qbo_oauth_not_configured');
  const response = await fetchImpl(INTUIT_REVOKE_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${qboEnv.QBO_CLIENT_ID}:${qboEnv.QBO_CLIENT_SECRET}`)}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ token }),
  });
  return response.ok;
}
