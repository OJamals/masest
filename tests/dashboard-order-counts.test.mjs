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

test('auth.orders returns exact total and active-count envelopes', () => {
  const src = read('js/auth.js');
  assert.match(src, /export async function orders\(\{ limit, summary/);
  assert.match(src, /total: Number\(body\.total \|\| 0\)/);
  assert.match(src, /active_total: Number\(body\.active_total \|\| 0\)/);
  // The old bare-array return that discarded the total must be gone.
  assert.doesNotMatch(src, /return r\.ok \? \(await r\.json\(\)\)\.orders : \[\]/);
});

test('dashboard overview uses the true total and excludes terminal/refunded/cart from in-progress', () => {
  const src = read('js/dashboard.js');
  assert.match(src, /\['ph-package', totalOrders, 'Total orders'\]/);
  assert.match(src, /fetchOrders\(\{ limit: 5, summary: true \}\)/);
  assert.match(src, /const activeOrders = Number\.isFinite\(ordRes\.active_total\) \? ordRes\.active_total : 0/);
  assert.match(src, /\['ph-truck', activeOrders, 'In progress'\]/);
  assert.match(src, /renderOverviewActivity\(ord, notif, activeOrders\)/);
  // The headline figure must no longer be the size of the capped first page.
  assert.doesNotMatch(src, /\['ph-package', ord\.length, 'Total orders'\]/);
  assert.doesNotMatch(src, /const openOrders = ord\.filter/, "overview must not infer a company aggregate from one page");
  assert.doesNotMatch(src, /\.filter\(orderIsActive\)/);
});

test('account orders computes the active aggregate only for summary requests', () => {
  const src = read('functions/api/account/orders.js');
  assert.match(src, /searchParams\.get\('summary'\) === '1'/);
  assert.match(src, /count:\s*'exact',\s*head:\s*true/);
  assert.match(src, /active_total/);
});
