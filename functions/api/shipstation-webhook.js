// ShipStation API v2 track webhook. Custom token + provider RSA are verified before
// one sanitized event/effect transaction is committed to the generic inbox.
import { json } from '../_lib/supabase.js';
import { RequestBodyTooLargeError, readBoundedBytes } from '../_lib/request-body.js';
import { verifyShipStationSignature } from '../_lib/shipstation-webhook-auth.js';
import { normalizeShipStationTrackingUpdate } from '../_lib/shipstation-tracking.js';
import { ingestShipStationTrackingUpdate } from '../_lib/shipstation-tracking-ingest.js';

const BODY_MAX_BYTES = 64 * 1024;

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function sameToken(left, right) {
  const a = text(left, 500);
  const b = text(right, 500);
  if (!a || !b || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

export async function trackingUpdateFromPayload(payload) {
  if (payload?.resource_type !== 'API_TRACK') return null;
  return normalizeShipStationTrackingUpdate(payload);
}

async function defaultIngest(env, _rawBody, update, dependencies = {}) {
  return ingestShipStationTrackingUpdate(env, update, dependencies);
}

export function createShipStationWebhookHandler(dependencies = {}) {
  const readBody = dependencies.readBoundedBytes || readBoundedBytes;
  const verifySignature = dependencies.verifySignature || verifyShipStationSignature;
  const ingest = dependencies.ingest || ((env, rawBody, update) => (
    defaultIngest(env, rawBody, update, dependencies.trackingIngestDependencies)
  ));
  return async function shipStationWebhookHandler({ request, env }) {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const expected = text(env?.SHIPSTATION_WEBHOOK_TOKEN, 500);
    if (!expected) return json(503, { error: 'shipstation_webhook_not_configured' });
    if (!sameToken(request.headers.get('x-masest-webhook-token'), expected)) {
      return json(401, { error: 'unauthenticated' });
    }
    let rawBody;
    try {
      rawBody = new TextDecoder().decode(await readBody(request, BODY_MAX_BYTES));
    } catch (error) {
      return json(error instanceof RequestBodyTooLargeError ? 413 : 400, {
        error: error instanceof RequestBodyTooLargeError ? 'request_too_large' : 'bad_request',
      });
    }
    if (!await verifySignature(request.headers, rawBody)) {
      return json(401, { error: 'invalid_signature' });
    }
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json(400, { error: 'bad_request' });
    }
    const update = await trackingUpdateFromPayload(payload);
    if (!update) return json(400, { error: 'invalid_tracking_event' });
    try {
      const result = await ingest(env, rawBody, update);
      if (result?.error) throw result.error;
      return json(200, { received: true });
    } catch {
      return json(503, { error: 'tracking_ingest_failed' });
    }
  };
}

const defaultHandler = createShipStationWebhookHandler();

export async function onRequestPost(context) {
  return defaultHandler(context);
}
