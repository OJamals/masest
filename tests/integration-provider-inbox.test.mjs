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
const unifiedSupportSchema = readFileSync(new URL('../supabase/schema-unified-support-messages.sql', import.meta.url), 'utf8');
const cloudflareEmailMigration = readFileSync(new URL('../supabase/migrate-cloudflare-email-service-2026-08-31.sql', import.meta.url), 'utf8');
const inboundReferenceRegexMigration = readFileSync(
  new URL('../supabase/migrate-email-inbound-reference-regex-2026-09-01.sql', import.meta.url),
  'utf8',
);
const verificationTool = readFileSync(new URL('../tools/verify-provider-inbox.mjs', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollback-provider-inbox.sql', import.meta.url), 'utf8');

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
    provider: 'shipstation',
    environmentOrTenant: 'production',
    providerEventId: 'same-provider-id',
    providerEventType: 'API_TRACK',
    providerObjectId: 'TRACK-1',
    occurredAt: '2026-08-04T12:00:00Z',
    transportId: 'webhook-1',
    metadata: { source: 'shipstation_webhook', schema_version: 1 },
  }, JSON.stringify({
    data: { to: 'private@example.com', subject: 'Private', address: '123 Private Street' },
    secret: 'never-store-this',
  }), [{
    effect_key: 'tracking-projection',
    effect_type: 'shipstation_tracking_projection',
    aggregate_type: 'shipment',
    aggregate_id: 'TRACK-1',
    payload: {
      tracking_number: 'TRACK-1',
      tracking_status: 'in_transit',
      occurred_at: '2026-08-04T12:00:00Z',
      event_key: 'event-1',
    },
  }]);
  assert.equal(result.error, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'ingest_provider_event');
  const persisted = JSON.stringify(calls[0][1]);
  assert.doesNotMatch(persisted, /private@example|Private Street|never-store-this|subject/);
  assert.match(calls[0][1].p_payload_sha256, /^[a-f0-9]{64}$/);
  assert.equal(calls[0][1].p_transport_id, 'webhook-1');
});

test('effect payload allowlists reject PII and unknown provider fields', () => {
  assert.throws(() => toIntegrationEffectRows([{
    effect_key: 'tracking-projection',
    effect_type: 'shipstation_tracking_projection',
    payload: { tracking_number: 'TRACK', address: 'private' },
  }]), /unexpected payload key "address"/);
  assert.throws(() => toIntegrationEffectRows([{
    effect_key: 'qbo-projection',
    effect_type: 'qbo_change_projection',
    payload: { realm_id: 'realm', entity_name: 'Invoice', entity_id: '1', operation: 'Update', email: 'private@example.com' },
  }]), /unexpected payload key "email"/);
});

test('same external ID remains namespaced by provider and tenant', async () => {
  const identities = [];
  const sb = { async rpc(_name, args) { identities.push([args.p_provider, args.p_environment_or_tenant, args.p_provider_event_id]); return { data: 'id', error: null }; } };
  for (const provider of ['shipstation', 'quickbooks']) {
    await ingestProviderEvent(sb, {
      provider,
      environmentOrTenant: 'production',
      providerEventId: 'shared-id',
      providerEventType: 'test.event',
      metadata: { source: 'test' },
    }, '{}', []);
  }
  assert.deepEqual(identities, [
    ['shipstation', 'production', 'shared-id'],
    ['quickbooks', 'production', 'shared-id'],
  ]);
});

test('generic worker dispatches local projections through provider-specific atomic RPCs', async () => {
  for (const [provider, effectType, rpc] of [
    ['shipstation', 'shipstation_tracking_projection', 'apply_shipstation_tracking_integration_effect'],
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
  const inboundUpsert = unifiedSupportSchema.match(/create or replace function public\.upsert_email_inbound_message[\s\S]*?grant execute on function public\.upsert_email_inbound_message/i)?.[0] || '';
  assert.match(inboundUpsert, /if v_inserted then[\s\S]*update public\.companies[\s\S]*end if/i);
  assert.match(inboundUpsert, /p_email_references/);
  assert.doesNotMatch(schema, /upsert_email_inbound_message/i);
  assert.match(schema, /create table if not exists public\.qbo_change_events/i);
  assert.match(schema, /on conflict \(realm_id, entity_name, entity_id\) do update[\s\S]*excluded\.provider_occurred_at >=/i);
  assert.doesNotMatch(schema, /create or replace function public\.apply_resend_delivery_integration_effect/i);
  const healthFn = schema.match(/create or replace function public\.provider_integration_health\(\)[\s\S]*?order by providers\.provider;/i)?.[0] || '';
  assert.match(healthFn, /values \('stripe'::text\), \('shipstation'\), \('quickbooks'\)/i);
  assert.doesNotMatch(healthFn, /'resend'/i);
  assert.match(cloudflareEmailMigration, /create or replace function public\.provider_integration_health\(\)[\s\S]*values \('stripe'::text\), \('shipstation'\), \('quickbooks'\)/i);
  assert.match(schema, /revoke execute on function public\.ingest_provider_event[\s\S]*from anon, authenticated/i);
});

test('inbound email reference regex stays within PostgreSQL repetition limits', () => {
  for (const [name, sql] of [
    ['canonical support schema', unifiedSupportSchema],
    ['Cloudflare email migration', cloudflareEmailMigration],
  ]) {
    const inboundUpsert = sql.match(
      /create or replace function public\.upsert_email_inbound_message[\s\S]*?grant execute on function public\.upsert_email_inbound_message/i,
    )?.[0] || '';
    const repetitionCounts = [...inboundUpsert.matchAll(/\{(\d+)(?:,(\d+))?\}/g)]
      .flatMap((match) => match.slice(1))
      .filter(Boolean)
      .map(Number);

    assert.ok(inboundUpsert, `${name} must define inbound email upsert`);
    assert.ok(
      repetitionCounts.every((count) => count <= 255),
      `${name} uses a PostgreSQL-incompatible repetition count`,
    );
  }
  assert.match(inboundReferenceRegexMigration, /pg_get_functiondef/i);
  assert.match(inboundReferenceRegexMigration, /unexpected_email_inbound_reference_regex/i);
  assert.match(
    inboundReferenceRegexMigration,
    /v_new_pattern constant text := '[^']*\{1,255\}[^']*\{0,255\}[^']*'/i,
  );
  assert.match(inboundReferenceRegexMigration, /execute replace\(v_definition, v_old_pattern, v_new_pattern\)/i);
});

test('provider inbox operations no longer restore or verify retired Resend paths', () => {
  for (const source of [verificationTool, rollback]) {
    assert.doesNotMatch(source, /provider\s*[:=]\s*['"]resend['"]/i);
    assert.doesNotMatch(source, /upsert_resend_inbound_message/i);
    assert.doesNotMatch(source, /apply_resend_delivery_integration_effect/i);
  }
  assert.doesNotMatch(rollback, /drop function if exists public\.upsert_email_inbound_message/i);
  assert.match(verificationTool, /apply_email_delivery_event/);
  assert.match(verificationTool, /upsert_email_inbound_message/);
  assert.match(verificationTool, /withoutTransactionBoundary/);
});
