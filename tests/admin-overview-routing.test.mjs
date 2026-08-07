import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const admin = read('js/admin.js');
const ordersApi = read('functions/api/admin/orders.js');
const ordersUi = read('js/admin/orders.js');
const html = read('admin.html');

test('every Overview metric routes into the workspace that owns the work', () => {
  // The four metric cards were plain text: "Fulfillment queue 23" was a dead end.
  const routes = [...admin.matchAll(/\{ tab: '([a-z-]+)'(?:, control: '(\w+)', value: '([\w-]+)')?[^}]*\}/g)];
  assert.ok(routes.length >= 18, `expected every metric row to carry a route, found ${routes.length}`);

  for (const [, tab] of routes) {
    assert.match(admin, new RegExp(`data-panel="${tab}"|'${tab}'`), `${tab} should be a real panel`);
  }
  // Filters that must match the number they came from.
  assert.match(admin, /\['Fulfillment queue'[^\]]*\{ tab: 'orders', control: 'ordFilter', value: 'needs_fulfillment' \}\]/);
  assert.match(admin, /\['NET exposure'[^\]]*\{ tab: 'orders', control: 'ordFilter', value: 'net_open' \}\]/);
  assert.match(admin, /\['New quotes'[^\]]*\{ tab: 'quotes', control: 'qFilter', value: 'new' \}\]/);
  assert.match(admin, /\['Urgent quotes'[^\]]*\{ tab: 'quotes', control: 'qPriority', value: 'urgent' \}\]/);
  assert.match(admin, /\['Quote follow-ups due'[^\]]*\{ tab: 'quotes', control: 'qDue', value: 'overdue' \}\]/);
});

test('metric rows render as links and are routed by a delegated handler', () => {
  assert.match(admin, /data-ops-route="\$\{esc\(JSON\.stringify\(route\)\)\}"/);
  assert.match(admin, /function routeOpsMetric\(route\)/);
  // Delegated: the Overview repaints on every visit and after refreshStats().
  assert.match(admin, /document\.addEventListener\('click', \(event\) => \{[\s\S]{0,220}data-ops-route/);
  assert.match(admin, /control\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
  assert.match(html, /a\.dash-row-route/);
});

test('the fulfillment queue filter selects the rows the Overview counts', () => {
  // A lifecycle view, not a status value: open, not yet delivered — the same
  // predicate as orderLifecycle().requires_fulfillment.
  assert.match(ordersApi, /const NEEDS_FULFILLMENT = 'needs_fulfillment'/);
  assert.match(ordersApi, /if \(status === NEEDS_FULFILLMENT\)/);
  assert.match(ordersApi, /\.not\('status', 'in', '\(cart,cancelled,refunded,pending_payment\)'\)/);
  assert.match(ordersApi, /\.or\('tracking_status\.is\.null,tracking_status\.neq\.delivered'\)/);
  // A plain status value must still take the exact-match path.
  assert.match(ordersApi, /else if \(status && ORDER_STATUSES\.includes\(status\)\) \{[\s\S]{0,80}\.eq\('status', status\)/);
  assert.match(ordersUi, /export const NEEDS_FULFILLMENT = 'needs_fulfillment'/);
  assert.match(admin, /<option value="\$\{NEEDS_FULFILLMENT\}">Needs fulfillment<\/option>/);
});

test('order rows stay scannable with the edit surface behind a disclosure', () => {
  // Each row used to render its whole edit surface inline: ~31 controls and
  // 476px per order, so a fulfillment queue was unscannable.
  assert.match(ordersUi, /<details class="adm-order-manage">/);
  assert.match(ordersUi, /<summary>[\s\S]{0,80}Manage order<\/summary>/);
  // Only the action that moves the row forward stays on the surface.
  assert.match(ordersUi, /const primaryAction = openStatus && !order\.accepted_at/);
  assert.match(ordersUi, /<div class="admin-order-primary">[\s\S]{0,200}data-order-detail[\s\S]{0,120}\$\{primaryAction\}/);
  // The heavy controls still exist — collapsed, not removed.
  for (const control of ['orderEditor(order)', 'trackingControls(order)', 'data-save-order', '${netControls}', '${refundControls}']) {
    assert.ok(ordersUi.includes(control), `${control} should remain inside the disclosure`);
  }
  assert.match(html, /\.adm-order-manage > summary/);
});
