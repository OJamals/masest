import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const ADMIN_HTML = read('admin.html');
const ADMIN_ORDERS_API = read('functions/api/admin/orders.js');
const STAFF_ORDER_OPERATIONS = read('functions/_lib/staff-order-operations.js');
const ADMIN_ORDERS_UI = read('js/admin/orders.js');
const AUTHZ = read('functions/_lib/authz.js');
const ORDER_REVERSAL_SQL = read('supabase/schema-order-reversals.sql');

test('admin orders API can create manual orders with line items and audit', () => {
  assert.match(ADMIN_ORDERS_API, /runStaffOrderOperation/);
  assert.match(STAFF_ORDER_OPERATIONS, /body\?\.action === 'create_order'/);
  assert.match(STAFF_ORDER_OPERATIONS, /rpc\('create_manual_order_atomic'/);
  assert.match(ORDER_REVERSAL_SQL, /create or replace function public\.create_manual_order_atomic/i);
  assert.match(ORDER_REVERSAL_SQL, /create_manual_order_atomic[\s\S]*insert into public\.orders[\s\S]*insert into public\.order_items/i);
  assert.match(ORDER_REVERSAL_SQL, /manual_order_stock_unavailable/);
  assert.match(STAFF_ORDER_OPERATIONS, /action: 'order\.create'/);
  assert.match(STAFF_ORDER_OPERATIONS, /normalizeOrderItems\(/);
});

test('admin orders API can modify order metadata and replace line items', () => {
  assert.match(STAFF_ORDER_OPERATIONS, /body\?\.action === 'update_order'/);
  assert.match(STAFF_ORDER_OPERATIONS, /rpc\('update_draft_order_atomic'/);
  assert.match(ORDER_REVERSAL_SQL, /update_draft_order_atomic[\s\S]*for update/i);
  assert.match(ORDER_REVERSAL_SQL, /settled_order_lines_immutable/);
  assert.match(STAFF_ORDER_OPERATIONS, /action: 'order\.update'/);
});

test('admin orders API can remove orders behind an owner-only capability', () => {
  assert.match(AUTHZ, /"order\.delete": \["owner"\]/);
  assert.match(STAFF_ORDER_OPERATIONS, /body\?\.action === 'delete_order'/);
  assert.match(STAFF_ORDER_OPERATIONS, /staffCan\(role, 'order\.delete'\)/);
  assert.match(STAFF_ORDER_OPERATIONS, /rpc\('delete_draft_order_atomic'/);
  assert.match(ORDER_REVERSAL_SQL, /create or replace function public\.delete_draft_order_atomic/i);
  assert.match(ORDER_REVERSAL_SQL, /order_delete_forbidden/);
  assert.match(STAFF_ORDER_OPERATIONS, /action: 'order\.delete'/);
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
  // The edit form is rendered at runtime by js/admin/orders.js, so a check that reads only
  // admin.html never saw it: order *edit* kept a raw "Company ID" text box long after order
  // *creation* moved to search-and-select. Both forms now share one picker.
  assert.doesNotMatch(ADMIN_ORDERS_UI, /Company ID/, 'the edit form should not ask for a pasted company id either');
  assert.match(ADMIN_ORDERS_UI, /data-edit-company-search="\$\{id\}"/);
  assert.match(ADMIN_ORDERS_UI, /<select[^>]*data-edit-company="\$\{id\}"/, 'the edit business field is a select of real companies');
  assert.equal((ADMIN_ORDERS_UI.match(/function lookupCompanies\(/g) || []).length, 1, 'one lookup, not a copy per form');
  assert.match(ADMIN_ORDERS_UI, /lookupCompanies\(companySearch, companySelect/, 'the create form uses the shared lookup');
  assert.match(ADMIN_ORDERS_UI, /delegate\(box, 'input', '\[data-edit-company-search\]'/, 'edit pickers survive re-render via delegation');
  assert.doesNotMatch(ADMIN_ORDERS_UI, /lookupSeq/, 'the create form no longer carries its own copy of the lookup');
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
