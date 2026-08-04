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
  ]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}\\b`));
    assert.match(base, new RegExp(`add column if not exists ${column}\\b`));
  }
  assert.match(migration, /create unique index if not exists orders_shipstation_label_uidx/);
  assert.match(migration, /create or replace function public\.claim_shipstation_label_purchase/);
  assert.match(migration, /shipstation_label_id is null/);
  assert.match(migration, /shipstation_label_status is distinct from 'purchasing'/);
  assert.match(migration, /grant execute on function public\.claim_shipstation_label_purchase\(uuid, text\) to service_role/);
  assert.doesNotMatch(migration, /grant execute[^;]+to (?:anon|authenticated)/);
});

test('ShipStation migration supports idempotent provider tracking events and CMS package profiles', async () => {
  const sql = await read('../supabase/schema-shipstation.sql');
  assert.match(sql, /shipping_weight_lb/);
  assert.match(sql, /shipping_length_in/);
  assert.match(sql, /provider_event_key/);
  assert.match(sql, /shipment_events_provider_event_key_uidx/);
});
