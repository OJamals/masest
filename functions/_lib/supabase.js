// Shared helpers for Cloudflare Pages Functions (Workers runtime, Web Request/Response).
// `_`-prefixed dir → not routed, but importable by sibling functions.
// Cloudflare has no `process.env`; env vars arrive via the per-request `env` binding,
// so every helper that needs a secret takes `env` explicitly.
import { createClient } from '@supabase/supabase-js';

// Service-role client — bypasses RLS. SERVER ONLY. Never return its key or use client-side.
export function adminClient(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Resolve the authenticated user from an `Authorization: Bearer <token>` header.
export async function userFromRequest(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { user: null, token: null };
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return { user: null, token };
  return { user: data.user, token };
}

export function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

export async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

// Resolve the caller's company_id (or null) for a given auth user id, via the service-role client.
export async function companyForUser(sb, userId) {
  if (!userId) return null;
  const { data } = await sb.from('profiles').select('company_id').eq('id', userId).maybeSingle();
  return data?.company_id || null;
}

// Platform-staff gate for /api/admin/*. AUTHORITATIVE source is the ADMIN_EMAILS env var
// (comma-separated, case-insensitive). Returns { user, staff }.
export async function requireStaff(request, env) {
  const { user } = await userFromRequest(request, env);
  if (!user) return { user: null, staff: false };
  const allow = (env.ADMIN_EMAILS || env.ADMIN_EMAIL || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  let staff = allow.includes(String(user.email || '').toLowerCase());
  // Fallback: a profiles.is_staff=true flag (settable only server-side / via SQL) also grants staff,
  // so staff can be added/removed in the DB without a Cloudflare redeploy of ADMIN_EMAILS.
  if (!staff) {
    try {
      const { data } = await adminClient(env).from('profiles').select('is_staff').eq('id', user.id).maybeSingle();
      staff = !!data?.is_staff;
    } catch { /* is_staff column may not exist pre-migration → env gate only */ }
  }
  return { user, staff };
}
