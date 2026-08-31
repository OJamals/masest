import { DurableObject } from 'cloudflare:workers';
import PostalMime from 'postal-mime';

import { signEmailBridgePayload } from '../../../shared/email-bridge.js';
import {
  classifyEmailSendError,
  emailSendErrorDetail,
  normalizeInboundEmail,
  normalizeSendRequest,
  readBoundedJsonRequest,
  shouldIgnoreInboundEmail,
} from './core.js';

const SEND_BODY_MAX_BYTES = 2 * 1024 * 1024;
const INBOUND_BODY_MAX_BYTES = 1024 * 1024;
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

function json(status, body) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function postSigned(url, secret, value) {
  if (!url || !secret) throw new Error('email_bridge_not_configured');
  const rawBody = JSON.stringify(value);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signEmailBridgePayload(secret, timestamp, rawBody);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-masest-email-timestamp': String(timestamp),
      'x-masest-email-signature': signature,
    },
    body: rawBody,
  });
  if (!response.ok) throw new Error(`email_bridge_http_${response.status}`);
}

function firstRow(cursor) {
  for (const row of cursor) return row;
  return null;
}

export class EmailDelivery extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS delivery (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        request_hash TEXT NOT NULL,
        state TEXT NOT NULL,
        provider_message_id TEXT,
        http_status INTEGER,
        retryable INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  readState() {
    return firstRow(this.ctx.storage.sql.exec(
      'SELECT request_hash, state, provider_message_id, http_status, retryable, error, updated_at FROM delivery WHERE singleton = 1',
    ));
  }

  writeState({ requestHash, state, providerMessageId = null, status = null, retryable = false, error = null }) {
    this.ctx.storage.sql.exec(
      `INSERT INTO delivery (
         singleton, request_hash, state, provider_message_id, http_status, retryable, error, updated_at
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET
         request_hash = excluded.request_hash,
         state = excluded.state,
         provider_message_id = excluded.provider_message_id,
         http_status = excluded.http_status,
         retryable = excluded.retryable,
         error = excluded.error,
         updated_at = excluded.updated_at`,
      requestHash,
      state,
      providerMessageId,
      status,
      retryable ? 1 : 0,
      error,
      Date.now(),
    );
  }

  async deliver(message, requestHash) {
    const current = this.readState();
    if (current && current.request_hash !== requestHash) {
      return { ok: false, status: 409, retryable: false, error: 'idempotency_key_reused' };
    }
    if (current?.state === 'sent') {
      return {
        ok: true,
        status: 200,
        retryable: false,
        providerMessageId: current.provider_message_id,
        replayed: true,
      };
    }
    if (current?.state === 'failed') {
      return {
        ok: false,
        status: Number(current.http_status) || 400,
        retryable: false,
        error: current.error || 'email_delivery_failed',
        replayed: true,
      };
    }
    if (current?.state === 'unknown'
      || (current?.state === 'pending' && Date.now() - Number(current.updated_at) > PENDING_MAX_AGE_MS)) {
      if (current?.state !== 'unknown') {
        this.writeState({
          requestHash,
          state: 'unknown',
          status: 502,
          error: 'email_delivery_state_unknown',
        });
      }
      return { ok: false, status: 502, retryable: false, error: 'email_delivery_state_unknown' };
    }
    if (current?.state === 'pending') {
      return { ok: false, status: 425, retryable: true, error: 'email_delivery_in_progress' };
    }

    this.writeState({ requestHash, state: 'pending', status: 425, retryable: true });
    try {
      const result = await this.env.EMAIL.send(message);
      const providerMessageId = String(result?.messageId || '').trim();
      if (!providerMessageId) {
        this.writeState({
          requestHash,
          state: 'unknown',
          status: 502,
          error: 'email_delivery_state_unknown',
        });
        return { ok: false, status: 502, retryable: false, error: 'email_delivery_state_unknown' };
      }
      this.writeState({ requestHash, state: 'sent', providerMessageId, status: 200 });
      return { ok: true, status: 200, retryable: false, providerMessageId, replayed: false };
    } catch (error) {
      const classified = classifyEmailSendError(error);
      this.writeState({
        requestHash,
        state: classified.retryable ? 'retryable' : (classified.status === 502 ? 'unknown' : 'failed'),
        status: classified.status,
        retryable: classified.retryable,
        error: classified.error,
      });
      console.error(JSON.stringify({
        event: 'email_send_failed',
        code: String(error?.code || 'unknown'),
        error: classified.error,
        detail: emailSendErrorDetail(error),
      }));
      return { ok: false, ...classified };
    }
  }
}

async function handleSend(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  let input;
  try {
    input = await readBoundedJsonRequest(request, SEND_BODY_MAX_BYTES);
  } catch (error) {
    return json(Number(error?.status) || 400, { error: String(error?.message || 'bad_request') });
  }
  let normalized;
  try {
    normalized = normalizeSendRequest(input, {
      fromAddress: env.EMAIL_FROM_ADDRESS,
      fromName: env.EMAIL_FROM_NAME,
    });
  } catch (error) {
    return json(422, { ok: false, retryable: false, error: String(error?.code || error?.message || 'invalid_email') });
  }
  const requestHash = await sha256Hex(JSON.stringify(normalized.message));
  const objectId = env.EMAIL_DELIVERIES.idFromName(await sha256Hex(normalized.idempotencyKey));
  const result = await env.EMAIL_DELIVERIES.get(objectId).deliver(normalized.message, requestHash);
  return json(Number(result.status) || (result.ok ? 200 : 502), result);
}

async function handleInbound(message, env) {
  if (message.rawSize > INBOUND_BODY_MAX_BYTES) {
    message.setReject('Message too large');
    return;
  }
  const inboundDomain = String(env.INBOUND_DOMAIN || '').toLowerCase();
  const recipient = String(message.to || '').toLowerCase();
  if (!inboundDomain || !recipient.endsWith(`@${inboundDomain}`) || !recipient.startsWith('reply+')) {
    message.setReject('Unknown recipient');
    return;
  }
  if (shouldIgnoreInboundEmail(message.headers, message.from)) return;
  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(raw);
  const payload = normalizeInboundEmail({
    envelopeFrom: message.from,
    envelopeTo: message.to,
    parsed,
    headers: message.headers,
    rawDigest: await sha256Hex(raw),
  });
  await postSigned(env.EMAIL_INGRESS_URL, env.EMAIL_INGRESS_SECRET, payload);
}

async function handleEventBatch(batch, env) {
  const events = batch.messages.map((message) => message.body).filter(Boolean);
  if (!events.length) return;
  await postSigned(env.EMAIL_EVENTS_URL, env.EMAIL_INGRESS_SECRET, { events });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/v1/send') return json(404, { error: 'not_found' });
    return handleSend(request, env);
  },

  async email(message, env) {
    await handleInbound(message, env);
  },

  async queue(batch, env) {
    await handleEventBatch(batch, env);
  },
};
