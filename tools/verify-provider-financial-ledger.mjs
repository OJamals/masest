import fs from 'node:fs';
import pg from 'pg';

const mode = process.argv[2] || '--verify';
const rawEnv = fs.readFileSync('.dev.vars', 'utf8');
const envValue = (key) => {
  const match = rawEnv.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!match) throw new Error(`${key} missing`);
  return match[1].trim().replace(/^['"]|['"]$/g, '');
};
const schema = fs.readFileSync('supabase/schema-shipstation.sql', 'utf8');
const rollback = fs.readFileSync('supabase/rollback-shipstation-financial-ledger.sql', 'utf8');
const client = new pg.Client({ connectionString: envValue('SUPABASE_DB_URL') });

async function state() {
  const row = await client.query(`select
    to_regclass('public.order_financial_entries') is not null as ledger,
    to_regprocedure('public.record_order_financial_entry(uuid,text,text,text,numeric,text,text,text,text,jsonb)') is not null as record_rpc,
    to_regprocedure('public.claim_shipstation_label_void(uuid,text)') is not null as void_claim,
    to_regprocedure('public.finalize_shipstation_label_void(uuid,text,text,text,text)') is not null as void_finalize`);
  const constraint = await client.query(`select pg_get_constraintdef(oid) definition
    from pg_constraint
   where conrelid='public.orders'::regclass
     and conname='orders_shipstation_label_status_check'`);
  return { ...row.rows[0], status_constraint: constraint.rows[0]?.definition || null };
}

async function expectRejectedMutation(sql, params, message) {
  await client.query(`savepoint ${message}`);
  let rejected = false;
  try {
    await client.query(sql, params);
  } catch (error) {
    rejected = String(error.message).includes('order_financial_entries_immutable');
  }
  await client.query(`rollback to savepoint ${message}`);
  if (!rejected) throw new Error(`${message} did not fail closed`);
}

async function behavioralProof() {
  const suffix = Date.now().toString(36);
  const labelId = `se-label-verify-${suffix}`;
  const shipmentId = `se-shipment-verify-${suffix}`;
  const orderRow = await client.query(`insert into public.orders (
    status, customer_email, total, currency, tracking_status,
    shipstation_shipment_id, shipstation_label_id, shipstation_label_status, shipstation_cost
  ) values ('paid',$1,1,'usd','packing',$2,$3,'label_purchased',41.22)
  returning id`, [`verify-${suffix}@example.com`, shipmentId, labelId]);
  const orderId = orderRow.rows[0].id;

  const args = [orderId, 'shipstation', 'postage_purchase', labelId, 41.22, 'usd', 'recognized', null, null, JSON.stringify({ verification: true })];
  const first = await client.query(`select public.record_order_financial_entry(
    $1,$2,$3,$4,$5::numeric,$6,$7,$8,$9,$10::jsonb
  ) id`, args);
  const duplicate = await client.query(`select public.record_order_financial_entry(
    $1,$2,$3,$4,$5::numeric,$6,$7,$8,$9,$10::jsonb
  ) id`, args);
  if (first.rows[0].id !== duplicate.rows[0].id) throw new Error('financial ledger duplicate split');

  await client.query('savepoint identity_conflict');
  let conflictRejected = false;
  try {
    await client.query(`select public.record_order_financial_entry(
      $1,$2,$3,$4,$5::numeric,$6,$7,$8,$9,$10::jsonb
    )`, [orderId, 'shipstation', 'postage_purchase', labelId, 99, 'usd', 'recognized', null, null, '{}']);
  } catch (error) {
    conflictRejected = String(error.message).includes('order_financial_entry_identity_conflict');
  }
  await client.query('rollback to savepoint identity_conflict');
  if (!conflictRejected) throw new Error('financial ledger identity collision accepted');

  const firstClaim = await client.query('select public.claim_shipstation_label_void($1,$2) claimed', [orderId, labelId]);
  const secondClaim = await client.query('select public.claim_shipstation_label_void($1,$2) claimed', [orderId, labelId]);
  if (firstClaim.rows[0].claimed !== true || secondClaim.rows[0].claimed !== false) {
    throw new Error('void claim not atomic');
  }
  const finalization = await client.query(
    'select public.finalize_shipstation_label_void($1,$2,$3,$4,$5) result',
    [orderId, labelId, 'staff-verify', 'Verification void', 'Label voided'],
  );
  const repeatedFinalization = await client.query(
    'select public.finalize_shipstation_label_void($1,$2,$3,$4,$5) result',
    [orderId, labelId, 'staff-verify', 'Verification void', 'Label voided'],
  );
  if (finalization.rows[0].result?.applied !== true
      || finalization.rows[0].result?.financial_entry_id !== repeatedFinalization.rows[0].result?.financial_entry_id) {
    throw new Error('void finalization not atomic/idempotent');
  }
  const voidEvents = await client.query(`select count(*)::int count
    from public.shipment_events where provider='shipstation' and provider_event_key=$1`, [`label-void:${labelId}`]);
  if (voidEvents.rows[0].count !== 1) throw new Error('void shipment event duplicated');
  const replacementClaim = await client.query(
    'select public.claim_shipstation_label_purchase($1,$2) claimed',
    [orderId, `se-rate-verify-${suffix}`],
  );
  if (replacementClaim.rows[0].claimed !== true) throw new Error('replacement label remained locked');

  const totals = await client.query(`select
    count(*)::int entries,
    coalesce(sum(amount) filter (where recognition_state='recognized'),0)::numeric realized,
    coalesce(sum(amount) filter (where recognition_state='pending'),0)::numeric pending
    from public.order_financial_entries where order_id=$1`, [orderId]);
  if (JSON.stringify(totals.rows[0]) !== JSON.stringify({ entries: 2, realized: '41.22', pending: '-41.22' })) {
    throw new Error(`ledger totals wrong: ${JSON.stringify(totals.rows[0])}`);
  }

  await expectRejectedMutation(
    'update public.order_financial_entries set amount=0 where order_id=$1',
    [orderId],
    'immutable_update',
  );
  await expectRejectedMutation(
    'delete from public.order_financial_entries where order_id=$1',
    [orderId],
    'immutable_delete',
  );
  await client.query('savepoint retained_order');
  let orderRetained = false;
  try {
    await client.query('delete from public.orders where id=$1', [orderId]);
  } catch (error) {
    orderRetained = error.code === '23503';
  }
  await client.query('rollback to savepoint retained_order');
  if (!orderRetained) throw new Error('financial order deletion accepted');
  return {
    idempotent: true,
    collision_rejected: true,
    void_claim_atomic: true,
    void_finalization_atomic: true,
    void_event_idempotent: true,
    replacement_purchase_unlocked: true,
    recognized_postage: '41.22',
    pending_refund: '-41.22',
    immutable: true,
    financial_order_retained: true,
  };
}

await client.connect();
try {
  if (mode === '--status') {
    console.log(JSON.stringify({ providerFinancialLedger: 'STATUS', state: await state() }));
  } else if (mode === '--apply') {
    await client.query(schema);
    console.log(JSON.stringify({ providerFinancialLedger: 'APPLIED', state: await state() }));
  } else if (mode === '--rollback') {
    await client.query(rollback);
    console.log(JSON.stringify({ providerFinancialLedger: 'ROLLED_BACK', state: await state() }));
  } else if (mode === '--verify') {
    const baseline = await state();
    await client.query('begin');
    await client.query(schema);
    const installed = await state();
    const verification = await behavioralProof();
    await client.query(rollback);
    const disabled = await state();
    await client.query('rollback');
    const restored = await state();
    console.log(JSON.stringify({
      providerFinancialLedger: 'PASS', baseline, installed, verification, disabled, restored,
    }));
  } else {
    throw new Error('usage: node tools/verify-provider-financial-ledger.mjs [--verify|--status|--apply|--rollback]');
  }
} finally {
  await client.end();
}
