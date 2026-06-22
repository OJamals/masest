// #37 — QBO sync N+1: a claimed batch that shares a company hit `companies` once per
// order. Batch the lookup into a single `.in('id', ids)` query before the sync loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { uniqueCompanyIds, companyNamesByIds } from '../functions/api/qbo-sync.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal Supabase stub: records how often companies is queried.
function fakeCompaniesSb(rows, { error = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, 'companies', 'only the companies table should be queried');
      return {
        select() { return this; },
        in(col, ids) { calls.push({ col, ids }); return Promise.resolve({ data: error ? null : rows, error }); },
      };
    },
  };
}

test('uniqueCompanyIds dedups and drops null/guest orders', () => {
  const orders = [{ company_id: 'c1' }, { company_id: 'c1' }, { company_id: 'c2' }, { company_id: null }, {}];
  assert.deepEqual(uniqueCompanyIds(orders), ['c1', 'c2']);
});

test('uniqueCompanyIds tolerates empty/missing input', () => {
  assert.deepEqual(uniqueCompanyIds([]), []);
  assert.deepEqual(uniqueCompanyIds(undefined), []);
});

test('companyNamesByIds resolves all names in a single query', async () => {
  const sb = fakeCompaniesSb([{ id: 'c1', name: 'Acme Co' }, { id: 'c2', name: 'Beta LLC' }]);
  const map = await companyNamesByIds(sb, ['c1', 'c2']);
  assert.deepEqual(map, { c1: 'Acme Co', c2: 'Beta LLC' });
  assert.equal(sb.calls.length, 1, 'one batched query, not one per id');
  assert.deepEqual(sb.calls[0], { col: 'id', ids: ['c1', 'c2'] });
});

test('companyNamesByIds skips rows with no name', async () => {
  const sb = fakeCompaniesSb([{ id: 'c1', name: 'Acme Co' }, { id: 'c2', name: null }]);
  assert.deepEqual(await companyNamesByIds(sb, ['c1', 'c2']), { c1: 'Acme Co' });
});

test('companyNamesByIds makes no query for an empty id set', async () => {
  const sb = fakeCompaniesSb([]);
  assert.deepEqual(await companyNamesByIds(sb, []), {});
  assert.equal(sb.calls.length, 0);
});

test('companyNamesByIds throws on a read error so the caller can requeue', async () => {
  const sb = fakeCompaniesSb(null, { error: { message: 'boom' } });
  await assert.rejects(() => companyNamesByIds(sb, ['c1']), /boom/);
});

// ---- source-contract: the loop no longer does a per-order company read ----
const src = readFileSync(join(root, 'functions/api/qbo-sync.js'), 'utf8');

test('runQboSync batches the company lookup before the sync loop', () => {
  assert.match(src, /companyNamesByIds\(sb, uniqueCompanyIds\(orders\)\)/);
  assert.doesNotMatch(src, /companyNamesFor\(/, 'per-order companyNamesFor must be gone');
});
