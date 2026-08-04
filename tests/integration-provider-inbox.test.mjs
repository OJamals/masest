import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  deliverIntegrationEffect,
  ingestProviderEvent,
  toIntegrationEffectRows,
} from '../functions/_lib/integration-effects.js';
import { verifyShipStationSignature } from '../functions/_lib/shipstation-webhook-auth.js';

const schema = readFileSync(new URL('../supabase/schema-provider-inbox.sql', import.meta.url), 'utf8');

test('ShipEngine RSA verifier checks timestamp, kid, JWKS, and exact raw body', async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const kid = `kid-${crypto.randomUUID()}`;
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' };
  const timestamp = '2026-08-04T12:00:00.000Z';
  const raw = '{"resource_type":"API_TRACK"}';
  const signatureBytes = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${timestamp}.${raw}`),
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
  const headers = new Headers({
    'x-shipengine-rsa-sha256-key-id': kid,
    'x-shipengine-rsa-sha256-signature': signature,
    'x-shipengine-timestamp': timestamp,
  });
  const options = {
    nowMs: Date.parse(timestamp),
    fetch: async () => ({ ok: true, json: async () => ({ keys: [jwk] }) }),
  };
  assert.equal(await verifyShipStationSignature(headers, raw, options), true);
  assert.equal(await verifyShipStationSignature(headers, `${raw} `, options), false);
  assert.equal(await verifyShipStationSignature(headers, raw, { ...options, nowMs: Date.parse(timestamp) + 301_000 }), false);
});

test('provider inbox sends only typed sanitized fields to one atomic RPC', async () => {
  const calls = [];
  const sb = {
    async rpc(name, args) {
      calls.push([name, args]);
      return { data: 'event-id', error: null };
    },
  };
  const result = await ingestProviderEvent(sb, {
    provider: 'resend',
    environmentOrTenant: 'production',
    providerEventId: 'same-provider-id',
    providerEventType: 'email.delivered',
    providerObjectId: 'email-1',
    occurredAt: '2026-08-04T12:00:00Z',
    transportId: 'svix-1',
    metadata: { source: 'resend_webhook', schema_version: 1 },
  }, JSON.stringify({
    data: { to: 'private@example.com', subject: 'Private', address: '123 Private Street' },
    secret: 'never-store-this',
  }), [{
    effect_key: 'delivery-projection',
    effect_type: 'resend_delivery_projection',
    aggregate_type: 'email',
    aggregate_id: 'email-1',
    payload: {
      resend_id: 'email-1',
      event_type: 'email.delivered',
      status: 'delivered',
      occurred_at: '2026-08-04T12:00:00Z',
    },
  }]);
  assert.equal(result.error, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'ingest_provider_event');
  const persisted = JSON.stringify(calls[0][1]);
  assert.doesNotMatch(persisted, /private@example|Private Street|never-store-this|subject/);
  assert.match(calls[0][1].p_payload_sha256, /^[a-f0-9]{64}$/);
  assert.equal(calls[0][1].p_transport_id, 'svix-1');
});

test('effect payload allowlists reject PII and unknown provider fields', () => {
  assert.throws(() => toIntegrationEffectRows([{
    effect_key: 'tracking-projection',
    effect_type: 'shipstation_tracking_projection',
    payload: { tracking_number: 'TRACK', address: 'private' },
  }]), /unexpected payload key "address"/);
  assert.throws(() => toIntegrationEffectRows([{
    effect_key: 'delivery-projection',
    effect_type: 'resend_delivery_projection',
    payload: { resend_id: 'id', email: 'private@example.com' },
  }]), /unexpected payload key "email"/);
});

test('same external ID remains namespaced by provider and tenant', async () => {
  const identities = [];
  const sb = { async rpc(_name, args) { identities.push([args.p_provider, args.p_environment_or_tenant, args.p_provider_event_id]); return { data: 'id', error: null }; } };
  for (const provider of ['resend', 'quickbooks']) {
    await ingestProviderEvent(sb, {
      provider,
      environmentOrTenant: 'production',
      providerEventId: 'shared-id',
      providerEventType: 'test.event',
      metadata: { source: 'test' },
    }, '{}', []);
  }
  assert.deepEqual(identities, [
    ['resend', 'production', 'shared-id'],
    ['quickbooks', 'production', 'shared-id'],
  ]);
});

test('generic worker dispatches local projections through provider-specific atomic RPCs', async () => {
  for (const [provider, effectType, rpc] of [
    ['shipstation', 'shipstation_tracking_projection', 'apply_shipstation_tracking_integration_effect'],
    ['resend', 'resend_delivery_projection', 'apply_resend_delivery_integration_effect'],
    ['quickbooks', 'qbo_change_projection', 'apply_qbo_change_integration_effect'],
  ]) {
    const calls = [];
    const sb = { async rpc(name, args) { calls.push([name, args]); return { data: { applied: true }, error: null }; } };
    const result = await deliverIntegrationEffect({
      env: {}, sb, effect: {
        id: 'effect-id',
        provider,
        effect_type: effectType,
        lease_owner: 'worker-id',
        payload: {},
      },
    });
    assert.equal(result.providerRecorded, true);
    assert.equal(calls[0][0], rpc);
  }
});

test('schema makes receipts append-only and projections stale-safe', () => {
  assert.match(schema, /create table if not exists public\.integration_receipts/i);
  assert.match(schema, /integration_receipts_append_only[\s\S]*integration_attempts_append_only/i);
  assert.match(schema, /create or replace function public\.ingest_provider_event/i);
  assert.match(schema, /v_event_id := public\.ingest_integration_event/i);
  assert.match(schema, /insert into public\.integration_receipts/i);
  assert.match(schema, /tracking_provider_occurred_at[\s\S]*stale_event/i);
  assert.match(schema, /provider_occurred_at[\s\S]*v_next_rank < v_current_rank/i);
  assert.match(schema, /create table if not exists public\.qbo_change_events/i);
  assert.match(schema, /on conflict \(realm_id, entity_name, entity_id\) do update[\s\S]*excluded\.provider_occurred_at >=/i);
  assert.match(schema, /revoke execute on function public\.ingest_provider_event[\s\S]*from anon, authenticated/i);
});
