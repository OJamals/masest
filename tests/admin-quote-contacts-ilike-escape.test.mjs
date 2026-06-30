import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/quotes.js', import.meta.url), 'utf8');

// The view=contacts resolver maps a loosely-coupled quote.company (a name) to a company id via
// ILIKE. Without escaping, a name containing _ or % becomes a wildcard and can resolve to the
// WRONG company, then the deal drawer writes a cross-company contact_id onto the quote.
test('view=contacts company resolver escapes LIKE metacharacters', () => {
  assert.match(src, /import \{ escapeLike \} from '\.\.\/\.\.\/_lib\/crm\.js'/);
  assert.match(src, /\.ilike\('name', escapeLike\(String\(q\.company\)\.trim\(\)\)\)/);
  assert.doesNotMatch(src, /\.ilike\('name', String\(q\.company\)\.trim\(\)\)\.limit/);
});
