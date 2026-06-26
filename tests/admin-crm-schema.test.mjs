import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/schema-crm.sql', import.meta.url), 'utf8');

test('schema-crm creates both tables idempotently', () => {
  assert.match(sql, /create table if not exists public\.crm_notes/i);
  assert.match(sql, /create table if not exists public\.crm_tasks/i);
});

test('schema-crm constrains subject, kind and status', () => {
  assert.match(sql, /subject_type\s+text\s+not null\s+check\s*\(subject_type in \('company','quote'\)\)/i);
  assert.match(sql, /kind\s+text\s+not null\s+default\s+'note'\s+check\s*\(kind in \('note','call','email','meeting'\)\)/i);
  assert.match(sql, /status\s+text\s+not null\s+default\s+'open'\s+check\s*\(status in \('open','done'\)\)/i);
});

test('schema-crm indexes subject and task scans', () => {
  assert.match(sql, /create index if not exists crm_notes_subject_idx/i);
  assert.match(sql, /create index if not exists crm_tasks_subject_idx/i);
  assert.match(sql, /create index if not exists crm_tasks_status_due_idx/i);
});

test('schema-crm enables RLS and grants service_role', () => {
  assert.match(sql, /alter table public\.crm_notes enable row level security/i);
  assert.match(sql, /alter table public\.crm_tasks enable row level security/i);
  assert.match(sql, /grant all privileges on table public\.crm_notes to service_role/i);
  assert.match(sql, /grant all privileges on table public\.crm_tasks to service_role/i);
  assert.match(sql, /grant usage, select on all sequences in schema public to service_role/i);
});
