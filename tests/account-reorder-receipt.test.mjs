// Account reorder + receipt (#19 batch 1): re-price a past order into a cart; receipt URL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { repriceCart } from '../functions/_lib/reorder.js';
import { handleAccountOrderPost } from '../functions/api/account/order.js';

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
  assert.match(src, /safeUrl\(receipt_url\)/, 'receipt popup must sanitize returned URL');
  assert.match(src, /window\.open\(receiptUrl,/, 'receipt popup opens only sanitized URL variable');
});

test('reorder propagates a catalog read failure as retryable instead of unavailable items', async () => {
  const sb = {
    from(table) {
      if (table === 'orders') return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() {
          return { data: {
            id: 'order-1', user_id: 'buyer-1', status: 'paid',
            order_items: [{ sku: 'VK-1', name: 'VertKleen', qty: 1, unit_price: 25 }],
          }, error: null };
        },
      };
      if (table === 'product_variants') return {
        select() { return this; },
        async in() { return { data: null, error: { code: '08006' } }; },
      };
      throw new Error(`unexpected table ${table}`);
    },
  };
  const response = await handleAccountOrderPost({
    request: new Request('https://masest.test/api/account/order', {
      method: 'POST', body: JSON.stringify({ id: 'order-1' }),
    }),
    env: {},
  }, {
    requireCommerceUser: async () => ({ companyId: 'company-1', user: { id: 'buyer-1' }, sb }),
    readBody: async () => ({ id: 'order-1' }),
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'catalog_unavailable', retryable: true });
});

test('profileless retail reorder is authorized by the persisted Auth Buyer id', async () => {
  const filters = [];
  const orderQuery = {
    select() { return this; },
    eq(column, value) { filters.push([column, value]); return this; },
    async maybeSingle() {
      return {
        data: {
          id: 'order-1', user_id: 'buyer-1', status: 'paid',
          order_items: [{ sku: 'VK-1', name: 'VertKleen', qty: 1, unit_price: 25 }],
        },
        error: null,
      };
    },
  };
  const sb = {
    from(table) {
      if (table === 'orders') return orderQuery;
      if (table === 'product_variants') return {
        select() { return this; },
        async in() { return { data: [{ vsku: 'VK-1', price: 25, active: true }], error: null }; },
      };
      throw new Error(`unexpected table ${table}`);
    },
  };
  const response = await handleAccountOrderPost({
    request: new Request('https://masest.test/api/account/order', {
      method: 'POST', body: JSON.stringify({ id: 'order-1' }),
    }),
    env: {},
  }, {
    requireCommerceUser: async () => ({ companyId: null, user: { id: 'buyer-1' }, sb }),
    readBody: async () => ({ id: 'order-1' }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(filters, [['id', 'order-1'], ['user_id', 'buyer-1']]);
  assert.deepEqual(await response.json(), {
    lines: [{ sku: 'VK-1', name: 'VertKleen', qty: 1, unit_price: 25 }],
    issues: [],
  });
});
