import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const ADMIN_HTML = read('admin.html');
const ADMIN_ORDERS_API = read('functions/api/admin/orders.js');
const ADMIN_ORDERS_UI = read('js/admin/orders.js');
const AUTHZ = read('functions/_lib/authz.js');
const ORDER_REVERSAL_SQL = read('supabase/schema-order-reversals.sql');

test('admin orders API can create manual orders with line items and audit', () => {
  assert.match(ADMIN_ORDERS_API, /body\.action === 'create_order'/);
  assert.match(ADMIN_ORDERS_API, /rpc\('create_manual_order_atomic'/);
  assert.match(ORDER_REVERSAL_SQL, /create or replace function public\.create_manual_order_atomic/i);
  assert.match(ORDER_REVERSAL_SQL, /create_manual_order_atomic[\s\S]*insert into public\.orders[\s\S]*insert into public\.order_items/i);
  assert.match(ORDER_REVERSAL_SQL, /manual_order_stock_unavailable/);
  assert.match(ADMIN_ORDERS_API, /action: 'order\.create'/);
  assert.match(ADMIN_ORDERS_API, /normalizeOrderItems\(/);
});

test('admin orders API can modify order metadata and replace line items', () => {
  assert.match(ADMIN_ORDERS_API, /body\.action === 'update_order'/);
  assert.match(ADMIN_ORDERS_API, /rpc\('update_draft_order_atomic'/);
  assert.match(ORDER_REVERSAL_SQL, /update_draft_order_atomic[\s\S]*for update/i);
  assert.match(ORDER_REVERSAL_SQL, /settled_order_lines_immutable/);
  assert.match(ADMIN_ORDERS_API, /action: 'order\.update'/);
});

test('admin orders API can remove orders behind an owner-only capability', () => {
  assert.match(AUTHZ, /"order\.delete": \["owner"\]/);
  assert.match(ADMIN_ORDERS_API, /body\.action === 'delete_order'/);
  assert.match(ADMIN_ORDERS_API, /staffCan\(role, 'order\.delete'\)/);
  assert.match(ADMIN_ORDERS_API, /rpc\('delete_draft_order_atomic'/);
  assert.match(ORDER_REVERSAL_SQL, /create or replace function public\.delete_draft_order_atomic/i);
  assert.match(ORDER_REVERSAL_SQL, /order_delete_forbidden/);
  assert.match(ADMIN_ORDERS_API, /action: 'order\.delete'/);
});

test('admin orders tab exposes create, edit, fulfillment, and remove controls', () => {
  assert.match(ADMIN_HTML, /id="ordCreateForm"/);
  // Structured line-item rows replaced the pipe-delimited textarea, and the
  // business is picked by name rather than pasted as a raw id.
  assert.match(ADMIN_HTML, /id="ordCreateLines"/);
  assert.match(ADMIN_HTML, /id="ordCreateAddLine"/);
  assert.match(ADMIN_HTML, /id="ordCreateCompanySearch"/);
  assert.doesNotMatch(ADMIN_HTML, /id="ordCreateItems"/, 'the pipe-delimited line-item blob should be gone');
  assert.doesNotMatch(ADMIN_HTML, /Company ID/, 'staff should not be asked to paste a company id');
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
