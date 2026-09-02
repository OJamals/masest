import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sql = read('supabase/schema-crm-prospects.sql');
const rollback = read('supabase/rollback-crm-prospects.sql');

test('prospects use a separate four-table model with durable source lineage', () => {
  for (const table of [
    'prospect_import_batches',
    'prospect_organizations',
    'prospect_contacts',
    'prospect_source_records',
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, 'i'));
  }
  assert.match(sql, /identity_key\s+text not null unique/i);
  assert.match(sql, /source_sha256\s+text not null unique/i);
  assert.match(sql, /primary key \(import_batch_id, source_record_id\)/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.companies/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.profiles/i);
});

test('unknown consent and unreviewed outreach are database defaults', () => {
  assert.ok((sql.match(/marketing_consent\s+text not null default 'unknown'/gi) || []).length >= 2);
  assert.ok((sql.match(/outreach_status\s+text not null default 'unreviewed'/gi) || []).length >= 2);
  assert.ok((sql.match(/retention_review_at\s+date not null default \(current_date \+ 365\)/gi) || []).length >= 2);
  assert.match(sql, /marketing_consent in \('unknown','opted_in','opted_out'\)/i);
  assert.match(sql, /outreach_status in \('unreviewed','approved','blocked'\)/i);
});

test('prospect conversion is an explicit nullable link to a Company', () => {
  assert.match(sql, /linked_company_id\s+uuid references public\.companies\(id\) on delete set null/i);
  assert.match(sql, /status\s+text not null default 'new'/i);
  assert.match(sql, /status in \('new','researching','qualified','converted','archived'\)/i);
});

test('prospect PII is service-role only behind RLS', () => {
  for (const table of ['prospect_import_batches', 'prospect_organizations', 'prospect_contacts', 'prospect_source_records']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant (?:select, insert, update, delete|all privileges) on table public\\.${table} to service_role`, 'i'));
  }
});

test('rollback is ordered, guarded, and opt-in', () => {
  assert.match(rollback, /current_setting\('masest\.confirm_prospect_rollback', true\)/i);
  assert.match(rollback, /prospect_rollback_confirmation_required/i);
  const source = rollback.indexOf('drop table if exists public.prospect_source_records');
  const contacts = rollback.indexOf('drop table if exists public.prospect_contacts');
  const organizations = rollback.indexOf('drop table if exists public.prospect_organizations');
  const batches = rollback.indexOf('drop table if exists public.prospect_import_batches');
  assert.ok(source >= 0 && source < contacts && contacts < organizations && organizations < batches);
});
