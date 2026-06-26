import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../js/admin/crm.js', import.meta.url), 'utf8');

test('contacts tab offers a CSV file import control', () => {
  assert.match(src, /data-crm-contact-import/);
  assert.match(src, /type="file" accept="\.csv,text\/csv"/);
});

test('a change handler reads the file + posts the import action', () => {
  assert.match(src, /panel\.addEventListener\('change'/);
  assert.match(src, /await file\.text\(\)/);
  assert.match(src, /body: \{ action: 'import', company_id: subjectId, csv \}/);
  assert.match(src, /Imported \$\{res\.inserted\}, skipped \$\{res\.skipped\}/);
});
