import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { recordOrderFinancialEntry } from '../functions/_lib/order-financial-ledger.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('order financial ledger adapter sends bounded normalized RPC arguments', async () => {
  let call;
  await recordOrderFinancialEntry({}, {
    orderId: '70f81af0-5ae5-4ea7-953b-f612b6e0ed91',
    source: ' shipstation ',
    entryType: 'postage_void_requested',
    providerObjectId: 'se-label-1',
    amount: -41.225,
    currency: 'USD',
    state: 'pending',
    actorId: 'staff-1',
    reason: 'Wrong package selected',
    metadata: { provider_message: 'Label voided' },
  }, {
    client: {
      rpc: async (name, args) => { call = { name, args }; return { error: null }; },
    },
  });
  assert.equal(call.name, 'record_order_financial_entry');
  assert.equal(call.args.p_source, 'shipstation');
  assert.equal(call.args.p_amount, -41.22);
  assert.equal(call.args.p_currency, 'usd');
  assert.deepEqual(call.args.p_metadata, { provider_message: 'Label voided' });
});

test('ShipStation financial schema is immutable, idempotent, pending-aware, and service-only', () => {
  const schema = read('supabase/schema-shipstation.sql');
  assert.match(schema, /create table if not exists public\.order_financial_entries/);
  assert.match(schema, /references public\.orders\(id\) on delete restrict/);
  assert.match(schema, /unique \(source, entry_type, provider_object_id\)/);
  assert.match(schema, /recognition_state in \('recognized', 'pending'\)/);
  assert.match(schema, /before update or delete on public\.order_financial_entries/);
  assert.match(schema, /on conflict \(source, entry_type, provider_object_id\) do nothing/);
  assert.match(schema, /order_financial_entry_identity_conflict/);
  assert.match(schema, /revoke all on public\.order_financial_entries from public, anon, authenticated/);
  assert.match(schema, /grant execute on function public\.record_order_financial_entry[\s\S]+to service_role/);
  assert.match(schema, /create or replace function public\.claim_shipstation_label_void/);
  assert.match(schema, /create or replace function public\.finalize_shipstation_label_void/);
  assert.match(schema, /'label-void:' \|\| p_label_id/);
  assert.match(schema, /tracking_status[\s\S]+not in \([\s\S]*'shipped'[\s\S]*'delivered'/);
});

test('ShipStation financial rollback removes only new ledger and restores purchase claim', () => {
  const rollback = read('supabase/rollback-shipstation-financial-ledger.sql');
  assert.match(rollback, /drop function if exists public\.claim_shipstation_label_void/);
  assert.match(rollback, /drop function if exists public\.finalize_shipstation_label_void/);
  assert.match(rollback, /drop table if exists public\.order_financial_entries/);
  assert.match(rollback, /when 'label_voided' then 'voided'/);
  assert.match(rollback, /create or replace function public\.claim_shipstation_label_purchase/);
  assert.match(rollback, /and shipstation_label_id is null/);
});

test('admin label void requires inline reason and explicit confirmation payload', () => {
  const source = read('js/admin/orders.js');
  assert.match(source, /data-shipstation-void-reason=/);
  assert.match(source, /data-shipstation-void-confirm=/);
  assert.match(source, /data-shipstation-void-label=/);
  assert.match(source, /reason\.length < 8/);
  assert.match(source, /body: \{ action: 'void_label', order_id: id, label_id: labelId, confirm: true, reason \}/);
  assert.match(source, /Carrier refund request recorded as pending/);
  assert.match(source, /\['label_purchased', 'label_void_failed'\]\.includes\(labelState\)/);
});

test('admin shell cache-busts the release carrying label void and finance evidence', () => {
  const html = read('admin.html');
  const admin = read('js/admin.js');
  assert.match(html, /js\/admin\.js\?v=20260807b/);
  assert.match(admin, /\.\/admin\/orders\.js\?v=20260807b/);
});
