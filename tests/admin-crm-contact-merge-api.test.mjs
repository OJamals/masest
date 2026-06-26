import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/contacts.js', import.meta.url), 'utf8');

test('merge action validates ids + same company', () => {
  assert.match(src, /body\.action === 'merge'/);
  assert.match(src, /fromId === intoId\) return json\(400, \{ error: 'invalid_merge' \}/);
  assert.match(src, /different_company/);
});

test('merge repoints deals, notes and tasks to the survivor', () => {
  assert.match(src, /from\('quotes'\)\.update\(\{ contact_id: intoId \}\)\.eq\('contact_id', fromId\)/);
  assert.match(src, /from\('crm_notes'\)\.update\(\{ subject_id: String\(intoId\) \}\)\.eq\('subject_type', 'contact'\)\.eq\('subject_id', String\(fromId\)\)/);
  assert.match(src, /from\('crm_tasks'\)\.update\(\{ subject_id: String\(intoId\) \}\)\.eq\('subject_type', 'contact'\)/);
});

test('merge backfills survivor blanks, retires duplicate, audits', () => {
  assert.match(src, /mergeFields\(into, from\)/);
  assert.match(src, /deleted_at: new Date\(\)\.toISOString\(\) \}\)\.eq\('id', fromId\)/);
  assert.match(src, /crm\.contact_merge/);
});
