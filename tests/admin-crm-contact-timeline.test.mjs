import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/timeline.js', import.meta.url), 'utf8');

test('contact timeline pulls the deals it is the buyer on', () => {
  assert.match(src, /subjectType === 'contact'/);
  assert.match(src, /from\('quotes'\)[\s\S]*\.eq\('contact_id', Number\(id\) \|\| -1\)/);
});

test('notes + tasks still keyed by subject (works for contact too)', () => {
  assert.match(src, /crm_notes'\)[\s\S]*\.eq\('subject_type', subjectType\)/);
  assert.match(src, /crm_tasks'\)[\s\S]*\.eq\('subject_type', subjectType\)/);
});
