// Shared helpers for Cloudflare Pages Functions (Workers runtime, Web Request/Response).
// `_`-prefixed dir → not routed, but importable by sibling functions.
// Cloudflare has no `process.env`; env vars arrive via the per-request `env` binding,
// so every helper that needs a secret takes `env` explicitly.
import { createClient } from '@supabase/supabase-js';
import { filterByStream, categoryStream, unsubscribeToken, htmlToText } from './email.js';
import { isStaffEmail, normalizeStaffRole } from './authz.js';

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

// Auth gate for company-scoped account routes (#38). Returns { user, companyId, sb }
// on success, or { error: Response } to return early — collapses the repeated
// userFromRequest → 401 → companyForUser → 403 boilerplate into one call.
export async function requireCompany(request, env) {
  const { user } = await userFromRequest(request, env);
  if (!user) return { error: json(401, { error: 'unauthenticated' }) };
  const sb = adminClient(env);
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return { error: json(403, { error: 'no_company' }) };
  return { user, companyId, sb };
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
  if (!user) return { user: null, staff: false, role: null };
  // ADMIN_EMAILS members are root operators → owner (full capability).
  if (isStaffEmail(user.email, env)) return { user, staff: true, role: 'owner' };
  // Fallback: profiles.is_staff=true (settable only server-side / via SQL) also grants
  // staff, so staff can be added/removed in the DB without a Cloudflare redeploy.
  // profiles.staff_role (#21) narrows the tier; older rows without one default to owner.
  try {
    const { data } = await adminClient(env).from('profiles').select('is_staff,staff_role').eq('id', user.id).maybeSingle();
    if (data?.is_staff) return { user, staff: true, role: normalizeStaffRole(data.staff_role) };
  } catch { /* is_staff/staff_role column may not exist pre-migration → env gate only */ }
  return { user, staff: false, role: null };
}

// Resolve auth emails for a known set of user ids via getUserById — O(ids), not
// O(all-users). Best-effort: failed lookups are skipped. Returns { [id]: email }.
export async function emailsByIds(sb, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const out = {};
  await Promise.all(unique.map(async (id) => {
    try {
      const { data } = await sb.auth.admin.getUserById(id);
      if (data?.user?.email) out[id] = data.user.email;
    } catch { /* skip unresolved id */ }
  }));
  return out;
}

// Full id→email map for admin directories. Pages through listUsers so it never
// truncates past a single page. Best-effort (stops on error).
export async function allUserEmails(sb, { pageSize = 1000, maxPages = 100 } = {}) {
  const out = new Map();
  for (let page = 1; page <= maxPages; page++) {
    let users;
    try {
      const { data } = await sb.auth.admin.listUsers({ page, perPage: pageSize });
      users = data?.users || [];
    } catch { break; }
    for (const u of users) out.set(u.id, u.email);
    if (users.length < pageSize) break;
  }
  return out;
}

// Notification preference columns (#19). category → profiles boolean column.
const NOTIFY_PREF_COLUMN = {
  orders: 'notify_orders',
  offers: 'notify_offers',
  messages: 'notify_messages',
};

// Keep only the known boolean preference flags from an arbitrary patch body.
export function sanitizeNotificationPrefs(body) {
  const out = {};
  const src = body || {};
  for (const col of Object.values(NOTIFY_PREF_COLUMN)) {
    if (typeof src[col] === 'boolean') out[col] = src[col];
  }
  return out;
}

// Member email addresses for a company. Best-effort, deduped. When `category` is
// given, members who opted out of that category (notify_* === false) are excluded;
// a missing/null preference counts as opted-in.
export async function companyEmails(sb, companyId, category) {
  if (!companyId) return [];
  const prefCol = NOTIFY_PREF_COLUMN[category];
  const cols = prefCol ? `id,${prefCol}` : 'id';
  const { data: profiles } = await sb.from('profiles').select(cols).eq('company_id', companyId);
  const ids = (profiles || [])
    .filter((p) => !prefCol || p[prefCol] !== false)
    .map((p) => p.id);
  if (!ids.length) return [];
  const byId = await emailsByIds(sb, ids);
  return [...new Set(Object.values(byId))];
}

// Fire-and-forget transactional email via Resend. No-op unless RESEND_API_KEY + recipients exist.
// Load the subset of `emails` that are suppressed. Fails open (empty Set on error).
// Returns Map<emailLower, Set<stream>> for the given addresses. Fails open (empty Map).
export async function loadSuppressed(env, emails) {
  try {
    const sb = adminClient(env);
    const lowered = emails.map((e) => String(e).toLowerCase());
    const { data } = await sb.from('email_suppressions').select('email,stream').in('email', lowered);
    const map = new Map();
    for (const r of data || []) {
      const key = String(r.email).toLowerCase();
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(r.stream || 'all');
    }
    return map;
  } catch {
    return new Map();
  }
}

// Best-effort insert of an email_events row. Never throws.
export async function logEmailEvent(env, { resend_id, to_email, category, subject, status, error }) {
  try {
    await adminClient(env).from('email_events').insert({
      resend_id: resend_id || null, to_email, category: category || null,
      subject: subject || null, status, error: error || null,
    });
  } catch { /* logging is advisory; never block the send */ }
}

// Update email_events status by Resend id (best-effort, idempotent).
export async function updateEmailStatus(env, resendId, status) {
  if (!resendId || !status) return;
  try {
    await adminClient(env).from('email_events')
      .update({ status, updated_at: new Date().toISOString() }).eq('resend_id', resendId);
  } catch { /* advisory */ }
}

// Upsert a suppression for one stream (best-effort). stream 'all' = hard block
// (bounce/complaint, the default); 'marketing' = unsubscribe (transactional still sends).
export async function recordSuppression(env, email, reason, stream = 'all') {
  if (!email) return;
  try {
    await adminClient(env).from('email_suppressions')
      .upsert({ email: String(email).toLowerCase(), reason, stream }, { onConflict: 'email,stream' });
  } catch { /* advisory */ }
}

export async function sendEmail(env, { to, bcc = [], subject, html, text = null, category = null, idempotencyKey = null, replyTo = null, attachments = [] }) {
  const allTo = Array.isArray(to) ? to : [];
  const allBcc = Array.isArray(bcc) ? bcc : [];
  if (!env.RESEND_API_KEY || (!allTo.length && !allBcc.length)) return false;
  const from = env.RESEND_FROM || 'MASEST <noreply@masest.co>';
  const suppressed = await loadSuppressed(env, [...allTo, ...allBcc]);
  // Per-stream: a marketing opt-out blocks only marketing categories; hard blocks ('all')
  // block everything. Transactional receipts survive a marketing unsubscribe.
  const toR = filterByStream(allTo, category, suppressed).slice(0, 50);
  const bccR = filterByStream(allBcc, category, suppressed).slice(0, 50);
  const logTo = [...allTo, ...allBcc].join(', ');
  if (!toR.length && !bccR.length) {
    await logEmailEvent(env, { to_email: logTo, category, subject, status: 'failed', error: 'all_recipients_suppressed' });
    return false;
  }
  // Resend requires a `to`; if only bcc recipients survive, use `from` as the visible to.
  const payloadTo = toR.length ? toR : [from];
  const sentTo = [...toR, ...bccR].join(', ');
  // Idempotency-Key dedupes a logical email for 24h, so a retried Stripe/QBO webhook
  // can't double-send. reply_to defaults to RESEND_REPLY_TO so replies reach a human.
  const reply = replyTo || env.RESEND_REPLY_TO || null;
  // Always send multipart: a caller-supplied text wins, else derive one from the HTML.
  // text/plain improves spam scoring and serves plain-text clients + screen readers.
  const bodyText = text || htmlToText(html) || null;
  const headers = { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 256);
  // Marketing categories carry a one-click List-Unsubscribe (token-signed, single recipient)
  // → suppresses only the 'marketing' stream, so the buyer keeps order/billing receipts.
  if (categoryStream(category) === 'marketing' && env.EMAIL_UNSUB_SECRET && toR.length === 1) {
    const target = toR[0];
    const tok = await unsubscribeToken(target, env.EMAIL_UNSUB_SECRET);
    const url = `${env.APP_URL || 'https://masest.co'}/api/email/unsubscribe?email=${encodeURIComponent(target)}&token=${tok}`;
    headers['List-Unsubscribe'] = `<${url}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from, to: payloadTo, ...(bccR.length ? { bcc: bccR } : {}), subject, html,
        ...(bodyText ? { text: bodyText } : {}), ...(reply ? { reply_to: reply } : {}),
        // Resend fetches `path` URLs itself (no extra latency here); 40MB cap. Caller
        // builds these (e.g. order SDS PDFs via sds-docs.js); omitted when empty.
        ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
      }),
    });
    let resendId = null;
    try { resendId = (await r.clone().json())?.id || null; } catch { /* non-json body */ }
    await logEmailEvent(env, {
      resend_id: resendId, to_email: sentTo, category, subject,
      status: r.ok ? 'sent' : 'failed', error: r.ok ? null : `resend_${r.status}`,
    });
    return r.ok;
  } catch (err) {
    await logEmailEvent(env, { to_email: sentTo, category, subject, status: 'failed', error: String(err).slice(0, 200) });
    return false;
  }
}

// Shared branded email shell. Callers pass already-escaped/safe heading + bodyHtml
// (escape user input with htmlEscape first). Matches the order-confirmation design.
function safeEmailHref(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/')) return htmlEscape(raw);
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:') return htmlEscape(url.toString());
  } catch {
    return '';
  }
  return '';
}

export function emailLayout({ heading = '', bodyHtml = '', ctaText, ctaUrl } = {}) {
  const href = safeEmailHref(ctaUrl);
  const cta = ctaText && href
    ? `<div style="margin:24px 0 0"><a href="${href}" style="display:inline-block;background:#0e7c86;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:999px">${htmlEscape(ctaText)}</a></div>`
    : '';
  return `
  <div style="background:#f4f7f7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:580px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e4e6e9">
      <div style="background:#0e7c86;padding:20px 28px">
        <span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:.04em">MASEST &middot; VertKleen</span>
      </div>
      <div style="padding:28px;color:#223;font-size:15px;line-height:1.55">
        ${heading ? `<h1 style="margin:0 0 14px;font-size:20px;color:#15171c">${heading}</h1>` : ''}
        ${bodyHtml}
        ${cta}
      </div>
      <div style="background:#0b0d12;padding:18px 28px;color:#8a93a0;font-size:11px;line-height:1.7">
        MASEST &middot; VertKleen industrial &amp; HVAC chemistry<br>
        <a href="mailto:matthew@masest.co" style="color:#8a93a0">matthew@masest.co</a> &middot; (813) 406-3852
      </div>
    </div>
  </div>`;
}

// Minimal HTML escape for interpolating user/staff text into email bodies.
export function htmlEscape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
