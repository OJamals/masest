import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../js/admin/orders.js', import.meta.url), 'utf8');

test('orders tab reuses the saved-views helper with its own key', () => {
  assert.match(src, /import \{ createSavedViews \} from '\.\/saved-views\.js'/);
  assert.match(src, /createSavedViews\(\{\s*key: 'orders'/);
});

test('getFilters/applyFilters cover the order status + search inputs', () => {
  assert.match(src, /status: \$\('ordFilter'\)\?\.value \|\| ''/);
  assert.match(src, /search: \$\('ordSearch'\)\?\.value \|\| ''/);
  assert.match(src, /\$\('ordFilter'\)\.value = f\.status/);
  assert.match(src, /renderOrders\(\{ refetch: true \}\)/); // status is server-side
});

test('saved-views control mounts in the orders render path', () => {
  assert.match(src, /ensureSavedViews\(\)/);
  assert.match(src, /savedViews\.mount\(box\)/);
});
