// Admin "Mark NET paid" affordance (#36 / #10): staff can settle an open NET balance
// directly from the orders tab, without a QuickBooks payment id. The backend action +
// credit gate already existed; this completes the missing admin UI button + handler.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('orders tab renders a Mark NET paid button, gated to open NET orders', () => {
  const orders = read('js/admin/orders.js');
  assert.match(orders, /data-mark-net-paid-order=/, 'order row should expose the mark-net-paid action');
  assert.match(orders, /Mark NET paid/, 'button should be labelled for staff');
  // Gated client-side to net_open so the button only shows where the server allows it.
  assert.match(orders, /order\.status === 'net_open' \? `[^`]*data-mark-net-paid-order/, 'button must be gated to net_open orders');
});

test('orders tab delegates the mark-net-paid action and confirms before settling', () => {
  const orders = read('js/admin/orders.js');
  assert.match(orders, /delegate\(box, 'click', '\[data-mark-net-paid-order\]'/, 'action must be delegated once on the container');
  assert.match(orders, /await confirmDialog\([^)]*Mark/, 'settling NET credit must confirm first');
  assert.match(orders, /action: 'mark_net_paid'/, 'must call the mark_net_paid endpoint action');
});

test('admin orders API settles NET via planNetSettlement behind the credit permission', () => {
  const operations = read('functions/_lib/staff-order-operations.js');
  assert.match(operations, /body\.action === 'mark_net_paid'/, 'Order operations handle the action');
  assert.match(operations, /staffCan\(role, 'company\.credit'\)/, 'gated by the company.credit permission');
  assert.match(operations, /planNetSettlement\(/, 'uses the shared settlement planner');
});

test('planNetSettlement only settles an open NET order', () => {
  const credit = read('functions/_lib/credit.js');
  assert.match(credit, /payment_method !== 'net'\) return \{ ok: false/, 'rejects non-NET orders');
  assert.match(credit, /status !== 'net_open'\) return \{ ok: false/, 'rejects orders that are not net_open');
  assert.match(credit, /status: 'net_paid' \}/, 'settles to net_paid');
});
