import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/quotes.js', import.meta.url), 'utf8');

test('serves a buyer-contact candidate view resolved from the deal company', () => {
  assert.match(src, /=== 'contacts'/);
  assert.match(src, /companyIdForQuote\(sb, \{ email: q\.email \}\)/);
  // name fallback so established accounts match even without an email→account link
  assert.match(src, /\.ilike\('name', String\(q\.company\)\.trim\(\)\)/);
  assert.match(src, /from\('crm_contacts'\)/);
  assert.match(src, /company_id: null, contacts: \[\]/);
});

test('GET list + patch select expose contact_id', () => {
  assert.match(src, /lost_reason,contact_id', \{ count: 'exact' \}/);
  assert.match(src, /expected_close,lost_reason,contact_id,email,product,company,type/);
});

test('PATCH accepts + normalizes contact_id (nullable, numeric)', () => {
  assert.match(src, /if \(body\.contact_id !== undefined\)/);
  assert.match(src, /patch\.contact_id = body\.contact_id === null \|\| body\.contact_id === '' \? null/);
  assert.match(src, /Number\(body\.contact_id\) \|\| null/);
});
