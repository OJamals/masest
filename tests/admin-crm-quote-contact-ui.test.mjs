import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../js/admin/quotes.js', import.meta.url), 'utf8');

test('deal drawer details has a Buyer contact picker', () => {
  assert.match(src, /Buyer contact <select class="adm-select" data-d-contact/);
});

test('drawer populates the picker from the resolved company on open', () => {
  assert.match(src, /async function loadDrawerContacts\(dlg, quote\)/);
  assert.match(src, /\/api\/admin\/quotes\?view=contacts&id=/);
  assert.match(src, /sel\.innerHTML = '<option value="">— no linked account —<\/option>'/);
  assert.match(src, /loadDrawerContacts\(dlg, quote\);/);
});

test('save sends the chosen contact_id', () => {
  assert.match(src, /contact_id: v\('\[data-d-contact\]'\) \|\| null/);
});
