import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const ADMIN_HTML = read('admin.html');
const ADMIN_ORDERS_API = read('functions/api/admin/orders.js');
const ADMIN_ORDERS_UI = read('js/admin/orders.js');
const AUTHZ = read('functions/_lib/authz.js');

test('admin orders API can create manual orders with line items and audit', () => {
  assert.match(ADMIN_ORDERS_API, /body\.action === 'create_order'/);
  assert.match(ADMIN_ORDERS_API, /from\('orders'\)[\s\S]{0,80}\.insert\(/);
  assert.match(ADMIN_ORDERS_API, /from\('order_items'\)[\s\S]{0,80}\.insert\(/);
  assert.match(ADMIN_ORDERS_API, /action: 'order\.create'/);
  assert.match(ADMIN_ORDERS_API, /normalizeOrderItems\(/);
});

test('admin orders API can modify order metadata and replace line items', () => {
  assert.match(ADMIN_ORDERS_API, /body\.action === 'update_order'/);
  assert.match(ADMIN_ORDERS_API, /from\('orders'\)\.update\(/);
  assert.match(ADMIN_ORDERS_API, /from\('order_items'\)\.delete\(\)\.eq\('order_id', body\.id\)/);
  assert.match(ADMIN_ORDERS_API, /action: 'order\.update'/);
});

test('admin orders API can remove orders behind an owner-only capability', () => {
  assert.match(AUTHZ, /"order\.delete": \["owner"\]/);
  assert.match(ADMIN_ORDERS_API, /body\.action === 'delete_order'/);
  assert.match(ADMIN_ORDERS_API, /staffCan\(role, 'order\.delete'\)/);
  assert.match(ADMIN_ORDERS_API, /from\('orders'\)\.delete\(\)\.eq\('id', body\.id\)/);
  assert.match(ADMIN_ORDERS_API, /action: 'order\.delete'/);
});

test('admin orders tab exposes create, edit, fulfillment, and remove controls', () => {
  assert.match(ADMIN_HTML, /id="ordCreateForm"/);
  assert.match(ADMIN_HTML, /id="ordCreateItems"/);
  assert.match(ADMIN_ORDERS_UI, /data-save-order-edit=/);
  assert.match(ADMIN_ORDERS_UI, /data-delete-order=/);
  assert.match(ADMIN_ORDERS_UI, /data-track-status/);
  assert.match(ADMIN_ORDERS_UI, /action:\s*'create_order'/);
  assert.match(ADMIN_ORDERS_UI, /action:\s*'update_order'/);
  assert.match(ADMIN_ORDERS_UI, /action:\s*'delete_order'/);
});

test('admin refund control only appears for real Stripe payment intents', () => {
  assert.match(ADMIN_ORDERS_UI, /order\.stripe_payment_intent/);
  assert.match(ADMIN_ORDERS_UI, /payment_method === 'stripe' && order\.stripe_payment_intent/);
});
