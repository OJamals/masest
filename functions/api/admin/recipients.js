// /api/admin/recipients — staff management for canonical Supabase marketing consent.
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';
import {
  setMarketingPreference,
  setMarketingPreferences,
} from '../../_lib/marketing-subscribers.js';
import { staffCanWrite } from '../../_lib/authz.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseImportEmails({ emails = [], csv = '' } = {}) {
  const raw = [];
  for (const email of Array.isArray(emails) ? emails : []) raw.push(email);
  for (const line of String(csv || '').split(/[\n,;]+/)) raw.push(line);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const email = String(item || '').trim().toLowerCase();
    if (EMAIL_RE.test(email) && !seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

function tags(value) {
  return (Array.isArray(value) ? value : []).map((tag) => String(tag).slice(0, 40)).slice(0, 10);
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);

  if (request.method === 'GET') {
    const [rowsResult, countResult] = await Promise.all([
      sb.from('newsletter_recipients')
        .select('email,name,source,tags,subscribed,created_at')
        .order('created_at', { ascending: false })
        .limit(2000),
      sb.from('newsletter_recipients').select('email', { count: 'exact', head: true }).eq('subscribed', true),
    ]);
    if (rowsResult.error || countResult.error) return json(503, { error: 'marketing_audience_unavailable', retryable: true });
    const recipients = rowsResult.data || [];
    return json(200, {
      recipients,
      counts: {
        subscribers: Number(countResult.count) || 0,
        imported: recipients.length,
      },
    });
  }

  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
  const body = await readBody(request);
  const action = body.action || 'add';

  if (action === 'import') {
    const emails = parseImportEmails(body);
    if (!emails.length) return json(400, { error: 'no_valid_emails' });
    const result = await setMarketingPreferences(env, {
      emails,
      enabled: true,
      source: 'admin_import',
      tags: tags(body.tags),
    }, { sb });
    if (!result.ok) return json(503, { error: result.error, retryable: result.retryable });
    return json(200, { ok: true, imported: result.count });
  }

  if (action === 'add') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json(400, { error: 'invalid_email' });
    const result = await setMarketingPreference(env, {
      email,
      enabled: body.subscribed !== false,
      source: 'admin_manual',
      name: String(body.name || '').slice(0, 120) || null,
      tags: tags(body.tags),
    }, { sb });
    if (!result.ok) return json(503, { error: result.error, retryable: result.retryable });
    return json(200, { ok: true });
  }

  if (action === 'update') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json(400, { error: 'invalid_email' });
    const patch = {};
    if (Array.isArray(body.tags)) patch.tags = tags(body.tags);
    if (typeof body.name === 'string') patch.name = body.name.slice(0, 120);
    if (typeof body.subscribed === 'boolean') {
      const result = await setMarketingPreference(env, {
        email,
        enabled: body.subscribed,
        source: 'admin_manual',
        name: patch.name,
        tags: patch.tags,
      }, { sb });
      if (!result.ok) return json(503, { error: result.error, retryable: result.retryable });
      return json(200, { ok: true });
    }
    if (!Object.keys(patch).length) return json(400, { error: 'nothing_to_update' });
    const { error } = await sb.from('newsletter_recipients').update(patch).eq('email', email);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  if (action === 'remove') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json(400, { error: 'invalid_email' });
    const result = await setMarketingPreference(env, {
      email, enabled: false, source: 'admin_remove',
    }, { sb });
    if (!result.ok) return json(503, { error: result.error, retryable: result.retryable });
    const { error } = await sb.from('newsletter_recipients').delete().eq('email', email);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(400, { error: 'bad_action' });
}
