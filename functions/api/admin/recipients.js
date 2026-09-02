// /api/admin/recipients — staff management for canonical Klaviyo marketing list.
// Supabase retains import metadata only; Klaviyo owns subscription state and campaigns.
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';
import {
  klaviyoListProfiles,
  klaviyoSubscribe,
  klaviyoSubscribeMany,
  klaviyoUnsubscribe,
} from '../../_lib/klaviyo.js';
import { staffCanWrite } from '../../_lib/authz.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Extract unique valid emails from an array and/or a pasted CSV/newline blob.
export function parseImportEmails({ emails = [], csv = '' } = {}) {
  const raw = [];
  for (const e of Array.isArray(emails) ? emails : []) raw.push(e);
  for (const line of String(csv || '').split(/[\n,;]+/)) raw.push(line);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const email = String(item || '').trim().toLowerCase();
    if (EMAIL_RE.test(email) && !seen.has(email)) { seen.add(email); out.push(email); }
  }
  return out;
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);

  if (request.method === 'GET') {
    const { data: recipients } = await sb.from('newsletter_recipients')
      .select('email,name,source,tags,subscribed,created_at').order('created_at', { ascending: false }).limit(2000);
    let subscriberCount = 0;
    try { subscriberCount = (await klaviyoListProfiles(env, env.KLAVIYO_LIST_ID, { max: 100000 })).length; } catch { subscriberCount = 0; }
    const importedCount = (recipients || []).filter((r) => r.subscribed).length;
    return json(200, { recipients: recipients || [], counts: { subscribers: subscriberCount, imported: importedCount } });
  }

  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
  const body = await readBody(request);
  const action = body.action || 'add';

  if (action === 'import') {
    const emails = parseImportEmails(body);
    if (!emails.length) return json(400, { error: 'no_valid_emails' });
    const subscribed = await klaviyoSubscribeMany(env, emails, env.KLAVIYO_LIST_ID, { source: 'admin_import' });
    if (!subscribed.ok) return json(502, { error: 'klaviyo_subscribe_failed', retryable: true });
    const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).slice(0, 40)).slice(0, 10) : [];
    const rows = emails.map((email) => ({ email, source: 'import', tags, subscribed: true }));
    const { error } = await sb.from('newsletter_recipients').upsert(rows, { onConflict: 'email', ignoreDuplicates: true });
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, imported: emails.length });
  }

  if (action === 'add') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json(400, { error: 'invalid_email' });
    const row = {
      email, name: String(body.name || '').slice(0, 120) || null, source: 'manual',
      tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).slice(0, 40)).slice(0, 10) : [],
      subscribed: body.subscribed !== false,
    };
    if (row.subscribed) {
      const subscribed = await klaviyoSubscribe(env, email, env.KLAVIYO_LIST_ID, { source: 'admin_manual' });
      if (!subscribed.ok) return json(502, { error: 'klaviyo_subscribe_failed', retryable: true });
    }
    const { error } = await sb.from('newsletter_recipients').upsert(row, { onConflict: 'email' });
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  if (action === 'update') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json(400, { error: 'invalid_email' });
    const patch = {};
    if (typeof body.subscribed === 'boolean') patch.subscribed = body.subscribed;
    if (Array.isArray(body.tags)) patch.tags = body.tags.map((t) => String(t).slice(0, 40)).slice(0, 10);
    if (typeof body.name === 'string') patch.name = body.name.slice(0, 120);
    if (!Object.keys(patch).length) return json(400, { error: 'nothing_to_update' });
    if (typeof patch.subscribed === 'boolean') {
      const synced = patch.subscribed
        ? await klaviyoSubscribe(env, email, env.KLAVIYO_LIST_ID, { source: 'admin_manual' })
        : await klaviyoUnsubscribe(env, email, env.KLAVIYO_LIST_ID);
      if (!synced.ok) return json(502, { error: 'klaviyo_subscription_sync_failed', retryable: true });
    }
    const { error } = await sb.from('newsletter_recipients').update(patch).eq('email', email);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  if (action === 'remove') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json(400, { error: 'invalid_email' });
    const unsubscribed = await klaviyoUnsubscribe(env, email, env.KLAVIYO_LIST_ID);
    if (!unsubscribed.ok) return json(502, { error: 'klaviyo_unsubscribe_failed', retryable: true });
    const { error } = await sb.from('newsletter_recipients').delete().eq('email', email);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(400, { error: 'bad_action' });
}
