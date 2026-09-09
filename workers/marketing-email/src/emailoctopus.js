import { createHash } from 'node:crypto';
import { adminClient } from '../../../functions/_lib/supabase.js';
import { readBoundedBytes, RequestBodyTooLargeError } from '../../../functions/_lib/request-body.js';
import { checkEmailOctopusList, syncEmailOctopusContact } from '../../../functions/_lib/emailoctopus.js';

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const BLOCKED = new Set(['unsubscribed', 'bounced', 'complained', 'deleted']);

async function rpc(sb, name, args) {
  const result = await sb.rpc(name, args);
  if (result.error) throw new Error(`${name}_failed`);
  return result.data;
}

export async function runEmailOctopusSync(env, {
  createClient = adminClient, checkList = checkEmailOctopusList,
  syncContact = syncEmailOctopusContact, limit = 20,
} = {}) {
  if (env.EMAILOCTOPUS_ENABLED !== 'true') return { ok: true, disabled: true };
  if (!env.EMAILOCTOPUS_WEBHOOK_SECRET) throw new Error('emailoctopus_webhook_not_configured');
  const checked = await checkList(env);
  if (!checked.ok) throw new Error(checked.error);
  const sb = createClient(env);
  await rpc(sb, 'bind_emailoctopus_list', { p_list_id: env.EMAILOCTOPUS_LIST_ID });
  const result = { ok: true, synced: 0, failed: 0 };
  for (let index = 0; index < Math.min(20, Math.max(1, limit)); index += 1) {
    const workerId = crypto.randomUUID();
    const rows = await rpc(sb, 'claim_emailoctopus_contact', { p_worker_id: workerId });
    if (!rows?.length) break;
    const contact = rows[0];
    const synced = await syncContact(env, contact);
    if (synced.blockedReason) {
      const identity = createHash('sha256').update(`${env.EMAILOCTOPUS_LIST_ID}:${contact.recipient}:${synced.blockedReason}`).digest('hex');
      await rpc(sb, 'apply_emailoctopus_event', {
        p_event_id: `reconcile:${identity}`, p_recipient: contact.recipient, p_kind: synced.blockedReason,
      });
    }
    const finished = await rpc(sb, 'finish_emailoctopus_contact', {
      p_recipient: contact.recipient, p_worker_id: workerId, p_revision: contact.revision,
      p_success: synced.ok, p_retryable: Boolean(synced.retryable),
      p_remote_seen: Boolean(synced.remoteSeen || synced.data || synced.contactId),
      p_error: synced.ok ? null : synced.error,
    });
    if (!finished) throw new Error('emailoctopus_sync_lease_lost');
    if (synced.ok) result.synced += 1;
    else { result.failed += 1; result.ok = false; }
    // A provider-wide outage or quota failure must not consume every pending row.
    if (!synced.ok) break;
  }
  console.log(JSON.stringify({ event: 'emailoctopus_sync', ...result }));
  return result;
}

export function createEmailOctopusWebhook({ createClient = adminClient } = {}) {
  return async function handleEmailOctopusWebhook(request, env) {
    const json = (status, data) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (!env.EMAILOCTOPUS_WEBHOOK_SECRET || !UUID.test(env.EMAILOCTOPUS_LIST_ID || '')) {
      return json(503, { error: 'emailoctopus_webhook_not_configured' });
    }
    try {
      const signature = request.headers.get('EmailOctopus-Signature') || '';
      if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) return json(401, { error: 'invalid_emailoctopus_signature' });
      const bytes = await readBoundedBytes(request, 1024 * 1024);
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.EMAILOCTOPUS_WEBHOOK_SECRET),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
      const expected = Uint8Array.from(signature.slice(7).match(/../g), hex => Number.parseInt(hex, 16));
      if (!await crypto.subtle.verify('HMAC', key, expected, bytes)) return json(401, { error: 'invalid_emailoctopus_signature' });
      let events;
      try { events = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json(400, { error: 'invalid_emailoctopus_events' }); }
      if (!Array.isArray(events) || events.length > 1000) return json(400, { error: 'invalid_emailoctopus_events' });
      const changes = [];
      for (const event of events) {
        if (!event || !UUID.test(event.id || '') || !UUID.test(event.list_id || '')) return json(400, { error: 'invalid_emailoctopus_event' });
        if (event.list_id !== env.EMAILOCTOPUS_LIST_ID) continue;
        const type = String(event.type || '').replace(/^contact\./, '').toLowerCase();
        const status = String(event.contact_status || '').toLowerCase();
        const kind = BLOCKED.has(type) ? type : (['created', 'updated'].includes(type) && BLOCKED.has(status) ? status : null);
        if (!kind) continue;
        const recipient = String(event.contact_email_address || '').trim().toLowerCase();
        if (recipient.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) return json(400, { error: 'invalid_emailoctopus_recipient' });
        changes.push({ p_event_id: `emailoctopus:${event.list_id}:${event.id}`, p_recipient: recipient, p_kind: kind });
      }
      const sb = createClient(env);
      for (const change of changes) await rpc(sb, 'apply_emailoctopus_event', change);
      return json(200, { ok: true, processed: changes.length });
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) return json(413, { error: 'request_too_large' });
      return json(503, { error: 'emailoctopus_event_write_failed' });
    }
  };
}
