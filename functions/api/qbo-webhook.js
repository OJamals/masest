// POST /api/qbo-webhook — Intuit-verified, sub-3-second durable inbox adapter.
import { adminClient, json } from '../_lib/supabase.js';
import { RequestBodyTooLargeError, readBoundedBytes } from '../_lib/request-body.js';
import { sha256Hex, toIntegrationEffectRows } from '../_lib/integration-effects.js';
import {
  canonicalQboChange,
  normalizeQboWebhookEvents,
  verifyQboWebhookSignature,
} from '../_lib/qbo-webhook.js';

const BODY_MAX_BYTES = 2 * 1024 * 1024;

async function defaultIngest(env, events, intuitTid) {
  const environment = String(env.QBO_ENVIRONMENT || 'production').trim().toLowerCase();
  const rows = await Promise.all(events.map(async (event) => {
    const canonical = canonicalQboChange(event);
    const aggregateId = `qbo:v2:${await sha256Hex(`${event.realm_id}:${event.entity_name}:${event.entity_id}`)}`;
    return {
      environment_or_tenant: `${environment}:${event.realm_id}`,
      provider_event_id: event.event_id,
      event_type: event.event_type,
      provider_object_id: event.entity_id,
      occurred_at: event.occurred_at,
      payload_sha256: await sha256Hex(canonical),
      metadata: { source: 'qbo_webhook', schema_version: 2, payload_hash_basis: 'canonical_child_v2' },
      effects: toIntegrationEffectRows([{
        effect_key: 'change-projection',
        effect_type: 'qbo_change_projection',
        aggregate_type: 'qbo_entity',
        aggregate_id: aggregateId,
        payload: {
          realm_id: event.realm_id,
          entity_name: event.entity_name,
          entity_id: event.entity_id,
          operation: event.operation,
          occurred_at: event.occurred_at,
        },
      }]),
    };
  }));
  try {
    const { data, error } = await adminClient(env).rpc('ingest_qbo_provider_events', {
      p_signature_verified_at: new Date().toISOString(),
      p_transport_id: intuitTid,
      p_events: rows,
    });
    return { data, error: error || null };
  } catch (error) {
    return { error };
  }
}

export function createQboWebhookHandler(dependencies = {}) {
  const verifySignature = dependencies.verifySignature || verifyQboWebhookSignature;
  const readBody = dependencies.readBoundedBytes || readBoundedBytes;
  const ingest = dependencies.ingest || defaultIngest;
  return async function qboWebhookHandler({ request, env }) {
    const verifierToken = env.QBO_WEBHOOK_VERIFIER_TOKEN;
    if (!verifierToken) return json(503, { error: 'qbo_webhook_not_configured' });
    let rawBody;
    try {
      rawBody = new TextDecoder().decode(await readBody(request, BODY_MAX_BYTES));
    } catch (error) {
      return json(error instanceof RequestBodyTooLargeError ? 413 : 400, {
        error: error instanceof RequestBodyTooLargeError ? 'request_too_large' : 'bad_request',
      });
    }
    const signature = request.headers.get('intuit-signature');
    if (!await verifySignature(verifierToken, signature, rawBody)) {
      return json(401, { error: 'invalid_signature' });
    }
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json(400, { error: 'bad_request' });
    }
    const events = await normalizeQboWebhookEvents(payload);
    if (!events.length) return json(400, { error: 'invalid_event' });
    const intuitTid = String(
      request.headers.get('intuit-t-id') || request.headers.get('intuit-tid') || '',
    ).slice(0, 255) || null;
    const result = await ingest(env, events, intuitTid);
    if (result?.error) return json(503, { error: 'qbo_ingest_failed' });
    return json(200, { ok: true, accepted: events.length });
  };
}

const defaultHandler = createQboWebhookHandler();

export async function onRequestPost(context) {
  return defaultHandler(context);
}
