import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../js/admin/crm.js', import.meta.url), 'utf8');

test('each contact row offers a Merge action', () => {
  assert.match(src, /data-crm-contact-merge="\$\{esc\(c\.id\)\}"/);
});

test('merge picks a survivor then posts the merge action', () => {
  assert.match(src, /function pickMergeTarget\(others\)/);
  assert.match(src, /data-merge-into/);
  assert.match(src, /body: \{ action: 'merge', from_id: fromId, into_id: intoId \}/);
});

test('merge guards against having no other contact', () => {
  assert.match(src, /others\.length\)/);
  assert.match(src, /No other contact to merge into/);
});
