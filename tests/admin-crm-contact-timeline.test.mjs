import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/timeline.js', import.meta.url), 'utf8');

test('contact timeline delegates retrieval to the relationship activity module', () => {
  assert.match(src, /createCrmActivityModule\(\{/);
  assert.match(src, /store: createSupabaseCrmActivityStore\(\{ sb \}\)/);
  assert.match(src, /activity\.timeline\(\{ subjectType, subjectId \}\)/);
});

test('route no longer owns contact deal, note, or task query details', () => {
  assert.doesNotMatch(src, /from\('quotes'\)/);
  assert.doesNotMatch(src, /from\('crm_notes'\)/);
  assert.doesNotMatch(src, /from\('crm_tasks'\)/);
});
