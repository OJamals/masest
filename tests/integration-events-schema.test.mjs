import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('generic integration ledger defines provider inbox, dependent effects, and append-only attempts', () => {
  const sql = read('supabase/schema-integration-events.sql');

  assert.match(sql, /create table if not exists public\.integration_events/i);
  assert.match(sql, /unique\s*\(\s*provider\s*,\s*environment_or_tenant\s*,\s*provider_event_id\s*\)/i);
  assert.match(sql, /payload_sha256[\s\S]*\^\[a-f0-9\]\{64\}\$/i);
  assert.match(sql, /create table if not exists public\.integration_effects/i);
  assert.match(sql, /unique\s*\(\s*event_id\s*,\s*effect_key\s*\)/i);
  assert.match(sql, /foreign key\s*\(\s*event_id\s*,\s*depends_on_effect_key\s*\)/i);
  assert.match(sql, /deferrable initially deferred/i);
  assert.match(sql, /create table if not exists public\.integration_attempts/i);
  assert.match(sql, /integration_attempts_append_only/i);
  assert.match(sql, /immutable_audit_history/i);
});

test('generic payloads are bounded and recursively reject credential-bearing keys', () => {
  const sql = read('supabase/schema-integration-events.sql');

  assert.match(sql, /integration_json_has_forbidden_key/i);
  for (const key of [
    'raw', 'payload', 'secret', 'token', 'api_key', 'signature',
    'authorization', 'card', 'bank', 'routing_number', 'account_number',
  ]) {
    assert.match(sql, new RegExp(`'${key}'`, 'i'));
  }
  assert.match(sql, /octet_length\(metadata::text\)\s*<=\s*2048/i);
  assert.match(sql, /octet_length\(payload::text\)\s*<=\s*8192/i);
  assert.match(sql, /not public\.integration_json_has_forbidden_key\(metadata\)/i);
  assert.match(sql, /not public\.integration_json_has_forbidden_key\(payload\)/i);
});

test('service-only RPCs cover ingest, claim, provider acknowledgement, completion, full-jitter retry, and replay', () => {
  const sql = read('supabase/schema-integration-events.sql');
  const signatures = [
    'ingest_integration_event\\(text, text, text, text, text, timestamptz, timestamptz, text, jsonb, jsonb\\)',
    'claim_integration_effects\\(text, integer, integer\\)',
    'record_integration_effect_success\\(uuid, text, jsonb\\)',
    'complete_integration_effect\\(uuid, text\\)',
    'fail_integration_effect\\(uuid, text, text, integer, integer\\)',
    'replay_integration_effect\\(uuid, text, text\\)',
  ];

  assert.match(sql, /for\s+update\s+skip\s+locked/i);
  assert.match(sql, /status\s*=\s*'processing'[\s\S]*lease_expires_at\s*<=\s*now\(\)/i);
  assert.match(sql, /attempt_count\s*=\s*effect\.attempt_count\s*\+\s*1/i);
  assert.match(sql, /power\s*\(\s*2/i);
  assert.match(sql, /random\s*\(\s*\)\s*\*/i);
  assert.match(sql, /least\s*\(\s*21600/i);
  assert.match(sql, /status\s*=\s*'dead'/i);
  assert.match(sql, /provider_succeeded_at/i);
  assert.match(sql, /effect_lease_not_owned/i);
  assert.match(sql, /replay_reason_required/i);
  assert.match(sql, /with recursive blocked/i);
  assert.match(sql, /dependency_dead:/i);

  for (const signature of signatures) {
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${signature}\\s+from\\s+public`, 'i'));
    assert.match(sql, new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${signature}\\s+from\\s+anon,\\s*authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${signature}\\s+to\\s+service_role`, 'i'));
  }
});

test('identity and terminal audit fields are immutable while attempt history cannot update or delete', () => {
  const sql = read('supabase/schema-integration-events.sql');

  assert.match(sql, /create trigger integration_events_identity_immutable/i);
  assert.match(sql, /create trigger integration_effects_identity_immutable/i);
  assert.match(sql, /old\.provider_succeeded_at is not null[\s\S]*new\.provider_succeeded_at is distinct from old\.provider_succeeded_at/i);
  assert.match(sql, /old\.completed_at is not null[\s\S]*new\.completed_at is distinct from old\.completed_at/i);
  assert.match(sql, /old\.dead_at is not null[\s\S]*new\.dead_at is distinct from old\.dead_at/i);
  assert.match(sql, /raise exception 'immutable_audit_history'/i);
});

test('migration preserves every Stripe effect field and proves count plus canonical checksum parity', () => {
  const sql = read('supabase/schema-integration-events.sql');

  assert.match(sql, /from public\.stripe_webhook_effects/i);
  assert.match(sql, /'stripe'[\s\S]*'production'/i);
  for (const column of [
    'id', 'effect_key', 'effect_type', 'payload', 'depends_on_effect_key',
    'status', 'attempt_count', 'available_at', 'lease_owner',
    'lease_expires_at', 'provider_succeeded_at', 'provider_result',
    'last_error_code', 'completed_at', 'dead_at', 'created_at', 'updated_at',
  ]) {
    assert.match(sql, new RegExp(`stripe_effect\\.${column}`, 'i'), `${column} must migrate explicitly`);
  }
  assert.match(sql, /integration_effect_migration_count_mismatch/i);
  assert.match(sql, /integration_effect_migration_checksum_mismatch/i);
  assert.match(sql, /extensions\.digest/i);
  assert.match(sql, /integration_migration_verification/i);
});

test('duplicate effect identity compares immutable routing and retry fields fail closed', () => {
  const sql = read('supabase/schema-integration-events.sql');
  const collision = sql.slice(
    sql.indexOf("if v_effect_row.effect_type is distinct"),
    sql.indexOf("raise exception 'integration_effect_identity_collision'"),
  );
  for (const field of [
    'effect_type', 'aggregate_type', 'aggregate_id', 'payload',
    'payload_sha256', 'depends_on_effect_key', 'max_attempts',
  ]) {
    assert.match(collision, new RegExp(`v_effect_row\\.${field}`, 'i'));
  }
});

test('zero-effect provider receipts terminalize as ignored instead of remaining unclaimable', () => {
  const sql = read('supabase/schema-integration-events.sql');
  assert.match(sql, /jsonb_array_length[\s\S]*=\s*0[\s\S]*status\s*=\s*'ignored'/i);
  assert.match(sql, /jsonb_array_length[\s\S]*not exists[\s\S]*integration_effects[\s\S]*event_id\s*=\s*v_event\.id/i);
  assert.match(sql, /status\s*=\s*'ignored'[\s\S]*processed_at\s*=\s*coalesce\(processed_at,\s*now\(\)\)/i);
});

test('RLS and grants deny public roles and rollback removes only generic objects', () => {
  const sql = read('supabase/schema-integration-events.sql');
  const rollback = read('supabase/rollback-integration-events.sql');

  for (const table of ['integration_events', 'integration_effects', 'integration_attempts']) {
    assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+public`, 'i'));
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+anon,\\s*authenticated`, 'i'));
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+service_role`, 'i'));
    assert.match(sql, new RegExp(`grant\\s+select\\s+on\\s+table\\s+public\\.${table}\\s+to\\s+service_role`, 'i'));
    assert.doesNotMatch(sql, new RegExp(`grant\\s+all\\s+on\\s+table\\s+public\\.${table}`, 'i'));
    assert.match(rollback, new RegExp(`drop\\s+table\\s+if\\s+exists\\s+public\\.${table}`, 'i'));
  }
  assert.doesNotMatch(rollback, /drop\s+table\s+if\s+exists\s+public\.stripe_webhook_effects/i);
  assert.doesNotMatch(rollback, /drop\s+function\s+if\s+exists\s+public\.(claim|complete|retry)_stripe_webhook_effect/i);
});

test('duplicate event collision compares deterministic provider identity but permits redelivery verification time', () => {
  const sql = read('supabase/schema-integration-events.sql');
  const collision = sql.slice(
    sql.indexOf('-- Redelivery verification time is receipt-specific'),
    sql.indexOf("raise exception 'integration_event_identity_collision'"),
  );
  for (const field of [
    'payload_sha256', 'provider_event_type', 'provider_object_id',
    'occurred_at', 'metadata',
  ]) {
    assert.match(collision, new RegExp(`v_event\\.${field}`, 'i'));
  }
  assert.doesNotMatch(collision, /v_event\.signature_verified_at\s+is distinct/i);
  assert.match(collision, /migrated_from[\s\S]*stripe_webhook_effects/i);
});
