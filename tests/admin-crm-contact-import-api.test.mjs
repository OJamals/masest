import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/contacts.js', import.meta.url), 'utf8');

test('import action parses CSV + validates each row via contactRow', () => {
  assert.match(src, /body\.action === 'import'/);
  assert.match(src, /parseContactsCsv\(body\.csv \|\| ''\)/);
  assert.match(src, /company_required/);
  assert.match(src, /no_rows/);
  assert.match(src, /prepareContactImportRows\(parsed,\s*\{\s*companyId,\s*actor:/);
});

test('import prefilters existing active contact emails before bulk insert', () => {
  assert.match(src, /select\('email'\)/);
  assert.match(src, /\.eq\('company_id', companyId\)/);
  assert.match(src, /\.is\('deleted_at', null\)/);
  assert.match(src, /existingEmailKeys/);
  assert.match(src, /duplicate_email/);
  assert.match(src, /skipped_duplicates/);
});

test('import bulk-inserts filtered valid rows and returns counts + errors', () => {
  assert.match(src, /from\('crm_contacts'\)\.insert\(rows\)/);
  assert.match(src, /inserted, skipped: errors\.length, skipped_duplicates: duplicateSkips/);
  assert.match(src, /crm\.contact_import/);
});

test('import turns unique-index races into a clear duplicate-email conflict', () => {
  assert.match(src, /crm_contacts_company_email_uniq/);
  assert.match(src, /json\(409,\s*\{\s*error: 'duplicate_email'/);
});
