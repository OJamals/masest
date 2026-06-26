import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/schema-crm-contacts.sql', import.meta.url), 'utf8');

test('creates crm_contacts idempotently with company_id + role check', () => {
  assert.match(sql, /create table if not exists public\.crm_contacts/);
  assert.match(sql, /company_id\s+text not null/);
  assert.match(sql, /name\s+text not null/);
  assert.match(sql, /role\s+text not null default 'other'/);
  assert.match(sql, /check \(role in \('procurement','plant_manager','maintenance','engineering','operations','accounts_payable','executive','other'\)\)/);
  assert.match(sql, /is_primary\s+boolean not null default false/);
  assert.match(sql, /deleted_at\s+timestamptz/);
});

test('indexes by company + grants service_role (pooler 42501 guard)', () => {
  assert.match(sql, /create index if not exists crm_contacts_company_idx on public\.crm_contacts \(company_id, is_primary desc, name\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /grant all privileges on table public\.crm_contacts to service_role/);
  assert.match(sql, /grant usage, select on all sequences in schema public to service_role/);
});
