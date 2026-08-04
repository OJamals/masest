#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';

const ROOT = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, ROOT), 'utf8');

function localEnv() {
  const values = { ...process.env };
  const path = new URL('.dev.vars', ROOT);
  if (!fs.existsSync(path)) return values;
  for (const raw of read('.dev.vars').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const split = line.indexOf('=');
    const key = line.slice(0, split);
    if (values[key]) continue;
    values[key] = line.slice(split + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

async function expectPgError(client, savepoint, fn, predicate) {
  await client.query(`savepoint ${savepoint}`);
  try {
    await fn();
  } catch (error) {
    assert.ok(predicate(error), `${savepoint}: unexpected ${error.code || ''} ${error.message}`);
    await client.query(`rollback to savepoint ${savepoint}`);
    return;
  }
  assert.fail(`${savepoint}: expected PostgreSQL error`);
}

const env = localEnv();
assert.ok(env.SUPABASE_DB_URL, 'SUPABASE_DB_URL is required');

const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL,
  connectionTimeoutMillis: 15_000,
  ssl: { rejectUnauthorized: false },
});
const tag = crypto.randomUUID();
const summary = {};

async function runInstalledConcurrency(admin, connectionString) {
  const schema = read('supabase/schema-integration-events.sql');
  const rollback = read('supabase/rollback-integration-events.sql');
  const before = (await admin.query(`select to_regclass('public.integration_events') is not null as installed`)).rows[0].installed;

  if (before) {
    const nonLegacy = (await admin.query(`
      select count(*)::integer as count
        from public.integration_events
       where provider is distinct from 'stripe'
          or environment_or_tenant is distinct from 'production'
          or metadata ->> 'migrated_from' is distinct from 'stripe_webhook_effects'
    `)).rows[0].count;
    assert.equal(nonLegacy, 0, 'refusing live cycle after generic non-legacy events exist');
  }

  await admin.query(schema);
  let claimedOnce = false;
  try {
    const liveTag = crypto.randomUUID();
    const eventId = (await admin.query(`
      select public.ingest_integration_event(
        'fixture',
        'concurrency',
        $1,
        'fixture.concurrent',
        null,
        '2026-08-04T12:00:00.000Z'::timestamptz,
        '2026-08-04T12:00:01.000Z'::timestamptz,
        $2,
        '{"fixture":true}'::jsonb,
        '[{"effect_key":"only","effect_type":"fixture_effect","payload":{}}]'::jsonb
      ) as id
    `, [`concurrent-${liveTag}`, '9'.repeat(64)])).rows[0].id;

    const workerConfig = {
      connectionString,
      connectionTimeoutMillis: 15_000,
      ssl: { rejectUnauthorized: false },
    };
    const workerA = new pg.Client(workerConfig);
    const workerB = new pg.Client(workerConfig);
    try {
      await Promise.all([workerA.connect(), workerB.connect()]);
      const [a, b] = await Promise.all([
        workerA.query(`select * from public.claim_integration_effects('concurrent-a', 1, 60)`),
        workerB.query(`select * from public.claim_integration_effects('concurrent-b', 1, 60)`),
      ]);
      const claimed = [...a.rows, ...b.rows].filter((row) => row.event_id === eventId);
      assert.equal(claimed.length, 1);
      assert.equal(new Set(claimed.map((row) => row.id)).size, 1);
      claimedOnce = true;
    } finally {
      await Promise.allSettled([workerA.end(), workerB.end()]);
    }
  } finally {
    // Always purge committed fixture/audit rows. Reapply canonical legacy migration
    // even when worker connection, query, or assertion fails.
    await admin.query(rollback);
    await admin.query(schema);
  }

  const finalState = (await admin.query(`
    select
      (select count(*)::integer from public.stripe_webhook_effects) as source,
      (select count(*)::integer from public.integration_effects) as target,
      (select count(*)::integer from public.integration_events where provider = 'fixture') as fixtures
  `)).rows[0];
  assert.equal(finalState.target, finalState.source);
  assert.equal(finalState.fixtures, 0);
  return { workers: 2, claimedOnce, finalState };
}

await client.connect();
try {
  await client.query('begin');
  await client.query(read('supabase/schema-integration-events.sql'));

  const migration = (await client.query(`
    select
      (select count(*)::integer from public.stripe_webhook_effects) as source,
      (select count(*)::integer from public.integration_effects) as target,
      (select count(*)::integer from public.integration_events) as events,
      (select count(*)::integer from public.integration_attempts) as attempts
  `)).rows[0];
  assert.equal(migration.target, migration.source);
  assert.equal(migration.attempts, migration.source);
  summary.migration = migration;

  const privileges = (await client.query(`
    select
      has_table_privilege('anon', 'public.integration_events', 'select') as anon_select,
      has_table_privilege('authenticated', 'public.integration_effects', 'select') as authenticated_select,
      has_table_privilege('service_role', 'public.integration_effects', 'select') as service_select,
      has_table_privilege('service_role', 'public.integration_events', 'insert') as service_insert,
      has_table_privilege('service_role', 'public.integration_effects', 'update') as service_update,
      has_table_privilege('service_role', 'public.integration_attempts', 'delete') as service_delete,
      has_table_privilege('service_role', 'public.integration_attempts', 'truncate') as service_truncate,
      has_function_privilege(
        'anon',
        'public.ingest_integration_event(text,text,text,text,text,timestamptz,timestamptz,text,jsonb,jsonb)',
        'execute'
      ) as anon_ingest,
      has_function_privilege(
        'service_role',
        'public.claim_integration_effects(text,integer,integer)',
        'execute'
      ) as service_claim
  `)).rows[0];
  assert.deepEqual(privileges, {
    anon_select: false,
    authenticated_select: false,
    service_select: true,
    service_insert: false,
    service_update: false,
    service_delete: false,
    service_truncate: false,
    anon_ingest: false,
    service_claim: true,
  });
  summary.leastPrivilege = true;

  const ingestSql = `
    select public.ingest_integration_event(
      $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb
    ) as id
  `;
  const occurredAt = new Date('2026-08-04T12:00:00.000Z');
  const verifiedAt = new Date('2026-08-04T12:00:01.000Z');
  const duplicateArgs = [
    'fixture',
    'test',
    `duplicate-${tag}`,
    'fixture.created',
    'fixture-object',
    occurredAt,
    verifiedAt,
    'a'.repeat(64),
    JSON.stringify({ fixture: true }),
    JSON.stringify([{ effect_key: 'only', effect_type: 'fixture_effect', payload: { order_id: 'fixture' } }]),
  ];
  const firstId = (await client.query(ingestSql, duplicateArgs)).rows[0].id;
  const duplicateId = (await client.query(ingestSql, duplicateArgs)).rows[0].id;
  assert.equal(duplicateId, firstId);
  const duplicateCount = (await client.query(`
    select count(*)::integer as count
      from public.integration_events
     where provider = 'fixture' and provider_event_id = $1
  `, [duplicateArgs[2]])).rows[0].count;
  assert.equal(duplicateCount, 1);
  summary.duplicate = true;

  const immutableCollisions = [
    [3, 'fixture.changed'],
    [4, 'changed-object'],
    [5, new Date('2026-08-04T12:01:00.000Z')],
    [7, 'b'.repeat(64)],
    [8, JSON.stringify({ fixture: false })],
  ];
  for (const [index, replacement] of immutableCollisions) {
    const changed = [...duplicateArgs];
    changed[index] = replacement;
    await expectPgError(
      client,
      `collision_${index}`,
      () => client.query(ingestSql, changed),
      (error) => error.message.includes('integration_event_identity_collision'),
    );
  }

  const redeliveryArgs = [...duplicateArgs];
  redeliveryArgs[6] = new Date('2026-08-04T12:01:01.000Z');
  assert.equal((await client.query(ingestSql, redeliveryArgs)).rows[0].id, firstId);

  const changedEffect = [...duplicateArgs];
  changedEffect[9] = JSON.stringify([{
    effect_key: 'only',
    effect_type: 'fixture_effect',
    aggregate_type: 'order',
    aggregate_id: 'changed',
    payload: { order_id: 'fixture' },
    max_attempts: 7,
  }]);
  await expectPgError(
    client,
    'effect_collision',
    () => client.query(ingestSql, changedEffect),
    (error) => error.message.includes('integration_effect_identity_collision'),
  );

  const secretArgs = [...duplicateArgs];
  secretArgs[2] = `secret-${tag}`;
  secretArgs[7] = 'c'.repeat(64);
  secretArgs[9] = JSON.stringify([{
    effect_key: 'secret',
    effect_type: 'fixture_effect',
    payload: { nested: { token: 'forbidden' } },
  }]);
  await expectPgError(
    client,
    'forbidden_secret',
    () => client.query(ingestSql, secretArgs),
    (error) => error.code === '23514',
  );
  summary.failClosedIdentity = true;

  const crossEventArgs = [...duplicateArgs];
  crossEventArgs[2] = `cross-event-${tag}`;
  crossEventArgs[7] = '7'.repeat(64);
  crossEventArgs[9] = JSON.stringify([{
    effect_key: 'child',
    effect_type: 'fixture_effect',
    payload: {},
    depends_on_effect_key: 'parent-from-another-event',
  }]);
  await expectPgError(
    client,
    'cross_event_dependency',
    async () => {
      await client.query(ingestSql, crossEventArgs);
      await client.query('set constraints integration_effects_dependency_fk immediate');
    },
    (error) => error.code === '23503',
  );
  summary.crossEventDependencyBlocked = true;

  const dependencyArgs = [...duplicateArgs];
  dependencyArgs[2] = `dependency-${tag}`;
  dependencyArgs[7] = 'd'.repeat(64);
  dependencyArgs[9] = JSON.stringify([
    { effect_key: 'parent', effect_type: 'fixture_effect', payload: {}, max_attempts: 1 },
    { effect_key: 'child', effect_type: 'fixture_effect', payload: {}, depends_on_effect_key: 'parent' },
    { effect_key: 'grandchild', effect_type: 'fixture_effect', payload: {}, depends_on_effect_key: 'child' },
  ]);
  const dependencyEvent = (await client.query(ingestSql, dependencyArgs)).rows[0].id;
  const dependencyClaims = (await client.query(`
    select * from public.claim_integration_effects('dependency-worker', 25, 60)
  `)).rows.filter((row) => row.event_id === dependencyEvent);
  assert.deepEqual(dependencyClaims.map((row) => row.effect_key), ['parent']);
  assert.equal((await client.query(`
    select public.fail_integration_effect($1, 'dependency-worker', 'permanent', 1, 30) as status
  `, [dependencyClaims[0].id])).rows[0].status, 'dead');
  const terminalized = await client.query(`
    select effect_key, status, last_error_code, dead_at
      from public.integration_effects
     where event_id = $1
     order by effect_key
  `, [dependencyEvent]);
  assert.ok(terminalized.rows.every((row) => row.status === 'dead'));
  assert.ok(terminalized.rows.filter((row) => row.effect_key !== 'parent')
    .every((row) => row.last_error_code === 'dependency_dead:parent'));
  assert.equal((await client.query('select status from public.integration_events where id = $1', [dependencyEvent])).rows[0].status, 'dead');
  const parentDeadAt = terminalized.rows.find((row) => row.effect_key === 'parent').dead_at;
  assert.equal((await client.query(`
    select public.replay_integration_effect($1, 'verification-admin', 'verified terminal replay') as ok
  `, [dependencyClaims[0].id])).rows[0].ok, true);
  const replayed = (await client.query(`
    select
      status,
      dead_at,
      (select count(*)::integer from public.integration_attempts where effect_id = $1 and action = 'replay') as replay_audit
    from public.integration_effects where id = $1
  `, [dependencyClaims[0].id])).rows[0];
  assert.equal(replayed.status, 'pending');
  assert.equal(String(replayed.dead_at), String(parentDeadAt));
  assert.equal(replayed.replay_audit, 1);
  summary.dependencyTerminalization = true;
  summary.terminalReplay = true;

  const responseArgs = [...duplicateArgs];
  responseArgs[2] = `response-${tag}`;
  responseArgs[7] = 'e'.repeat(64);
  responseArgs[9] = JSON.stringify([{ effect_key: 'send', effect_type: 'fixture_effect', payload: {} }]);
  const responseEvent = (await client.query(ingestSql, responseArgs)).rows[0].id;
  let responseEffect = (await client.query(`
    select * from public.claim_integration_effects('response-worker-1', 25, 15)
  `)).rows.find((row) => row.event_id === responseEvent);
  assert.ok(responseEffect);
  assert.equal((await client.query(`
    select public.record_integration_effect_success($1, 'response-worker-1', '{"sent":true}'::jsonb) as ok
  `, [responseEffect.id])).rows[0].ok, true);
  const firstSuccess = (await client.query(`
    select provider_succeeded_at from public.integration_effects where id = $1
  `, [responseEffect.id])).rows[0].provider_succeeded_at;
  await client.query(`
    update public.integration_effects
       set lease_expires_at = now() - interval '1 second'
     where id = $1
  `, [responseEffect.id]);
  responseEffect = (await client.query(`
    select * from public.claim_integration_effects('response-worker-2', 25, 15)
  `)).rows.find((row) => row.id === responseEffect.id);
  assert.ok(responseEffect.provider_succeeded_at);
  assert.equal((await client.query(`
    select public.complete_integration_effect($1, 'response-worker-2') as ok
  `, [responseEffect.id])).rows[0].ok, true);
  const responseState = (await client.query(`
    select status, attempt_count, provider_succeeded_at
      from public.integration_effects where id = $1
  `, [responseEffect.id])).rows[0];
  assert.equal(responseState.status, 'completed');
  assert.equal(responseState.attempt_count, 2);
  assert.equal(String(responseState.provider_succeeded_at), String(firstSuccess));
  summary.providerSuccessReplay = true;

  const retryArgs = [...duplicateArgs];
  retryArgs[2] = `retry-${tag}`;
  retryArgs[7] = 'f'.repeat(64);
  retryArgs[9] = JSON.stringify([{
    effect_key: 'retry', effect_type: 'fixture_effect', payload: {}, max_attempts: 3,
  }]);
  const retryEvent = (await client.query(ingestSql, retryArgs)).rows[0].id;
  const retryEffect = (await client.query(`
    select * from public.claim_integration_effects('retry-worker', 25, 60)
  `)).rows.find((row) => row.event_id === retryEvent);
  assert.equal((await client.query(`
    select public.fail_integration_effect($1, 'retry-worker', 'temporary', 3, 30) as status
  `, [retryEffect.id])).rows[0].status, 'pending');
  const retryState = (await client.query(`
    select status, extract(epoch from (available_at - updated_at))::double precision as delay
      from public.integration_effects where id = $1
  `, [retryEffect.id])).rows[0];
  assert.equal(retryState.status, 'pending');
  assert.ok(retryState.delay >= 0 && retryState.delay <= 30);
  summary.fullJitter = true;

  await expectPgError(
    client,
    'immutable_attempt',
    () => client.query(`update public.integration_attempts set action = 'retry' where effect_id = $1`, [responseEffect.id]),
    (error) => error.message.includes('immutable_audit_history'),
  );
  await expectPgError(
    client,
    'immutable_effect',
    () => client.query(`update public.integration_effects set effect_key = 'changed' where id = $1`, [responseEffect.id]),
    (error) => error.message.includes('integration_effect_identity_immutable'),
  );
  summary.immutableAudit = true;

  await client.query('set constraints all immediate');
  await client.query(read('supabase/rollback-integration-events.sql'));
  const rollback = (await client.query(`
    select
      to_regclass('public.integration_events') as events,
      to_regclass('public.integration_effects') as effects,
      to_regclass('public.integration_attempts') as attempts,
      to_regclass('public.stripe_webhook_effects') as legacy
  `)).rows[0];
  assert.deepEqual(rollback, {
    events: null,
    effects: null,
    attempts: null,
    legacy: 'stripe_webhook_effects',
  });
  summary.rollback = true;

  await client.query('rollback');
  if (process.argv.includes('--live-cycle')) {
    summary.liveConcurrency = await runInstalledConcurrency(client, env.SUPABASE_DB_URL);
  }
  process.stdout.write(`${JSON.stringify({ integrationEventsDb: 'PASS', ...summary })}\n`);
} catch (error) {
  try { await client.query('rollback'); } catch {}
  throw error;
} finally {
  await client.end();
}
