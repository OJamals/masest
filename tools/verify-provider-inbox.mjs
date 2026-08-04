import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';

const mode = process.argv[2] || '--verify';
const rawEnv = fs.readFileSync('.dev.vars', 'utf8');
const envValue = (key) => {
  const match = rawEnv.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!match) throw new Error(`${key} missing`);
  return match[1].trim().replace(/^['"]|['"]$/g, '');
};
const schema = fs.readFileSync('supabase/schema-provider-inbox.sql', 'utf8');
const rollback = fs.readFileSync('supabase/rollback-provider-inbox.sql', 'utf8');
const client = new pg.Client({ connectionString: envValue('SUPABASE_DB_URL') });

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

async function state() {
  const functions = await client.query(`
    select p.proname
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in (
       'ingest_provider_event',
       'ingest_qbo_provider_events',
       'upsert_resend_inbound_message',
       'provider_integration_health',
       'provider_integration_dead_letters',
       'apply_shipstation_tracking_integration_effect',
       'apply_resend_delivery_integration_effect',
       'apply_qbo_change_integration_effect'
     ) order by p.proname
  `);
  const tables = await client.query(`select
    to_regclass('public.integration_receipts') is not null receipts,
    to_regclass('public.qbo_change_events') is not null qbo_changes,
    to_regclass('public.qbo_entity_state') is not null qbo_state`);
  return { functions: functions.rows.map((row) => row.proname), ...tables.rows[0] };
}

async function ingest({ provider, tenant, eventId, eventType, objectId, occurredAt, transportId, payload, effect }) {
  return client.query(`select public.ingest_provider_event(
    $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11
  ) event_id`, [
    provider,
    tenant,
    eventId,
    eventType,
    objectId,
    occurredAt,
    new Date().toISOString(),
    hash(payload),
    JSON.stringify({ source: 'verification', schema_version: 1 }),
    JSON.stringify([effect]),
    transportId,
  ]);
}

async function claimAndProject(workerId, expectedType, rpc) {
  const claimed = await client.query(
    'select * from public.claim_integration_effects($1,$2,$3)',
    [workerId, 1, 60],
  );
  if (claimed.rowCount !== 1 || claimed.rows[0].effect_type !== expectedType) {
    throw new Error(`expected ${expectedType}, got ${claimed.rows[0]?.effect_type || 'none'}`);
  }
  const effectId = claimed.rows[0].id;
  const projected = await client.query(`select public.${rpc}($1,$2) result`, [effectId, workerId]);
  const completed = await client.query('select public.complete_integration_effect($1,$2) completed', [effectId, workerId]);
  if (completed.rows[0]?.completed !== true) throw new Error(`${expectedType} completion failed`);
  return projected.rows[0].result;
}

async function behavioralProof() {
  const suffix = crypto.randomUUID();
  const shipRaw = JSON.stringify({ resource_type: 'API_TRACK', id: suffix });
  const shipEventId = `canonical:v2:${hash(shipRaw)}`;
  const shipEffect = {
    effect_key: 'tracking-projection',
    effect_type: 'shipstation_tracking_projection',
    aggregate_type: 'shipment',
    aggregate_id: `UNMATCHED-${suffix}`,
    max_attempts: 3,
    payload: {
      tracking_number: `UNMATCHED-${suffix}`,
      tracking_status: 'delivered',
      status_code: 'DE',
      event_code: 'DELIVERED',
      occurred_at: '2026-08-04T15:00:00Z',
      note: 'Delivered',
      estimated_delivery_at: null,
      event_key: hash(`ship:${suffix}`),
    },
  };
  const shipArgs = {
    provider: 'shipstation', tenant: 'production', eventId: shipEventId,
    eventType: 'track', objectId: `UNMATCHED-${suffix}`,
    occurredAt: '2026-08-04T15:00:00Z', payload: shipRaw, effect: shipEffect,
  };
  const first = await ingest({ ...shipArgs, transportId: `transport-a-${suffix}` });
  const second = await ingest({ ...shipArgs, transportId: `transport-b-${suffix}` });
  if (first.rows[0].event_id !== second.rows[0].event_id) throw new Error('duplicate event split');
  const duplicate = await client.query(`select
    (select count(*)::int from public.integration_events where id=$1) events,
    (select count(*)::int from public.integration_effects where event_id=$1) effects,
    (select count(*)::int from public.integration_receipts where event_id=$1) receipts`, [first.rows[0].event_id]);
  if (JSON.stringify(duplicate.rows[0]) !== JSON.stringify({ events: 1, effects: 1, receipts: 2 })) {
    throw new Error(`duplicate proof failed: ${JSON.stringify(duplicate.rows[0])}`);
  }
  const shipResult = await claimAndProject(
    `ship-${suffix}`,
    'shipstation_tracking_projection',
    'apply_shipstation_tracking_integration_effect',
  );
  if (shipResult?.skipped !== 'unmatched_order') throw new Error('ShipStation unmatched proof failed');

  const qboEvent = async (id, occurredAt, operation) => {
    const raw = JSON.stringify({ id, occurredAt, operation });
    await ingest({
      provider: 'quickbooks', tenant: `production:realm-${suffix}`, eventId: id,
      eventType: `qbo.invoice.${operation}.v1`,
      objectId: `invoice-${suffix}`, occurredAt, transportId: `tid-${id}`, payload: raw,
      effect: {
        effect_key: 'change-projection',
        effect_type: 'qbo_change_projection',
        aggregate_type: 'qbo_entity',
        aggregate_id: `realm-${suffix}:invoice:invoice-${suffix}`,
        payload: {
          realm_id: `realm-${suffix}`,
          entity_name: 'invoice',
          entity_id: `invoice-${suffix}`,
          operation,
          occurred_at: occurredAt,
        },
      },
    });
    return claimAndProject(`qbo-${id}`, 'qbo_change_projection', 'apply_qbo_change_integration_effect');
  };
  const current = await qboEvent(`qbo-new-${suffix}`, '2026-08-04T15:00:00Z', 'updated');
  const stale = await qboEvent(`qbo-old-${suffix}`, '2026-08-04T14:00:00Z', 'deleted');
  const qbo = await client.query(`select
    (select count(*)::int from public.qbo_change_events where realm_id=$1) history,
    operation,
    provider_occurred_at
    from public.qbo_entity_state where realm_id=$1 and entity_name='invoice' and entity_id=$2`, [
    `realm-${suffix}`, `invoice-${suffix}`,
  ]);
  if (current?.applied !== true || stale?.skipped !== 'stale_event'
      || qbo.rows[0]?.history !== 2 || qbo.rows[0]?.operation !== 'updated') {
    throw new Error(`QBO ordering proof failed: ${JSON.stringify({ current, stale, qbo: qbo.rows[0] })}`);
  }

  const resendRaw = JSON.stringify({ type: 'email.delivered', id: suffix });
  await ingest({
    provider: 'resend', tenant: 'production', eventId: `svix-${suffix}`,
    eventType: 'email.delivered', objectId: `email-${suffix}`,
    occurredAt: '2026-08-04T15:00:00Z', transportId: `svix-${suffix}`, payload: resendRaw,
    effect: {
      effect_key: 'delivery-projection',
      effect_type: 'resend_delivery_projection',
      aggregate_type: 'email',
      aggregate_id: `email-${suffix}`,
      payload: {
        resend_id: `email-${suffix}`,
        event_type: 'email.delivered',
        status: 'delivered',
        occurred_at: '2026-08-04T15:00:00Z',
      },
    },
  });
  const resend = await claimAndProject(
    `resend-${suffix}`,
    'resend_delivery_projection',
    'apply_resend_delivery_integration_effect',
  );
  if (resend?.skipped !== 'unmatched_email') throw new Error('Resend unmatched proof failed');

  const buyerEmail = `buyer-${suffix}@example.com`;
  const staffEmail = `staff-${suffix}@masest.co`;
  await client.query(`insert into public.email_events (resend_id, to_email, category, subject, status)
    values ($1,$2,'order','Verification','sent')`, [
    `email-bounce-${suffix}`, `${buyerEmail}, ${staffEmail}`,
  ]);
  const bounce = async (id, occurredAt, recipient) => {
    const raw = JSON.stringify({ type: 'email.bounced', id, occurredAt });
    await ingest({
      provider: 'resend', tenant: 'production', eventId: id,
      eventType: 'email.bounced', objectId: `email-bounce-${suffix}`,
      occurredAt, transportId: id, payload: raw,
      effect: {
        effect_key: 'delivery-projection',
        effect_type: 'resend_delivery_projection',
        aggregate_type: 'email',
        aggregate_id: `email-bounce-${suffix}`,
        payload: {
          resend_id: `email-bounce-${suffix}`,
          event_type: 'email.bounced',
          status: 'bounced',
          occurred_at: occurredAt,
          recipient_digests: [hash(`resend-recipient:v1:${recipient}`)],
        },
      },
    });
    return claimAndProject(`resend-${id}`, 'resend_delivery_projection', 'apply_resend_delivery_integration_effect');
  };
  const buyerBounce = await bounce(`svix-buyer-${suffix}`, '2026-08-04T16:00:00Z', buyerEmail);
  const staleStaffBounce = await bounce(`svix-staff-${suffix}`, '2026-08-04T15:00:00Z', staffEmail);
  const suppressions = await client.query(`select email from public.email_suppressions
    where email in ($1,$2) order by email`, [buyerEmail, staffEmail]);
  if (buyerBounce?.applied !== true || staleStaffBounce?.skipped !== 'stale_event'
      || suppressions.rowCount !== 1 || suppressions.rows[0].email !== buyerEmail) {
    throw new Error(`Resend recipient suppression proof failed: ${JSON.stringify({
      buyerBounce, staleStaffBounce, suppressions: suppressions.rows,
    })}`);
  }

  const qboBatchRow = (id, valid = true) => ({
    environment_or_tenant: `production:batch-${suffix}`,
    provider_event_id: id,
    event_type: 'qbo.invoice.updated.v1',
    provider_object_id: `invoice-${id}`,
    occurred_at: '2026-08-04T16:00:00Z',
    payload_sha256: valid ? hash(`qbo-batch:${id}`) : 'invalid',
    metadata: { source: 'verification', schema_version: 2 },
    effects: [{
      effect_key: 'change-projection', effect_type: 'qbo_change_projection',
      aggregate_type: 'qbo_entity', aggregate_id: `qbo-batch-${id}`,
      payload: {
        realm_id: `batch-${suffix}`, entity_name: 'invoice', entity_id: `invoice-${id}`,
        operation: 'updated', occurred_at: '2026-08-04T16:00:00Z',
      },
    }],
  });
  await client.query('savepoint invalid_qbo_batch');
  let invalidBatchRejected = false;
  try {
    await client.query('select public.ingest_qbo_provider_events(now(),$1,$2::jsonb)', [
      `tid-invalid-${suffix}`,
      JSON.stringify([qboBatchRow(`atomic-a-${suffix}`), qboBatchRow(`atomic-b-${suffix}`, false)]),
    ]);
  } catch {
    invalidBatchRejected = true;
    await client.query('rollback to savepoint invalid_qbo_batch');
  }
  const invalidRows = await client.query(`select count(*)::int count from public.integration_events
    where provider_event_id in ($1,$2)`, [`atomic-a-${suffix}`, `atomic-b-${suffix}`]);
  const validBatch = await client.query(
    'select public.ingest_qbo_provider_events(now(),$1,$2::jsonb) count', [
      `tid-valid-${suffix}`,
      JSON.stringify([qboBatchRow(`valid-a-${suffix}`), qboBatchRow(`valid-b-${suffix}`)]),
    ],
  );
  if (!invalidBatchRejected || invalidRows.rows[0].count !== 0 || validBatch.rows[0].count !== 2) {
    throw new Error(`QBO batch atomic proof failed: ${JSON.stringify({
      invalidBatchRejected, invalidRows: invalidRows.rows[0], validBatch: validBatch.rows[0],
    })}`);
  }
  await client.query(`update public.integration_effects effect
    set status='completed', provider_succeeded_at=now(), completed_at=now()
    from public.integration_events event
    where event.id=effect.event_id and event.provider_event_id in ($1,$2)`, [
    `valid-a-${suffix}`, `valid-b-${suffix}`,
  ]);

  const member = await client.query(`select profile.id user_id, company.id company_id
    from public.profiles profile join public.companies company on company.id=profile.company_id
    limit 1`);
  let inboundAtomic = 'no_fixture';
  if (member.rowCount) {
    const input = [member.rows[0].company_id, member.rows[0].user_id, `inbound-${suffix}`, 'Verification reply'];
    const firstMessage = await client.query(
      'select public.upsert_resend_inbound_message($1,$2,$3,$4) result', input,
    );
    const duplicateMessage = await client.query(
      'select public.upsert_resend_inbound_message($1,$2,$3,$4) result', input,
    );
    const firstResult = firstMessage.rows[0].result;
    const duplicateResult = duplicateMessage.rows[0].result;
    if (firstResult?.inserted !== true || duplicateResult?.inserted !== false
        || firstResult?.message_id !== duplicateResult?.message_id) {
      throw new Error(`Resend inbound atomic proof failed: ${JSON.stringify({ firstResult, duplicateResult })}`);
    }
    inboundAtomic = true;
  }

  const healthEvent = await client.query(`select public.ingest_provider_event(
    'quickbooks',$1,$2,'qbo.invoice.updated.v1',$3,now(),now(),$4,$5::jsonb,$6::jsonb,$7
  ) event_id`, [
    `production:health-${suffix}`, `health-${suffix}`, `health-${suffix}`,
    hash(`health-${suffix}`), JSON.stringify({ source: 'verification', schema_version: 2 }),
    JSON.stringify([]), `tid-health-${suffix}`,
  ]);
  const healthEventId = healthEvent.rows[0].event_id;
  const healthPayload = {
    realm_id: `health-${suffix}`, entity_name: 'invoice', entity_id: 'health',
    operation: 'updated', occurred_at: '2026-08-04T16:00:00Z',
  };
  await client.query(`insert into public.integration_effects (
      event_id,effect_key,effect_type,aggregate_type,aggregate_id,payload,payload_sha256,
      status,completed_at,dead_at,created_at,updated_at
    )
    select $1,
           'health-' || lpad(series::text,3,'0'),
           'qbo_change_projection','qbo_entity',$2,$3::jsonb,$4,
           case when series=0 then 'dead' else 'completed' end,
           case when series=0 then null else clock_timestamp() end,
           case when series=0 then clock_timestamp() else null end,
           case when series=0 then clock_timestamp()-interval '1 day' else clock_timestamp() end,
           clock_timestamp()
      from generate_series(0,101) series`, [
    healthEventId, `health-${suffix}`, JSON.stringify(healthPayload), hash(JSON.stringify(healthPayload)),
  ]);
  const deadPage = await client.query(
    `select * from public.provider_integration_dead_letters('quickbooks',101,null,null)`,
  );
  if (!deadPage.rows.some((row) => row.event_id === healthEventId && row.id)) {
    throw new Error('DB-side dead-letter pagination hid older failure');
  }
  const health = await client.query(`select * from public.provider_integration_health()
    where provider='quickbooks'`);
  if (!health.rows[0] || Number(health.rows[0].dead_count) < 1
      || Number(health.rows[0].completed_count) < 101) {
    throw new Error(`provider health aggregate proof failed: ${JSON.stringify(health.rows[0])}`);
  }

  return {
    duplicateReceipt: true,
    qboOutOfOrder: true,
    qboBatchAtomic: true,
    unmatchedSafe: true,
    resendExactSuppression: true,
    resendStaleSuppressionBlocked: true,
    inboundAtomic,
    deadLetterWindowIndependent: true,
  };
}

await client.connect();
try {
  if (mode === '--status') {
    console.log(JSON.stringify({ providerInbox: 'STATUS', state: await state() }));
  } else if (mode === '--apply') {
    await client.query('begin');
    try { await client.query(schema); await client.query('commit'); } catch (error) { await client.query('rollback'); throw error; }
    console.log(JSON.stringify({ providerInbox: 'APPLIED', state: await state() }));
  } else if (mode === '--rollback') {
    await client.query('begin');
    try { await client.query(rollback); await client.query('commit'); } catch (error) { await client.query('rollback'); throw error; }
    console.log(JSON.stringify({ providerInbox: 'ROLLED_BACK', state: await state() }));
  } else if (mode === '--verify') {
    const baseline = await state();
    await client.query('begin');
    try {
      await client.query(schema);
      const installed = await state();
      const verification = await behavioralProof();
      await client.query(rollback);
      const disabled = await state();
      await client.query('rollback');
      const restored = await state();
      console.log(JSON.stringify({ providerInbox: 'PASS', baseline, installed, verification, disabled, restored }));
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } else {
    throw new Error('usage: verify-provider-inbox.mjs [--verify|--status|--apply|--rollback]');
  }
} finally {
  await client.end();
}
