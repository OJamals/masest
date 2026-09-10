import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sql = read('supabase/schema-crm-prospects.sql');
const rollback = read('supabase/rollback-crm-prospects.sql');
const outreachMigration = read('supabase/migrate-crm-prospect-outreach-2026-09-09.sql');

test('prospects use one bounded domain with durable source lineage and outreach drafts', () => {
  for (const table of [
    'prospect_import_batches',
    'prospect_organizations',
    'prospect_contacts',
    'prospect_source_records',
    'prospect_outreach_drafts',
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
  for (const table of ['prospect_import_batches', 'prospect_organizations', 'prospect_contacts', 'prospect_source_records', 'prospect_outreach_drafts']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant (?:select, insert, update, delete|all privileges) on table public\\.${table} to service_role`, 'i'));
  }
});

test('rollback is ordered, guarded, and opt-in', () => {
  assert.match(rollback, /current_setting\('masest\.confirm_prospect_rollback', true\)/i);
  assert.match(rollback, /prospect_rollback_confirmation_required/i);
  const outreach = rollback.indexOf('drop table if exists public.prospect_outreach_drafts');
  const source = rollback.indexOf('drop table if exists public.prospect_source_records');
  const contacts = rollback.indexOf('drop table if exists public.prospect_contacts');
  const organizations = rollback.indexOf('drop table if exists public.prospect_organizations');
  const batches = rollback.indexOf('drop table if exists public.prospect_import_batches');
  assert.ok(outreach >= 0 && outreach < source && source < contacts && contacts < organizations && organizations < batches);
});

test('outreach drafts are manual, auditable, and cannot become an email sender', () => {
  assert.match(sql, /status\s+text not null default 'draft'/i);
  assert.match(sql, /status in \('draft','approved','sent','replied','opted_out','archived'\)/i);
  assert.match(sql, /compliance_basis\s+text/i);
  assert.match(sql, /source_url\s+text/i);
  assert.match(sql, /approved_by\s+text/i);
  assert.match(sql, /sent_at\s+timestamptz/i);
  assert.doesNotMatch(sql, /queue|provider_message_id|campaign_id/i);
});

test('existing Prospect installs receive an additive, service-role-only outreach migration', () => {
  assert.match(outreachMigration, /begin;[\s\S]*create table if not exists public\.prospect_outreach_drafts[\s\S]*commit;/i);
  assert.match(outreachMigration, /alter table public\.prospect_outreach_drafts enable row level security/i);
  assert.match(outreachMigration, /revoke all on table public\.prospect_outreach_drafts from public, anon, authenticated/i);
  assert.match(outreachMigration, /grant select, insert, update, delete on table public\.prospect_outreach_drafts to service_role/i);
});
