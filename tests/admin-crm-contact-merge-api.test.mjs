import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/contacts.js', import.meta.url), 'utf8');

test('merge action validates ids + same company', () => {
  assert.match(src, /body\.action === 'merge'/);
  assert.match(src, /contacts\.merge\(\{\s*fromId: body\.from_id,\s*intoId: body\.into_id/);
});

test('route keeps merge persistence behind the CRM Contact module', () => {
  assert.match(src, /createCrmContactModule\(\{/);
  assert.match(src, /store: createSupabaseCrmContactStore\(sb\)/);
  assert.doesNotMatch(src, /from\('crm_notes'\)\.update/);
  assert.doesNotMatch(src, /from\('crm_tasks'\)\.update/);
});
