// Account reorder + receipt (#19 batch 1): re-price a past order into a cart; receipt URL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { repriceCart } from '../functions/_lib/reorder.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- repriceCart ----
test('repriceCart returns current-priced lines for available items', () => {
  const items = [{ sku: 'VK-1', name: 'A', qty: 2, unit_price: 10 }];
  const { lines, issues } = repriceCart(items, { 'VK-1': { price: 12, active: true } });
  assert.deepEqual(lines, [{ sku: 'VK-1', name: 'A', qty: 2, unit_price: 12 }]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].reason, 'price_changed');
  assert.deepEqual([issues[0].was, issues[0].now], [10, 12]);
});

test('repriceCart drops unavailable / inactive / unpriced items with an issue', () => {
  const items = [
    { sku: 'GONE', name: 'X', qty: 1, unit_price: 5 },
    { sku: 'OFF', name: 'Y', qty: 1, unit_price: 5 },
    { sku: 'NOPRICE', name: 'Z', qty: 1, unit_price: 5 },
  ];
  const { lines, issues } = repriceCart(items, { OFF: { price: 9, active: false }, NOPRICE: { price: null, active: true } });
  assert.equal(lines.length, 0);
  assert.deepEqual(issues.map((i) => i.reason), ['unavailable', 'unavailable', 'unavailable']);
});

test('repriceCart keeps a steady-price line without flagging a change', () => {
  const { lines, issues } = repriceCart([{ sku: 'VK-1', name: 'A', qty: 3, unit_price: 8 }], { 'VK-1': { price: 8, active: true } });
  assert.deepEqual(lines, [{ sku: 'VK-1', name: 'A', qty: 3, unit_price: 8 }]);
  assert.equal(issues.length, 0);
});

test('repriceCart skips lines without a sku and tolerates empty input', () => {
  assert.deepEqual(repriceCart([{ name: 'no sku', qty: 1 }], {}), { lines: [], issues: [] });
  assert.deepEqual(repriceCart(null, {}), { lines: [], issues: [] });
});

// ---- endpoint wiring ----
test('account/order.js adds reorder (POST) + receipt (GET)', () => {
  const src = read('functions/api/account/order.js');
  assert.match(src, /onRequestPost/, 'must expose a reorder POST');
  assert.match(src, /repriceCart\(/, 'reorder must re-price via repriceCart');
  assert.match(src, /\.eq\('company_id', companyId\)/, 'must scope to the caller company');
  assert.match(src, /receipt/, 'GET must support a receipt lookup');
  assert.match(src, /receipt_url/, 'receipt response exposes receipt_url');
});

// ---- client wiring ----
test('dashboard reorder calls the endpoint and offers a receipt link', () => {
  const src = read('js/dashboard.js');
  assert.match(src, /\/api\/account\/order'?,?\s*\{\s*method:\s*'POST'/, 'reorder hits the POST endpoint');
  assert.match(src, /data-receipt/, 'orders expose a receipt control');
});
