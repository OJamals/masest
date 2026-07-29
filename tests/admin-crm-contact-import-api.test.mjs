import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/contacts.js', import.meta.url), 'utf8');

test('import action delegates its full workflow to the CRM Contact module', () => {
  assert.match(src, /body\.action === 'import'/);
  assert.match(src, /createCrmContactModule\(\{/);
  assert.match(src, /store: createSupabaseCrmContactStore\(sb\)/);
  assert.match(src, /contacts\.importCsv\(\{\s*companyId: body\.company_id,\s*csv: body\.csv,\s*actor: user\.email \|\| null/);
});

test('route no longer owns import parsing, deduplication, or persistence', () => {
  assert.doesNotMatch(src, /parseContactsCsv/);
  assert.doesNotMatch(src, /prepareContactImportRows/);
  assert.doesNotMatch(src, /existingEmailKeys/);
  assert.doesNotMatch(src, /from\('crm_contacts'\)\.insert\(rows\)/);
});

test('import turns unique-index races into a clear duplicate-email conflict', () => {
  assert.match(src, /result\.error === 'duplicate_email'/);
  assert.match(src, /json\(409, \{ error: result\.error, message: result\.message \}\)/);
});
