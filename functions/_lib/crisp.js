// functions/_lib/crisp.js — outbound Crisp REST client (the return path the webhook
// bridge lacked). Best-effort: a missing plugin token is a no-op, never a throw.
// Plugin token from CRISP_TOKEN_ID / CRISP_TOKEN_KEY; website from MASEST_CRISP_ID.
const CRISP_API = 'https://api.crisp.chat/v1';

export function crispConfigured(env) {
  return Boolean(env && env.CRISP_TOKEN_ID && env.CRISP_TOKEN_KEY && env.MASEST_CRISP_ID);
}

// Crisp identity-verification signature = HMAC-SHA256(email) hex, using the dashboard's
// Identity Verification secret. The client passes it as the 2nd arg of `set user:email`
// so Crisp marks the session's email verified — a visitor can't claim an email they don't
// own (the signature is only issued by /api/account/me to the authenticated user). Async.
export async function crispIdentityToken(email, secret) {
  if (!secret || !email) return '';
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(email).toLowerCase()));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Build the message-create payload for an operator text message. Pure — unit-tested.
export function buildOperatorMessage(text) {
  return { type: 'text', from: 'operator', origin: 'chat', content: String(text ?? '').slice(0, 4000) };
}

function authHeaders(env) {
  const basic = btoa(`${env.CRISP_TOKEN_ID}:${env.CRISP_TOKEN_KEY}`);
  return { Authorization: `Basic ${basic}`, 'X-Crisp-Tier': 'plugin', 'content-type': 'application/json', accept: 'application/json' };
}

// Push an operator message into a Crisp conversation so the visitor sees the staff reply
// in their live chat widget. Returns { ok, status } / { ok:false, skipped|error }.
export async function sendCrispMessage(env, { sessionId, text } = {}) {
  if (!crispConfigured(env) || !sessionId || !String(text || '').trim()) return { ok: false, skipped: true };
  try {
    const resp = await fetch(
      `${CRISP_API}/website/${env.MASEST_CRISP_ID}/conversation/${encodeURIComponent(sessionId)}/message`,
      { method: 'POST', headers: authHeaders(env), body: JSON.stringify(buildOperatorMessage(text)) },
    );
    return { ok: resp.status >= 200 && resp.status < 300, status: resp.status };
  } catch {
    return { ok: false, error: true };
  }
}

// Fetch a conversation's messages (newest API shape returns { data: [...] }). Best-effort [].
export async function listCrispMessages(env, sessionId) {
  if (!crispConfigured(env) || !sessionId) return [];
  try {
    const resp = await fetch(
      `${CRISP_API}/website/${env.MASEST_CRISP_ID}/conversation/${encodeURIComponent(sessionId)}/messages`,
      { headers: authHeaders(env) },
    );
    if (!resp.ok) return [];
    const j = await resp.json();
    return Array.isArray(j?.data) ? j.data : [];
  } catch {
    return [];
  }
}
