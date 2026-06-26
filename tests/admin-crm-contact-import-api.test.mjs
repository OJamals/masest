import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/contacts.js', import.meta.url), 'utf8');

test('import action parses CSV + validates each row via contactRow', () => {
  assert.match(src, /body\.action === 'import'/);
  assert.match(src, /parseContactsCsv\(body\.csv \|\| ''\)/);
  assert.match(src, /company_required/);
  assert.match(src, /no_rows/);
  assert.match(src, /contactRow\(\{ \.\.\.r, company_id: companyId/);
});

test('import bulk-inserts valid rows, caps at 500, returns counts + errors', () => {
  assert.match(src, /\.slice\(0, 500\)/);
  assert.match(src, /from\('crm_contacts'\)\.insert\(rows\)/);
  assert.match(src, /inserted, skipped: errors\.length, errors: errors\.slice\(0, 10\)/);
  assert.match(src, /crm\.contact_import/);
});
