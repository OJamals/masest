// POST /api/crisp/webhook - Crisp chat webhook bridge into MASEST messages.
// Verifies signed plugin hooks when CRISP_WEBHOOK_SECRET is configured.
import { adminClient, json } from '../../_lib/supabase.js';

const MESSAGE_EVENTS = new Set(['message:send', 'message:received']);
const SESSION_EVENTS = new Set(['session:set_data', 'session:set_email', 'session:set_phone', 'session:set_nickname']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function asUuid(value) {
  const text = String(value || '').trim();
  return UUID_RE.test(text) ? text : null;
}

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function messageText(data) {
  if (typeof data.content === 'string') return clean(data.content, 4000);
  if (data.content?.text) return clean(data.content.text, 4000);
  if (data.content?.url) return clean(`[${data.type || 'file'}] ${data.content.name || data.content.type || 'Attachment'} ${data.content.url}`, 4000);
  return clean(`[${data.type || 'event'}]`, 4000);
}

export async function verifyCrispSignature(secret, { timestamp, signature, raw }) {
  if (!secret) return false;
  if (!timestamp || !signature || !raw) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`[${timestamp};${raw}]`));
  return safeEqual(signature, toHex(digest));
}

function verifyWebsiteHookKey(request, env) {
  const key = clean(env.CRISP_WEBHOOK_KEY, 200);
  if (!key) return false;
  const supplied = clean(new URL(request.url).searchParams.get('key'), 200);
  return safeEqual(supplied, key);
}

async function readCachedSession(sb, sessionId) {
  if (!sessionId) return null;
  try {
    const { data } = await sb.from('crisp_sessions').select('*').eq('session_id', sessionId).maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

async function upsertCrispSession(sb, event) {
  const data = event.data || {};
  const sessionId = clean(data.session_id, 120);
  if (!sessionId) return null;

  const current = await readCachedSession(sb, sessionId);
  const eventData = data.data && typeof data.data === 'object' ? data.data : {};
  const merged = { ...(current?.data || {}), ...eventData };
  const companyId = asUuid(eventData.account_company_id) || asUuid(current?.company_id);

  const row = {
    session_id: sessionId,
    website_id: clean(data.website_id || event.website_id, 120),
    email: clean(data.email || current?.email, 254).toLowerCase() || null,
    nickname: clean(data.nickname || current?.nickname, 160) || null,
    phone: clean(data.phone || current?.phone, 80) || null,
    company_id: companyId,
    company_name: clean(eventData.account_company || current?.company_name, 180) || null,
    data: merged,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data: saved, error } = await sb.from('crisp_sessions').upsert(row, { onConflict: 'session_id' }).select('*').maybeSingle();
    if (error) return { ...row, __error: clean(error.message || error, 240) || 'session_upsert_failed' };
    return saved || row;
  } catch (err) {
    return { ...row, __error: clean(err?.message || err, 240) || 'session_upsert_failed' };
  }
}

async function alreadySynced(sb, externalMessageId) {
  if (!externalMessageId) return false;
  try {
    const { data } = await sb.from('messages').select('id').eq('source', 'crisp').eq('external_message_id', externalMessageId).maybeSingle();
    return Boolean(data?.id);
  } catch {
    return false;
  }
}

async function insertMessage(sb, row) {
  try {
    const { data, error } = await sb.from('messages').insert(row).select('id,created_at').single();
    if (!error) return data;
  } catch {
    // Fall through to the older schema retry.
  }
  const { source, external_thread_id, external_message_id, ...fallbackRow } = row;
  const { data } = await sb.from('messages').insert(fallbackRow).select('id,created_at').single();
  return data;
}

async function routeCrispMessage(sb, env, event) {
  const data = event.data || {};
  const sessionId = clean(data.session_id, 120);
  const cached = await readCachedSession(sb, sessionId);
  const companyId = asUuid(data.data?.account_company_id) || asUuid(cached?.company_id) || asUuid(env.CRISP_FALLBACK_COMPANY_ID);
  if (!companyId) return { routed: false, reason: 'company_unresolved' };

  const text = messageText(data);
  if (!text) return { routed: false, reason: 'empty_message' };

  const externalMessageId = clean(data.fingerprint || `${sessionId}:${data.timestamp || event.timestamp || ''}`, 160);
  if (await alreadySynced(sb, externalMessageId)) return { routed: false, duplicate: true };

  const isOperator = data.from === 'operator' || event.event === 'message:received';
  const buyerMessageRole = { sender_role: 'buyer' };
  const staffMessageRole = { sender_role: 'staff' };
  const inserted = await insertMessage(sb, {
    company_id: companyId,
    user_id: null,
    ...(isOperator ? staffMessageRole : buyerMessageRole),
    body: text,
    order_id: null,
    read_by_user: !isOperator,
    read_by_staff: isOperator,
    source: 'crisp',
    external_thread_id: sessionId || null,
    external_message_id: externalMessageId || null,
  });

  if (isOperator) {
    await sb.from('notifications').insert({
      company_id: companyId,
      type: 'message',
      title: 'New Crisp chat response',
      body: text.slice(0, 160),
      link: '/dashboard.html#messages',
    });
  }

  return { routed: true, id: inserted?.id };
}

export async function handleCrispEvent(sb, env, event) {
  if (!event?.event || !event?.data) return { routed: false, reason: 'unsupported_payload' };
  if (SESSION_EVENTS.has(event.event)) {
    const session = await upsertCrispSession(sb, event);
    if (session?.__error) return { routed: false, error: 'crisp_session_upsert_failed', detail: session.__error };
    return { routed: true, session: true };
  }
  if (MESSAGE_EVENTS.has(event.event)) {
    const session = await upsertCrispSession(sb, event);
    if (session?.__error) return { routed: false, error: 'crisp_session_upsert_failed', detail: session.__error };
    return routeCrispMessage(sb, env, event);
  }
  return { routed: false, ignored: true };
}

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  const secret = env.CRISP_WEBHOOK_SECRET;
  const websiteKey = env.CRISP_WEBHOOK_KEY;
  if (websiteKey && verifyWebsiteHookKey(request, env)) {
    // Website Hooks are unsigned; the URL key is their shared-secret check.
  } else if (websiteKey && new URL(request.url).searchParams.has('key')) {
    return json(400, { error: 'invalid_key' });
  } else if (secret) {
    const verified = await verifyCrispSignature(secret, {
      timestamp: request.headers.get('X-Crisp-Request-Timestamp'),
      signature: request.headers.get('X-Crisp-Signature'),
      raw,
    });
    if (!verified) return json(400, { error: 'invalid_signature' });
  } else {
    return json(200, { ok: true, note: 'crisp_webhook_unconfigured' });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json(400, { error: 'bad_json' });
  }

  if (env.MASEST_CRISP_ID && event.website_id && event.website_id !== env.MASEST_CRISP_ID) {
    return json(200, { ok: true, ignored: 'website_mismatch' });
  }

  try {
    const result = await handleCrispEvent(adminClient(env), env, event);
    return json(200, { ok: true, ...result });
  } catch {
    return json(200, { ok: true, routed: false, error: 'crisp_processing_failed' });
  }
}
