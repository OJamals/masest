import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/quotes.js', import.meta.url), 'utf8');
const lifecycle = readFileSync(new URL('../functions/_lib/quote-leads.js', import.meta.url), 'utf8');

test('serves a buyer-contact candidate view resolved from the deal company', () => {
  assert.match(src, /=== 'contacts'/);
  assert.match(src, /companyIdForQuote\(sb, \{ email: q\.email \}\)/);
  // name fallback so established accounts match even without an email→account link
  // (LIKE metacharacters escaped so a _ / % in the name can't wildcard-match another company)
  assert.match(src, /\.ilike\('name', escapeLike\(String\(q\.company\)\.trim\(\)\)\)/);
  assert.match(src, /from\('crm_contacts'\)/);
  assert.match(src, /company_id: null, contacts: \[\]/);
});

test('GET list + patch select expose contact_id', () => {
  // Since Plan 007 extracted the list columns into QUOTE_SELECT, we verify
  // the const holds contact_id and the list select uses the const with count.
  assert.match(src, /const QUOTE_SELECT\s*=\s*'[^']*lost_reason,contact_id'/);
  assert.match(src, /\.select\(QUOTE_SELECT,\s*\{[^}]*count[^}]*\}/);
  assert.match(lifecycle, /expected_close,lost_reason,contact_id,email,product,company,type/);
});

test('PATCH accepts + normalizes contact_id (nullable, numeric)', () => {
  assert.match(src, /leadLifecycle\.update\(/);
  assert.match(lifecycle, /if \(changes\.contact_id !== undefined\)/);
  assert.match(lifecycle, /patch\.contact_id = changes\.contact_id === null \|\| changes\.contact_id === ''/);
  assert.match(lifecycle, /Number\(changes\.contact_id\) \|\| null/);
});
