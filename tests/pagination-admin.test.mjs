// Pagination batch 2 (#29): admin companies + quotes lists.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

for (const path of ['functions/api/admin/companies.js', 'functions/api/admin/quotes.js']) {
  test(`${path} paginates with parsePage + .range + exact count + envelope`, () => {
    const src = read(path);
    assert.match(src, /parsePage\(/);
    assert.match(src, /\.range\(\s*offset\s*,/);
    assert.match(src, /count:\s*'exact'/);
    assert.match(src, /pageEnvelope\(/);
  });
}

test('quotes badge counts come from dedicated count queries, not the page', () => {
  const src = read('functions/api/admin/quotes.js');
  assert.match(src, /count:\s*'exact',\s*head:\s*true[\s\S]{0,80}eq\('status', 'new'\)/);
  assert.match(src, /eq\('priority', 'urgent'\)/);
});

test('admin companies + quotes lists expose Load more controls', () => {
  // Companies tab split into its own module in #36; quotes still lives in admin.js.
  assert.match(read('js/admin/companies.js'), /data-load-more-companies/);
  assert.match(read('js/admin/quotes.js'), /data-load-more-quotes/); // quotes tab moved in #36
});
