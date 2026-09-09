import { createHash } from 'node:crypto';
import { readBoundedJson } from './request-body.js';

const API = 'https://api.emailoctopus.com';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const BLOCKED = new Set(['unsubscribed', 'bounced', 'complained']);
const STATUSES = new Set(['subscribed', 'pending', ...BLOCKED]);

export function emailOctopusConfigured(env) {
  return Boolean(env?.EMAILOCTOPUS_API_KEY && UUID.test(env?.EMAILOCTOPUS_LIST_ID || ''));
}

export async function checkEmailOctopusList(env, { fetchImpl = globalThis.fetch } = {}) {
  if (!emailOctopusConfigured(env)) return failure('emailoctopus_not_configured');
  try {
    const response = await fetchImpl(`${API}/lists/${env.EMAILOCTOPUS_LIST_ID}`, {
      headers: { authorization: `Bearer ${env.EMAILOCTOPUS_API_KEY}` },
      redirect: 'manual', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) { await response.body?.cancel(); return failure(`emailoctopus_http_${response.status}`); }
    const data = await readBoundedJson(response, 256 * 1024);
    return data?.id === env.EMAILOCTOPUS_LIST_ID ? { ok: true } : failure('emailoctopus_invalid_list');
  } catch { return failure('emailoctopus_list_check_failed'); }
}

function failure(error, retryable = false) {
  return { ok: false, error, retryable };
}

export async function syncEmailOctopusContact(env, contact, { fetchImpl = globalThis.fetch } = {}) {
  if (!emailOctopusConfigured(env)) return failure('emailoctopus_not_configured');
  const email = String(contact?.recipient || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320
      || typeof contact.enabled !== 'boolean') return failure('emailoctopus_invalid_contact');
  const collection = `/lists/${env.EMAILOCTOPUS_LIST_ID}/contacts`;
  // EmailOctopus accepts the MD5 of the lowercase email as the contact identifier.
  const path = `${collection}/${createHash('md5').update(email).digest('hex')}`;

  async function request(method, target, body) {
    try {
      const response = await fetchImpl(`${API}${target}`, {
        method,
        headers: { authorization: `Bearer ${env.EMAILOCTOPUS_API_KEY}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return { ...failure(`emailoctopus_http_${response.status}`, response.status === 429 || response.status >= 500), status: response.status };
      }
      if (response.status === 204) return method === 'DELETE'
        ? { ok: true, status: 204 } : failure('emailoctopus_invalid_response', true);
      const data = await readBoundedJson(response, 256 * 1024);
      if (!data?.id || typeof data.id !== 'string' || !STATUSES.has(data.status)
          || String(data.email_address || '').trim().toLowerCase() !== email) {
        return failure('emailoctopus_invalid_response', true);
      }
      return { ok: true, data };
    } catch {
      // No provider response body, URL with credentials, or email enters logs.
      return failure('emailoctopus_request_failed', true);
    }
  }

  let found = await request('GET', path);
  if (!found.ok && found.status !== 404) return found;
  if (contact.erase) {
    if (found.status === 404) return { ok: true };
    const deleted = await request('DELETE', path);
    return deleted.status === 404 ? { ok: true } : deleted;
  }
  if (found.status === 404) {
    if (!contact.enabled) return { ok: true };
    if (contact.remote_seen) return { ok: true, blockedReason: 'deleted' };
    // POST fails on an existing contact. An upsert could silently resubscribe one.
    const created = await request('POST', collection, { email_address: email, status: 'subscribed' });
    if (!created.ok && created.status !== 409) return created;
    found = created.status === 409 ? await request('GET', path) : created;
    if (!found.ok) return found;
  }
  if (BLOCKED.has(found.data.status)) {
    return { ok: true, blockedReason: found.data.status, contactId: found.data.id };
  }
  if (!contact.enabled) {
    const updated = await request('PUT', path, { status: 'unsubscribed' });
    if (updated.ok && !BLOCKED.has(updated.data?.status)) return failure('emailoctopus_unsubscribe_not_applied', true);
    return updated;
  }
  // Preserve existing subscriptions and pending double-opt-in confirmations.
  return { ok: true, remoteSeen: true };
}
