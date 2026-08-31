import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('buyer Orders opens the existing customer chat with order context', () => {
  const dashboard = read('js/dashboard.js');
  const chat = read('js/customer-chat.js');

  assert.match(dashboard, /Message about this order/);
  assert.match(dashboard, /masest:open-support-order/);
  assert.match(chat, /addEventListener\("masest:open-support-order"/);
  assert.match(chat, /order_id:\s*activeOrder\?\.id\s*\|\|\s*null/);
  assert.match(chat, /customer-chat__order-context/);
  assert.match(dashboard, /if \(activeMessageOrderId\) params\.set\('order_id', activeMessageOrderId\)/);
});

test('Admin Orders opens the canonical support console scoped to company and order', () => {
  const admin = read('js/admin.js');
  const orders = read('js/admin/orders.js');
  const support = read('js/admin-support.js');

  assert.match(orders, /Message customer/);
  assert.match(orders, /onMessageCustomer/);
  assert.match(admin, /onMessageCustomer:\s*\(\{\s*companyId,\s*orderId\s*\}\)/);
  assert.match(admin, /showSupportConsole\(\{\s*view:\s*"conversation",\s*companyId,\s*orderId\s*\}\)/);
  assert.match(support, /order_id:\s*activeOrderId/);
  assert.match(support, /Full company conversation/);
});

test('Admin Orders surfaces existing support request queue without a parallel message store', () => {
  const orders = read('js/admin/orders.js');

  assert.match(orders, /\/api\/admin\/orders\?view=requests&status=open/);
  assert.match(orders, /Open support requests/);
  assert.doesNotMatch(orders, /order_chat|order_messages/i);
});
