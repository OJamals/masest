/* MASEST commerce — client auth helper (Phase 1 scaffold).
 * Not yet referenced by any page; wire into an account page in Phase 1 UI work.
 * Set these before import (e.g. injected at build, or a small inline <script>):
 *   window.MASEST_SUPABASE_URL, window.MASEST_SUPABASE_ANON
 * Loads Supabase from CDN so the static site needs no bundler. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const url = window.MASEST_SUPABASE_URL;
const anon = window.MASEST_SUPABASE_ANON;
export const supabase = url && anon ? createClient(url, anon) : null;

function requireClient() {
  if (!supabase) throw new Error('Supabase not configured: set MASEST_SUPABASE_URL / MASEST_SUPABASE_ANON');
  return supabase;
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
  return out;
}

/* Register a B2B account: create the auth user, then create the company (pending approval).
 * If email confirmation is ON, signUp returns no session — we return pending_email_confirmation
 * and the caller stashes {company, profile}, finishing via completeRegistration() after the user
 * confirms + logs in. captchaToken is required when Supabase Auth CAPTCHA (Turnstile) is enabled. */
export async function register({ email, password, company, profile, captchaToken }) {
  const sb = requireClient();
  const { data: signUp, error } = await sb.auth.signUp({
    email, password,
    options: captchaToken ? { captchaToken } : undefined,
  });
  if (error) throw error;
  const token = signUp.session?.access_token;
  if (!token) return { pending_email_confirmation: true };
  return postRegister(token, { company, profile });
}

/* Finish registration for a user who already has a session but no company yet — the
 * Confirm-email ON path, after the confirmation link establishes a session on return. */
export async function completeRegistration({ company, profile }) {
  const sb = requireClient();
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return postRegister(token, { company, profile });
}

export async function login({ email, password, captchaToken }) {
  const sb = requireClient();
  const { data, error } = await sb.auth.signInWithPassword({
    email, password,
    options: captchaToken ? { captchaToken } : undefined,
  });
  if (error) throw error;
  return data;
}

export async function logout() {
  await requireClient().auth.signOut();
}

/* Current account snapshot (profile + company + approval status), or null if logged out. */
export async function me() {
  const sb = requireClient();
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const r = await fetch('/api/account/me', { headers: { Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
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
