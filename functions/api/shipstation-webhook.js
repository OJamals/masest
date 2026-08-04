// ShipStation API Free track webhook. ShipStation sends a custom shared-secret header;
// provider event key + order update commit atomically through Supabase RPC.
import { adminClient, json } from '../_lib/supabase.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../_lib/request-body.js';

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

function trackingStatus(code) {
  const normalized = text(code, 20).toUpperCase();
  if (normalized === 'DE') return 'delivered';
  if (normalized === 'EX') return 'blocked';
  if (['AC', 'AT', 'NY'].includes(normalized)) return 'packing';
  return normalized ? 'shipped' : null;
}

function isoOrNull(value) {
  const raw = text(value, 80);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function trackingUpdateFromPayload(payload) {
  if (payload?.resource_type !== 'API_TRACK' || !payload?.data) return null;
  const data = payload.data;
  const trackingNumber = text(data.tracking_number, 160);
  const statusCode = text(data.status_code, 20).toUpperCase();
  const status = trackingStatus(statusCode);
  if (!trackingNumber || !status) return null;
  const events = Array.isArray(data.events) ? data.events : [];
  const latest = events.at(-1) || {};
  const occurredAt = isoOrNull(latest.occurred_at || latest.carrier_occurred_at);
  const actualDelivery = isoOrNull(data.actual_delivery_date);
  const estimatedDelivery = isoOrNull(data.estimated_delivery_date);
  const note = text(data.status_description || latest.description || statusCode, 500);
  const eventKey = await sha256([
    trackingNumber,
    statusCode,
    actualDelivery || '',
    occurredAt || '',
    text(latest.description, 500),
  ].join('|'));
  return {
    tracking_number: trackingNumber,
    tracking_status: status,
    event_key: eventKey,
    note,
    estimated_delivery_at: estimatedDelivery,
  };
}

async function defaultApplyTrackingUpdate(env, update) {
  const { data, error } = await adminClient(env).rpc('apply_shipstation_tracking_event', {
    p_tracking_number: update.tracking_number,
    p_tracking_status: update.tracking_status,
    p_event_key: update.event_key,
    p_note: update.note || null,
    p_estimated_delivery_at: update.estimated_delivery_at,
  });
  if (error) throw error;
  return data || { found: false, applied: false };
}

export function createShipStationWebhookHandler(dependencies = {}) {
  const parseBody = dependencies.readBoundedJson || readBoundedJson;
  const applyTrackingUpdate = dependencies.applyTrackingUpdate || defaultApplyTrackingUpdate;
  return async function shipStationWebhookHandler({ request, env }) {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const expected = text(env?.SHIPSTATION_WEBHOOK_TOKEN, 500);
    if (!expected) return json(503, { error: 'shipstation_webhook_not_configured' });
    if (!sameToken(request.headers.get('x-masest-webhook-token'), expected)) {
      return json(401, { error: 'unauthenticated' });
    }
    let payload;
    try {
      payload = await parseBody(request, BODY_MAX_BYTES);
    } catch (error) {
      return json(error instanceof RequestBodyTooLargeError ? 413 : 400, {
        error: error instanceof RequestBodyTooLargeError ? 'request_too_large' : 'bad_request',
      });
    }
    const update = await trackingUpdateFromPayload(payload);
    if (!update) return json(400, { error: 'invalid_tracking_event' });
    try {
      const result = await applyTrackingUpdate(env, update);
      return json(200, {
        received: true,
        matched: result?.found === true,
        duplicate: result?.found === true && result?.applied !== true,
      });
    } catch {
      return json(503, { error: 'tracking_update_failed' });
    }
  };
}

const defaultHandler = createShipStationWebhookHandler();

export async function onRequestPost(context) {
  return defaultHandler(context);
}
