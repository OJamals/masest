import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../js/admin/crm.js', import.meta.url), 'utf8');

test('contacts tab offers a CSV file import control', () => {
  assert.match(src, /data-crm-contact-import/);
  assert.match(src, /type="file" accept="\.csv,text\/csv"/);
});

test('a change handler previews, confirms, then posts the import action', () => {
  assert.match(src, /panel\.addEventListener\('change'/);
  assert.match(src, /const file = imp\.files\[0\]/);
  assert.match(src, /await file\.text\(\)/);
  assert.match(src, /body: \{ action: 'preview_import', company_id: subjectId, csv \}/);
  assert.match(src, /preview\.needs_migration/);
  assert.match(src, /contactImportSkipSummary\(preview\)/);
  assert.match(src, /counts\.name_required/);
  assert.match(src, /await confirmDialog\(/);
  assert.match(src, /body: \{ action: 'import', company_id: subjectId, csv \}/);
  assert.match(src, /Imported \$\{res\.inserted\}, skipped \$\{res\.skipped\}/);
});

test('CSV import help states account and size boundaries', () => {
  assert.match(src, /one account per file/i);
  assert.match(src, /up to 500 rows/i);
});
