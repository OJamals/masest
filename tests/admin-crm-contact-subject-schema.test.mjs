import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/schema-crm-contact-subject.sql', import.meta.url), 'utf8');

test('swaps the subject_type CHECK to allow contact on both tables', () => {
  assert.match(sql, /drop constraint if exists crm_notes_subject_type_check/);
  assert.match(sql, /drop constraint if exists crm_tasks_subject_type_check/);
  assert.match(sql, /crm_notes_subject_type_chk[\s\S]*check \(subject_type in \('company','quote','contact'\)\)/);
  assert.match(sql, /crm_tasks_subject_type_chk[\s\S]*check \(subject_type in \('company','quote','contact'\)\)/);
});

test('idempotent re-run guarded against duplicate constraint', () => {
  assert.match(sql, /exception when duplicate_object then null/);
});
