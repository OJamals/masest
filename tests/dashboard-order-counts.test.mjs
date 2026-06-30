import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('account orders endpoint excludes never-placed cart rows (matches every sibling reader)', () => {
  const src = read('functions/api/account/orders.js');
  assert.match(src, /\.neq\('status', 'cart'\)/);
  assert.match(src, /count: 'exact'/);
});

test('auth.orders returns a count envelope, not just the first page', () => {
  const src = read('js/auth.js');
  assert.match(src, /export async function orders\(\{ limit \} = \{\}\)/);
  assert.match(src, /total: Number\(body\.total \|\| 0\)/);
  // The old bare-array return that discarded the total must be gone.
  assert.doesNotMatch(src, /return r\.ok \? \(await r\.json\(\)\)\.orders : \[\]/);
});

test('dashboard overview uses the true total and excludes terminal/refunded/cart from in-progress', () => {
  const src = read('js/dashboard.js');
  assert.match(src, /const TERMINAL_ORDER_STATES = \[[^\]]*'refunded'[^\]]*'cart'[^\]]*\]/);
  assert.match(src, /\['ph-package', totalOrders, 'Total orders'\]/);
  assert.match(src, /fetchOrders\(\{ limit: 100 \}\)/);
  // The headline figure must no longer be the size of the capped first page.
  assert.doesNotMatch(src, /\['ph-package', ord\.length, 'Total orders'\]/);
  // Both in-progress filters route through the shared terminal-state set.
  assert.doesNotMatch(src, /!\['fulfilled', 'cancelled', 'net_paid'\]\.includes/);
});
