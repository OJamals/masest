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

/* Register a B2B account: create the auth user, then create the company (pending approval).
 * NOTE: if email confirmation is ON in Supabase Auth, signUp returns no session — the
 * register() call must run after the user confirms + logs in. For dev, disable confirmation. */
export async function register({ email, password, company, profile }) {
  const sb = requireClient();
  const { data: signUp, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  const token = signUp.session?.access_token;
  if (!token) return { pending_email_confirmation: true };
  const r = await fetch('/api/account/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ company, profile }),
  });
  const out = await r.json();
  if (!r.ok) throw new Error(out.error || 'register_failed');
  return out;
}

export async function login({ email, password }) {
  const sb = requireClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
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

/* Public catalog with mode flags (no auth needed). */
export async function catalog() {
  const r = await fetch('/api/products');
  if (!r.ok) throw new Error('catalog_failed');
  return (await r.json()).products;
}
