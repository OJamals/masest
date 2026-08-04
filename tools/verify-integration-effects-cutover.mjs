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
    if (!values[key]) values[key] = line.slice(split + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

async function state(client) {
  const base = (await client.query(`
    select
      to_regclass('public.stripe_webhook_effects') is not null as legacy_table,
      to_regclass('public.integration_events') is not null as events_table,
      to_regclass('public.integration_effects') is not null as effects_table,
      to_regprocedure('public.claim_stripe_webhook_effects(text,integer,integer)') is not null as legacy_claim,
      to_regprocedure('public.claim_integration_effects(text,integer,integer)') is not null as generic_claim,
      to_regprocedure('public.apply_integration_stock_effect(uuid,text)') is not null as stock_handler,
      to_regprocedure('public.deliver_integration_notification_effect(uuid,text,jsonb)') is not null as notification_handler
  `)).rows[0];
  const legacyCount = base.legacy_table
    ? (await client.query('select count(*)::integer as count from public.stripe_webhook_effects')).rows[0].count
    : null;
  const genericCount = base.effects_table
    ? (await client.query('select count(*)::integer as count from public.integration_effects')).rows[0].count
    : null;
  return { ...base, legacy_count: legacyCount, generic_count: genericCount };
}

async function cronState(client) {
  const rows = (await client.query(`
    select
      jobname,
      position('/api/admin/integration-effects' in command) > 0 as generic_route,
      position('x-integration-effects-secret' in command) > 0 as generic_header,
      position('/api/admin/stripe-effects' in command) > 0 as legacy_route,
      position('x-stripe-effects-secret' in command) > 0 as legacy_header
      from cron.job
     where jobname in ('stripe-effects', 'integration-effects')
     order by jobname
  `)).rows;
  return rows;
}

async function verifyTransaction(client) {
  const tag = crypto.randomUUID();
  await client.query('begin');
  try {
    await client.query(read('supabase/schema-integration-events.sql'));
    await client.query(read('supabase/schema-integration-effect-handlers.sql'));
    const installed = await state(client);
    assert.equal(installed.legacy_table, true);
    assert.equal(installed.events_table, true);
    assert.equal(installed.effects_table, true);
    assert.equal(installed.stock_handler, true);
    assert.equal(installed.notification_handler, true);
    assert.equal(installed.legacy_count, installed.generic_count);

    const args = [
      'stripe',
      'production',
      `evt_cutover_${tag}`,
      'verification.cutover',
      `obj_${tag}`,
      new Date('2026-08-04T12:00:00.000Z'),
      new Date('2026-08-04T12:00:01.000Z'),
      'a'.repeat(64),
      JSON.stringify({ source: 'cutover_verifier' }),
      JSON.stringify([{ effect_key: 'verify', effect_type: 'dispute_alert', payload: {} }]),
    ];
    const ingest = `select public.ingest_integration_event(
      $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb
    ) as id`;
    const eventId = (await client.query(ingest, args)).rows[0].id;
    const redelivery = [...args];
    redelivery[6] = new Date('2026-08-04T12:05:00.000Z');
    assert.equal((await client.query(ingest, redelivery)).rows[0].id, eventId);
    const emptyDuplicate = [...redelivery];
    emptyDuplicate[9] = '[]';
    assert.equal((await client.query(ingest, emptyDuplicate)).rows[0].id, eventId);
    assert.deepEqual((await client.query(`
      select
        status,
        (select count(*)::integer from public.integration_effects where event_id = $1) as effects
        from public.integration_events
       where id = $1
    `, [eventId])).rows[0], { status: 'received', effects: 1 });

    const emptyArgs = [...args];
    emptyArgs[2] = `evt_empty_${tag}`;
    emptyArgs[4] = `obj_empty_${tag}`;
    emptyArgs[7] = 'b'.repeat(64);
    emptyArgs[9] = '[]';
    const emptyEventId = (await client.query(ingest, emptyArgs)).rows[0].id;
    assert.equal((await client.query(
      'select status from public.integration_events where id = $1',
      [emptyEventId],
    )).rows[0].status, 'ignored');

    const claimed = (await client.query(
      `select * from public.claim_integration_effects($1, 25, 60)`,
      [`cutover-verifier-${tag}`],
    )).rows.find((row) => row.event_id === eventId);
    assert.ok(claimed);
    assert.equal((await client.query(
      `select public.record_integration_effect_success($1,$2,'{"verified":true}'::jsonb) as ok`,
      [claimed.id, `cutover-verifier-${tag}`],
    )).rows[0].ok, true);
    assert.equal((await client.query(
      'select public.complete_integration_effect($1,$2) as ok',
      [claimed.id, `cutover-verifier-${tag}`],
    )).rows[0].ok, true);

    await client.query(read('supabase/cutover-integration-effects.sql'));
    const cutover = await state(client);
    assert.equal(cutover.legacy_table, false);
    assert.equal(cutover.legacy_claim, false);
    assert.equal(cutover.generic_claim, true);
    assert.equal(cutover.stock_handler, true);
    assert.equal(cutover.notification_handler, true);

    await client.query(read('supabase/rollback-integration-effects-cutover.sql'));
    const restored = await state(client);
    assert.equal(restored.legacy_table, true);
    assert.equal(restored.legacy_claim, true);
    // Generic-only production receipt landed between runtime deployment and legacy drop.
    // Cutover accepts it; rollback reconstructs it into the legacy ledger.
    assert.equal(restored.legacy_count, restored.generic_count);
    await client.query(read('supabase/cutover-integration-effects-cron.sql'));
    const cutoverCron = await cronState(client);
    assert.ok(cutoverCron.some((job) => job.jobname === 'integration-effects'
      && job.generic_route && job.generic_header));
    await client.query(read('supabase/rollback-integration-effects-cron.sql'));
    const restoredCron = await cronState(client);
    assert.ok(restoredCron.some((job) => job.jobname === 'stripe-effects'
      && job.legacy_route && job.legacy_header));
    return {
      installed,
      cutover,
      restored,
      redelivery: true,
      emptyReceiptTerminalized: true,
      workerLifecycle: true,
      cronCutoverRollback: true,
    };
  } finally {
    await client.query('rollback');
  }
}

const env = localEnv();
assert.ok(env.SUPABASE_DB_URL, 'SUPABASE_DB_URL is required');
const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL,
  connectionTimeoutMillis: 15_000,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const baseline = await state(client);
  if (process.argv.includes('--prepare-db')) {
    await client.query('begin');
    try {
      await client.query(read('supabase/schema-integration-events.sql'));
      await client.query(read('supabase/schema-integration-effect-handlers.sql'));
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
    const prepared = await state(client);
    assert.equal(prepared.legacy_table, true);
    assert.equal(prepared.legacy_claim, true);
    assert.equal(prepared.generic_claim, true);
    assert.equal(prepared.stock_handler, true);
    assert.equal(prepared.notification_handler, true);
    assert.equal(prepared.legacy_count, prepared.generic_count);
    process.stdout.write(`${JSON.stringify({
      integrationEffectsCutover: 'PREPARED', baseline, prepared,
    })}\n`);
  } else if (process.argv.includes('--rollback')) {
    await client.query('begin');
    try {
      await client.query(read('supabase/rollback-integration-effects-cutover.sql'));
      await client.query(read('supabase/rollback-integration-effects-cron.sql'));
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
    const rolledBack = await state(client);
    const cron = await cronState(client);
    assert.equal(rolledBack.legacy_table, true);
    assert.equal(rolledBack.legacy_claim, true);
    assert.ok(cron.some((job) => job.jobname === 'stripe-effects'
      && job.legacy_route && job.legacy_header));
    process.stdout.write(`${JSON.stringify({
      integrationEffectsCutover: 'ROLLED_BACK', baseline, rolledBack, cron,
    })}\n`);
  } else if (process.argv.includes('--apply')) {
    await client.query('begin');
    try {
      await client.query(read('supabase/schema-integration-events.sql'));
      await client.query(read('supabase/schema-integration-effect-handlers.sql'));
      await client.query(read('supabase/cutover-integration-effects-cron.sql'));
      await client.query(read('supabase/cutover-integration-effects.sql'));
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
    const applied = await state(client);
    const cron = await cronState(client);
    assert.equal(applied.legacy_table, false);
    assert.equal(applied.legacy_claim, false);
    assert.equal(applied.generic_claim, true);
    assert.equal(applied.stock_handler, true);
    assert.equal(applied.notification_handler, true);
    assert.ok(cron.some((job) => job.jobname === 'integration-effects'
      && job.generic_route && job.generic_header));
    process.stdout.write(`${JSON.stringify({
      integrationEffectsCutover: 'APPLIED', baseline, applied, cron,
    })}\n`);
  } else {
    const verification = await verifyTransaction(client);
    const restoredBaseline = await state(client);
    assert.deepEqual(restoredBaseline, baseline);
    process.stdout.write(`${JSON.stringify({ integrationEffectsCutover: 'PASS', baseline, verification, restoredBaseline })}\n`);
  }
} finally {
  await client.end();
}
