import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : [];
  });
}

test('orders-to-companies embeds select the customer-company foreign key', () => {
  const ambiguous = [];
  let embedCount = 0;

  for (const path of javascriptFiles(join(root, 'functions'))) {
    const source = readFileSync(path, 'utf8');
    const orderSelects = source.matchAll(/\.from\((['"])orders\1\)\s*\.select\((['"])([\s\S]*?)\2/g);

    for (const [, , , selection] of orderSelects) {
      const companyEmbeds = selection.matchAll(/(?:^|,)companies(?:![a-z0-9_]+)?\(/gi);
      for (const embed of companyEmbeds) {
        embedCount += 1;
        if (!embed[0].includes('companies!orders_company_id_fkey(')) {
          ambiguous.push(relative(root, path));
        }
      }
    }
  }

  assert.equal(embedCount, 5, 'expected every current orders-to-companies embed to be checked');
  assert.deepEqual(ambiguous, [], 'reverse support-order relationship makes an unhinted PostgREST embed ambiguous');
});
