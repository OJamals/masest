// Shared helpers for Cloudflare Pages Functions (Workers runtime, Web Request/Response).
// `_`-prefixed dir → not routed, but importable by sibling functions.
// Cloudflare has no `process.env`; env vars arrive via the per-request `env` binding,
// so every helper that needs a secret takes `env` explicitly.
import { createClient } from '@supabase/supabase-js';
import { filterByStream, categoryPolicy, unsubscribeToken, htmlToText } from './email.js';
import { isStaffEmail, platformStaffRole } from './authz.js';
import {
  CommerceContextError,
  resolveCommerceContextSnapshot,
} from './commerce-context.js';

export { CommerceContextError } from './commerce-context.js';
export { emailLayout } from './email-template.js';

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
  if (error || !data?.user) return { user: null, token, error: error || null };
  return { user: data.user, token };
}

export function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function reportInternalError(scope, error) {
  const detail = error && typeof error === 'object' && 'message' in error
    ? error.message
    : error;
  console.error(`[${String(scope || 'server_error')}]`, String(detail || 'unknown_error').slice(0, 1000));
}

export function internalServerError(scope, error) {
  reportInternalError(scope, error);
  return json(500, { error: 'server_error' });
}

export async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

export async function resolveCommerceContext(request, env, dependencies = {}) {
  return resolveCommerceContextSnapshot({
    request,
    env,
    userFromRequest: dependencies.userFromRequest || userFromRequest,
    adminClient: dependencies.adminClient || adminClient,
  });
}

function commerceContextUnavailable() {
  return json(503, { error: 'commerce_context_unavailable', retryable: true });
}

// Auth gate for company-scoped account routes (#38). All account surfaces now consume the
// same typed commerce snapshot Checkout uses, so a profile/company query failure can never
// be mistaken for an anonymous or retail Buyer.
export async function requireCompany(request, env, dependencies = {}) {
  let context;
  try {
    context = await (dependencies.resolveCommerceContext || resolveCommerceContext)(request, env, dependencies);
  } catch (error) {
    if (error instanceof CommerceContextError) return { error: commerceContextUnavailable() };
    return { error: commerceContextUnavailable() };
  }
  if (!context.user) return { error: json(401, { error: 'unauthenticated' }) };
  if (!context.companyId) return { error: json(403, { error: 'no_company' }) };
  return { ...context, context };
}

export async function requireCommerceUser(request, env, dependencies = {}) {
  let context;
  try {
    context = await (dependencies.resolveCommerceContext || resolveCommerceContext)(request, env, dependencies);
  } catch {
    return { error: commerceContextUnavailable() };
  }
  if (!context.user) return { error: json(401, { error: 'unauthenticated' }) };
  return { ...context, context };
}

// Resolve the caller's pricing tier. Guests, anonymous requests, and non-approved
// accounts always get 'retail'. Approved B2B companies get companies.price_tier.
export async function tierForRequest(request, env, dependencies = {}) {
  const context = await (dependencies.resolveCommerceContext || resolveCommerceContext)(request, env, dependencies);
  return { tier: context.tier, user: context.user, companyId: context.companyId, context };
}

// vsku -> explicit price for a given tier. Missing entries fall back to the
// variant base price (handled by the caller). Empty map if pre-migration.
export async function tierPriceMap(sb, tier) {
  const map = new Map();
  if (!tier) return map;
  try {
    const { data, error } = await sb.from('price_tiers').select('vsku,price').eq('tier', tier);
    if (error) throw error;
    for (const r of data || []) map.set(r.vsku, Number(r.price));
  } catch (error) {
    throw new CommerceContextError('pricing', error);
  }
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
  // profiles.staff_role narrows the tier. Missing or unknown roles fail closed.
  try {
    const { data } = await adminClient(env).from('profiles').select('is_staff,staff_role').eq('id', user.id).maybeSingle();
    const role = platformStaffRole(data);
    if (role) return { user, staff: true, role };
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
export async function allUserEmails(sb, { pageSize = 1000, maxPages = 100, strict = false } = {}) {
  const out = new Map();
  let complete = false;
  for (let page = 1; page <= maxPages; page++) {
    let users;
    try {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: pageSize });
      if (error) throw error;
      users = data?.users || [];
    } catch (error) {
      if (strict) throw error;
      break;
    }
    for (const u of users) out.set(u.id, u.email);
    if (users.length < pageSize) {
      complete = true;
      break;
    }
  }
  if (strict && !complete) throw new Error('user_directory_truncated');
  return out;
}

// Optional notification preferences. Required transactional mail has no opt-out.
const NOTIFY_PREF_COLUMN = {
  offers: 'marketing_email_enabled',
  messages: 'notify_messages',
};

const EDITABLE_EMAIL_PREFS = ['marketing_email_enabled', 'notify_messages'];

// Keep only the known boolean preference flags from an arbitrary patch body.
export function sanitizeNotificationPrefs(body) {
  const out = {};
  const src = body || {};
  for (const col of EDITABLE_EMAIL_PREFS) {
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

// Transactional delivery uses the private Cloudflare Worker service binding below.
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
export async function logEmailEvent(env, {
  provider_message_id,
  to_email,
  category,
  subject,
  status,
  error,
}) {
  try {
    await adminClient(env).from('email_events').insert({
      provider_message_id: provider_message_id || null, to_email, category: category || null,
      subject: subject || null, status, error: error || null,
    });
  } catch { /* logging is advisory; never block the send */ }
}

// Update email_events status by provider message id (best-effort, idempotent).
export async function updateEmailStatus(env, providerMessageId, status) {
  if (!providerMessageId || !status) return;
  try {
    await adminClient(env).from('email_events')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('provider_message_id', providerMessageId);
  } catch { /* advisory */ }
}

// Upsert a suppression for one stream. stream 'all' = hard block
// (bounce/complaint, the default); 'marketing' = unsubscribe (transactional still sends).
export async function recordSuppression(env, email, reason, stream = 'all') {
  if (!email) return false;
  try {
    const { error } = await adminClient(env).from('email_suppressions')
      .upsert({ email: String(email).toLowerCase(), reason, stream }, { onConflict: 'email,stream' });
    return !error;
  } catch {
    return false;
  }
}

// Remove only one explicit suppression stream. Used when an authenticated user opts
// marketing back in; hard bounce/complaint rows ('all') are never cleared here.
export async function clearSuppression(env, email, stream = 'marketing') {
  if (!email || stream === 'all') return false;
  try {
    const { error } = await adminClient(env).from('email_suppressions')
      .delete().eq('email', String(email).trim().toLowerCase()).eq('stream', stream);
    return !error;
  } catch {
    return false;
  }
}

async function emailIdempotencyKey(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `v1/${hex}`;
}

export function emailConfigured(env) {
  return typeof env?.EMAIL_SERVICE?.fetch === 'function';
}

export async function sendEmailResult(env, {
  to,
  bcc = [],
  subject,
  html,
  text = null,
  category = null,
  idempotencyKey = null,
  replyTo = null,
  emailHeaders = {},
  attachments = [],
  fetchImpl = globalThis.fetch,
  suppressionLoader = loadSuppressed,
}) {
  const allTo = Array.isArray(to) ? to : [];
  const allBcc = Array.isArray(bcc) ? bcc : [];
  const bindingFetch = emailConfigured(env) ? env.EMAIL_SERVICE.fetch.bind(env.EMAIL_SERVICE) : null;
  const serviceFetch = bindingFetch || (fetchImpl !== globalThis.fetch ? fetchImpl : null);
  if (!serviceFetch || (!allTo.length && !allBcc.length)) {
    return { ok: false, retryable: false, error: 'email_not_configured' };
  }
  const policy = categoryPolicy(category);
  if (!policy) {
    await logEmailEvent(env, {
      to_email: [...allTo, ...allBcc].join(', '),
      category,
      subject,
      status: 'failed',
      error: 'email_category_required',
    });
    return { ok: false, retryable: false, error: 'email_category_required' };
  }
  if (policy.stream === 'marketing') {
    await logEmailEvent(env, {
      to_email: [...allTo, ...allBcc].join(', '),
      category,
      subject,
      status: 'failed',
      error: 'marketing_provider_required',
    });
    return { ok: false, retryable: false, error: 'marketing_provider_required' };
  }
  const suppressed = await suppressionLoader(env, [...allTo, ...allBcc]);
  // Per-stream: a marketing opt-out blocks only marketing categories; hard blocks ('all')
  // block everything. Transactional receipts survive a marketing unsubscribe.
  const toR = filterByStream(allTo, category, suppressed).slice(0, 50);
  const bccR = filterByStream(allBcc, category, suppressed).slice(0, 50 - toR.length);
  const logTo = [...allTo, ...allBcc].join(', ');
  if (!toR.length && !bccR.length) {
    await logEmailEvent(env, { to_email: logTo, category, subject, status: 'failed', error: 'all_recipients_suppressed' });
    return { ok: false, suppressed: true, retryable: false, error: 'all_recipients_suppressed' };
  }
  const sentTo = [...toR, ...bccR].join(', ');
  const reply = replyTo || env.EMAIL_REPLY_TO || null;
  // Always send multipart: a caller-supplied text wins, else derive one from the HTML.
  // text/plain improves spam scoring and serves plain-text clients + screen readers.
  const bodyText = text || htmlToText(html) || null;
  const messageHeaders = Object.fromEntries(Object.entries(emailHeaders || {})
    .filter(([key, value]) => /^(?:In-Reply-To|References|X-[A-Za-z0-9_-]+)$/i.test(key)
      && typeof value === 'string' && value.length <= 2048 && !/[\r\n]/.test(value)));
  const stableKey = await emailIdempotencyKey(idempotencyKey || `ephemeral/${crypto.randomUUID()}`);
  try {
    const r = await serviceFetch('https://email.service/v1/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stream: 'transactional',
        idempotencyKey: stableKey,
        to: toR,
        bcc: bccR,
        subject,
        html,
        ...(bodyText ? { text: bodyText } : {}),
        ...(reply ? { replyTo: reply } : {}),
        ...(Object.keys(messageHeaders).length ? { headers: messageHeaders } : {}),
        ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
      }),
    });
    const response = await r.json().catch(() => null);
    const providerMessageId = String(response?.providerMessageId || '').trim() || null;
    const ok = r.ok && response?.ok === true && Boolean(providerMessageId);
    const status = Number.isInteger(response?.status) ? response.status : r.status;
    const error = ok ? null : String(response?.error || 'email_service_invalid_response').slice(0, 200);
    const retryable = ok ? false : response?.retryable === true || (!response && r.status >= 500);
    await logEmailEvent(env, {
      provider_message_id: providerMessageId,
      to_email: sentTo,
      category,
      subject,
      status: ok ? 'sent' : 'failed',
      error,
    });
    return {
      ok,
      providerMessageId,
      status,
      retryable,
      replayed: response?.replayed === true,
      error,
    };
  } catch (err) {
    const error = String(err).slice(0, 200);
    await logEmailEvent(env, { to_email: sentTo, category, subject, status: 'failed', error });
    return { ok: false, network: true, retryable: true, error };
  }
}

export async function sendEmail(env, options) {
  return (await sendEmailResult(env, options)).ok;
}

// Minimal HTML escape for interpolating user/staff text into email bodies.
export function htmlEscape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
