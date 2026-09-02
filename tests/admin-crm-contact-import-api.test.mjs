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

test('preview action uses the same CRM Contact module without importing', () => {
  assert.match(src, /body\.action === 'preview_import'/);
  assert.match(src, /contacts\.previewCsv\(\{\s*companyId: body\.company_id,\s*csv: body\.csv,\s*actor: user\.email \|\| null/);
});

test('oversized contact imports fail with payload-too-large', () => {
  assert.match(src, /\['csv_too_large', 'row_limit_exceeded'\]\.includes\(result\.error\)/);
  assert.match(src, /json\(413, \{ error: result\.error, limit: result\.limit, total: result\.total, max_bytes: result\.max_bytes \}\)/);
  assert.match(src, /RequestBodyTooLargeError, readBoundedJson/);
  assert.match(src, /await readBoundedJson\(request, CONTACT_REQUEST_MAX_BYTES\)/);
  assert.match(src, /error instanceof RequestBodyTooLargeError/);
  assert.doesNotMatch(src, /request\.headers\.get\('content-length'\)/);
});

test('invalid CSV types remain client errors', () => {
  assert.match(src, /'invalid_csv'/);
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
