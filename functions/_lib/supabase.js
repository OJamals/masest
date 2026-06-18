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

// Resolve the caller's pricing tier. Guests, anonymous requests, and non-approved
// accounts always get 'retail'. Approved B2B companies get companies.price_tier.
export async function tierForRequest(request, env) {
  const { user } = await userFromRequest(request, env);
  if (!user) return { tier: 'retail', user: null, companyId: null };
  const sb = adminClient(env);
  const { data: profile } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
  const companyId = profile?.company_id || null;
  if (!companyId) return { tier: 'retail', user, companyId: null };
  const { data: company } = await sb.from('companies').select('status,price_tier').eq('id', companyId).maybeSingle();
  const tier = (company?.status === 'approved' && company?.price_tier) ? company.price_tier : 'retail';
  return { tier, user, companyId };
}

// vsku -> explicit price for a given tier. Missing entries fall back to the
// variant base price (handled by the caller). Empty map if pre-migration.
export async function tierPriceMap(sb, tier) {
  const map = new Map();
  if (!tier) return map;
  try {
    const { data } = await sb.from('price_tiers').select('vsku,price').eq('tier', tier);
    for (const r of data || []) map.set(r.vsku, Number(r.price));
  } catch { /* price_tiers may not exist pre-migration → empty map = base price */ }
  return map;
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

// Member email addresses for a company (via the auth admin API). Best-effort, deduped.
export async function companyEmails(sb, companyId) {
  if (!companyId) return [];
  const { data: profiles } = await sb.from('profiles').select('id').eq('company_id', companyId);
  const ids = new Set((profiles || []).map((p) => p.id));
  if (!ids.size) return [];
  const emails = [];
  try {
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of data?.users || []) if (ids.has(u.id) && u.email) emails.push(u.email);
  } catch { /* auth admin unavailable */ }
  return [...new Set(emails)];
}

// Fire-and-forget transactional email via Resend. No-op unless RESEND_API_KEY + recipients exist.
export async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY || !Array.isArray(to) || !to.length) return false;
  const from = env.RESEND_FROM || 'MASEST <noreply@masest.co>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: to.slice(0, 50), subject, html }),
    });
    return r.ok;
  } catch { return false; }
}

// Minimal HTML escape for interpolating user/staff text into email bodies.
export function htmlEscape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
