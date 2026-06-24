/* MASEST commerce - client auth helper (Phase 1 scaffold).
 * Not yet referenced by any page; wire into an account page in Phase 1 UI work.
 * Set these before import (e.g. injected at build, or a small inline <script>):
 *   window.MASEST_SUPABASE_URL, window.MASEST_SUPABASE_ANON
 * Supabase is self-hosted (vendor/supabase-js.esm.js), NOT loaded from a third-party
 * CDN — an esm.sh 503 outage previously took down all auth site-wide. Regenerate the
 * bundle per the header in that file. */
import { createClient } from '../vendor/supabase-js.esm.js';

const url = window.MASEST_SUPABASE_URL;
const anon = window.MASEST_SUPABASE_ANON;
export const supabase = url && anon ? createClient(url, anon) : null;

function requireClient() {
  if (!supabase) throw new Error('Supabase not configured: set MASEST_SUPABASE_URL / MASEST_SUPABASE_ANON');
  return supabase;
}

// Notify the rest of the page (e.g. the nav account control) that auth state changed,
// so controls rendered once at load can re-render without a full reload.
function emitAuth() {
  try { document.dispatchEvent(new CustomEvent('masest:auth')); } catch {}
}

// POST the company/profile to the registration function using a valid session token.
async function postRegister(token, { company, profile }) {
  const r = await fetch('/api/account/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ company, profile }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || 'register_failed');
  emitAuth();
  return out;
}

/* Register a B2B account: create the auth user, then create the company (pending approval).
 * If email confirmation is ON, signUp returns no session - we return pending_email_confirmation
 * and the caller stashes {company, profile}, finishing via completeRegistration() after the user
 * confirms + logs in. captchaToken is required when Supabase Auth CAPTCHA (Turnstile) is enabled. */
export async function register({ email, password, company, profile, captchaToken }) {
  const sb = requireClient();
  const options = { emailRedirectTo: `${window.location.origin}/account.html` };
  if (captchaToken) options.captchaToken = captchaToken;
  const { data: signUp, error } = await sb.auth.signUp({ email, password, options });
  if (error) throw error;
  const token = signUp.session?.access_token;
  if (!token) return { pending_email_confirmation: true };
  return postRegister(token, { company, profile });
}

/* Finish registration for a user who already has a session but no company yet - the
 * Confirm-email ON path, after the confirmation link establishes a session on return. */
export async function completeRegistration({ company, profile }) {
  const sb = requireClient();
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return postRegister(token, { company, profile });
}

/* Resend the signup confirmation email (when the prior link expired or was consumed). */
export async function resendConfirmation(email) {
  return requireClient().auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${window.location.origin}/account.html` },
  });
}

export async function login({ email, password, captchaToken }) {
  const sb = requireClient();
  const { data, error } = await sb.auth.signInWithPassword({
    email, password,
    options: captchaToken ? { captchaToken } : undefined,
  });
  if (error) throw error;
  emitAuth();
  return data;
}

export async function resetPasswordForEmail(email) {
  const sb = requireClient();
  const redirectTo = new URL('account.html?mode=reset-password', window.location.href).href;
  const { data, error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
  return data;
}

export async function updatePassword(password) {
  const sb = requireClient();
  const { data, error } = await sb.auth.updateUser({ password });
  if (error) throw error;
  return data;
}

export function onPasswordRecovery(callback) {
  return requireClient().auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') callback(session);
  });
}

export async function logout() {
  await requireClient().auth.signOut();
  emitAuth();
}

/* Current account snapshot (profile + company + approval status), or null if logged out. */
export async function me() {
  const sb = requireClient();
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const r = await fetch('/api/account/me', { headers: { Authorization: `Bearer ${token}` } });
  if (r.ok) return r.json();
  // Authenticated but no company/profile yet (email confirmed before the company step ran):
  // surface it so the page can offer a "finish setup" form instead of looking logged-out.
  const body = await r.json().catch(() => null);
  if (r.status === 404 && body?.error === 'no_profile') return { needs_profile: true, email: body.email, can_admin: body.can_admin === true, staff: body.staff || null };
  return null;
}

/* Recent orders for the signed-in account (company orders + line items), or [] if logged out. */
export async function orders() {
  const sb = requireClient();
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return [];
  const r = await fetch('/api/account/orders', { headers: { Authorization: `Bearer ${token}` } });
  return r.ok ? (await r.json()).orders : [];
}

/* Public catalog with mode flags (no auth needed). */
export async function catalog() {
  const r = await fetch('/api/products');
  if (!r.ok) throw new Error('catalog_failed');
  return (await r.json()).products;
}

/* Current session access token, or null if logged out. */
export async function getToken() {
  const sb = requireClient();
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}

/* Force a token refresh (used when the API rejects a request as expired). Returns true
 * if a fresh session was obtained. */
async function refreshSession() {
  try {
    const { data, error } = await requireClient().auth.refreshSession();
    return !error && !!data?.session;
  } catch { return false; }
}

/* Broadcast that the session is gone so pages can stop pollers and prompt re-auth
 * (listen for 'masest:session-expired'). */
function emitSessionExpired() {
  try { document.dispatchEvent(new CustomEvent('masest:session-expired')); } catch {}
}

/* Authenticated JSON fetch helper for /api/* endpoints. Attaches the Bearer token,
 * JSON-encodes the body, and throws an Error (with .status and .data) on non-2xx.
 * On a 401 it refreshes the session and retries once; if still unauthorized it emits
 * 'masest:session-expired' so the UI can recover instead of silently failing. */
export async function api(path, { method = 'GET', body, _retried = false } = {}) {
  const token = await getToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (r.status === 401 && !_retried && await refreshSession()) {
    return api(path, { method, body, _retried: true });
  }
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) emitSessionExpired();
    throw Object.assign(new Error(out.error || 'request_failed'), { status: r.status, data: out });
  }
  return out;
}
