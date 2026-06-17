// Shared helpers for Netlify Functions v2 (Web Request/Response). Outside functions/ dir
// so it is bundled as support code, not registered as its own endpoint.
import { createClient } from '@supabase/supabase-js';

// Service-role client — bypasses RLS. SERVER ONLY. Never return its key or use client-side.
export function adminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Resolve the authenticated user from an `Authorization: Bearer <token>` header.
export async function userFromRequest(req) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { user: null, token: null };
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
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

export async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}

// Resolve the caller's company_id (or null) for a given auth user id, using the service-role client.
export async function companyForUser(sb, userId) {
  if (!userId) return null;
  const { data } = await sb.from('profiles').select('company_id').eq('id', userId).maybeSingle();
  return data?.company_id || null;
}

// Platform-staff gate for /api/admin/*. AUTHORITATIVE source is the ADMIN_EMAILS env var
// (comma-separated, case-insensitive). The profiles.is_staff column only mirrors it for reads.
// Returns { user, staff }: staff=true only for an authenticated user whose email is allow-listed.
export async function requireStaff(req) {
  const { user } = await userFromRequest(req);
  if (!user) return { user: null, staff: false };
  const allow = (process.env.ADMIN_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const staff = allow.includes(String(user.email || '').toLowerCase());
  return { user, staff };
}
