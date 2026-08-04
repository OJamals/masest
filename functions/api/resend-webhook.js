// POST /api/resend-webhook — verified Resend/Svix inbox adapter.
// Raw bodies are verified then reduced to privacy-bounded effects before durable ACK.
import { adminClient, json } from '../_lib/supabase.js';
import { verifySvixSignature, mapResendEvent } from '../_lib/email.js';
import { RequestBodyTooLargeError, readBoundedBytes } from '../_lib/request-body.js';
import { ingestProviderEvent, sha256Hex } from '../_lib/integration-effects.js';

const BODY_MAX_BYTES = 128 * 1024;

function isoOrNull(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

async function recipientDigests(values) {
  const addresses = [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean))];
  return Promise.all(addresses.map((address) => sha256Hex(`resend-recipient:v1:${address}`)));
}

export async function deliveryEffect(event) {
  const eventType = String(event?.type || '').trim();
  const resendId = String(event?.data?.email_id || event?.data?.id || '').trim();
  if (!resendId) return [];
  if (eventType === 'email.received') {
    return [{
      effect_key: 'inbound-reply',
      effect_type: 'resend_inbound_reply',
      aggregate_type: 'email',
      aggregate_id: resendId,
      payload: { resend_id: resendId },
    }];
  }
  const status = mapResendEvent(eventType);
  if (!status) return [];
  return [{
    effect_key: 'delivery-projection',
    effect_type: 'resend_delivery_projection',
    aggregate_type: 'email',
    aggregate_id: resendId,
    payload: {
      resend_id: resendId,
      event_type: eventType,
      status,
      occurred_at: isoOrNull(event?.created_at),
      recipient_digests: await recipientDigests(event?.data?.to || []),
    },
  }];
}

async function defaultIngest(env, rawBody, event, svixId) {
  return ingestProviderEvent(adminClient(env), {
    provider: 'resend',
    environmentOrTenant: String(env.RESEND_WEBHOOK_ENDPOINT_ID || 'production').slice(0, 128),
    providerEventId: svixId,
    providerEventType: String(event?.type || 'unknown').slice(0, 160),
    providerObjectId: event?.data?.email_id || event?.data?.id || null,
    occurredAt: isoOrNull(event?.created_at),
    transportId: svixId,
    metadata: { source: 'resend_webhook', schema_version: 1 },
  }, rawBody, await deliveryEffect(event));
}

export function createResendWebhookHandler(dependencies = {}) {
  const verifySignature = dependencies.verifySignature || verifySvixSignature;
  const readBody = dependencies.readBoundedBytes || readBoundedBytes;
  const ingest = dependencies.ingest || defaultIngest;
  return async function resendWebhookHandler({ request, env }) {
    const secret = env.RESEND_WEBHOOK_SECRET;
    if (!secret) return json(503, { error: 'resend_webhook_not_configured' });

    let rawBody;
    try {
      rawBody = new TextDecoder().decode(await readBody(request, BODY_MAX_BYTES));
    } catch (error) {
      return json(error instanceof RequestBodyTooLargeError ? 413 : 400, {
        error: error instanceof RequestBodyTooLargeError ? 'request_too_large' : 'bad_request',
      });
    }
    const svixId = request.headers.get('svix-id');
    const ok = await verifySignature(secret, {
      id: svixId,
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    }, rawBody);
    if (!ok) return json(400, { error: 'invalid_signature' });

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return json(400, { error: 'bad_request' });
    }
    if (!event?.type || !svixId) return json(400, { error: 'invalid_event' });
    const result = await ingest(env, rawBody, event, svixId);
    if (result?.error) return json(503, { error: 'resend_ingest_failed' });
    return json(200, { ok: true });
  };
}

const defaultHandler = createResendWebhookHandler();

export async function onRequestPost(context) {
  return defaultHandler(context);
}
