import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('ShipStation migration persists provider state and atomically guards label purchase', async () => {
  const [migration, base] = await Promise.all([
    read('../supabase/schema-shipstation.sql'),
    read('../supabase/schema.sql'),
  ]);
  for (const column of [
    'shipstation_shipment_id',
    'shipstation_label_id',
    'shipstation_rate_id',
    'shipstation_label_url',
    'shipstation_cost',
    'shipstation_label_status',
    'shipstation_error',
    'shipstation_return_label_id',
    'shipstation_return_label_status',
    'shipstation_return_cost',
    'shipstation_return_currency',
    'shipstation_return_charge_event',
    'shipstation_return_tracking_number',
    'shipstation_return_error',
  ]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}\\b`));
    assert.match(base, new RegExp(`add column if not exists ${column}\\b`));
  }
  assert.match(migration, /create unique index if not exists orders_shipstation_label_uidx/);
  assert.match(migration, /create or replace function public\.claim_shipstation_label_purchase/);
  assert.match(migration, /shipstation_label_id is null/);
  assert.match(migration, /set shipstation_label_status = 'purchasing',\s+shipstation_label_id = null,/);
  assert.match(migration, /set shipstation_label_status = 'purchasing',[\s\S]{0,1000}shipstation_return_label_id = null,[\s\S]{0,500}shipstation_rate_id = p_rate_id/);
  assert.match(migration, /shipstation_label_status is distinct from 'purchasing'/);
  assert.match(migration, /grant execute on function public\.claim_shipstation_label_purchase\(uuid, text\) to service_role/);
  assert.doesNotMatch(migration, /grant execute[^;]+to (?:anon|authenticated)/);
  assert.match(migration, /create or replace function public\.claim_shipstation_return_label/);
  assert.match(migration, /create or replace function public\.finalize_shipstation_return_label/);
  assert.match(migration, /create or replace function public\.finalize_shipstation_label_reconciliation/);
  assert.match(migration, /perform public\.link_order_provider_object/);
  assert.match(migration, /v_financial_id := public\.record_order_financial_entry/);
  assert.match(migration, /'label-reconcile:' \|\| p_label_id/);
  assert.match(migration, /'shipstation_label_purchase_reconciled'/);
  assert.match(migration, /shipstation_return_label_status = 'return_purchasing'/);
  assert.match(migration, /grant execute on function public\.claim_shipstation_return_label\(uuid, text\) to service_role/);
  assert.match(migration, /grant execute on function public\.finalize_shipstation_return_label/);
  assert.match(migration, /grant execute on function public\.finalize_shipstation_label_reconciliation/);
});

test('ShipStation migration supports idempotent provider tracking events and CMS package profiles', async () => {
  const sql = await read('../supabase/schema-shipstation.sql');
  assert.match(sql, /shipping_weight_lb/);
  assert.match(sql, /shipping_length_in/);
  assert.match(sql, /provider_event_key/);
  assert.match(sql, /shipment_events_provider_event_key_uidx/);
});
