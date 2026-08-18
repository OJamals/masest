import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('#39 qbo-sync invoice-ready notifications use link, not href', () => {
  const src = read('functions/api/qbo-sync.js');
  const notify = src.slice(src.indexOf('async function notifyInvoiceReady'));
  assert.match(notify, /link:\s*'\/dashboard\.html#orders'/);
  assert.doesNotMatch(notify, /href:\s*'\/dashboard\.html#orders'/);
});

test('#40 account address creation validates input and keeps country server-owned', () => {
  const src = read('functions/api/account/addresses.js');
  assert.doesNotMatch(src, /const\s+FIELDS\s*=/, 'client field allowlist must not include country');
  assert.match(src, /country:\s*'US'/, 'route must force US country');
  assert.match(src, /\^\[A-Z\]\{2\}\$/, 'state must be normalized and validated');
  assert.match(src, /\^\[0-9A-Z -\]\{3,20\}\$/, 'zip must be normalized and validated');
  assert.match(src, /input\.is_default\s*===\s*true/, 'is_default must be boolean-only');
});

test('#40 address default reset uses RPC and safe fallback ordering', () => {
  const src = read('functions/api/account/addresses.js');
  const schema = read('supabase/schema-account-addresses.sql');
  assert.match(src, /\.rpc\(\s*'create_company_address'/, 'route should prefer transactional RPC');
  assert.match(schema, /create or replace function public\.create_company_address/i);
  assert.match(schema, /set is_default = false[\s\S]*insert into public\.addresses/i, 'RPC should reset + insert in one DB transaction');
  assert.match(src, /insert\(row\)[\s\S]*update\(\{\s*is_default:\s*false\s*\}\)[\s\S]*\.neq\(\s*'id'\s*,\s*data\.id\s*\)/, 'fallback must insert before clearing other defaults');
});

test('#42 refunds have a distinct refunded order status', () => {
  const api = read('functions/api/admin/orders.js');
  const admin = read('js/admin/orders.js'); // Orders consts moved in #36
  const schema = read('supabase/schema.sql');
  const migration = read('supabase/schema-refunds.sql');
  const reversal = read('supabase/schema-order-reversals.sql');
  assert.match(api, /ORDER_STATUSES[\s\S]*'refunded'/);
  assert.match(api, /queueRefundCommand\(/, 'refund action must use the immutable reversal command');
  assert.match(reversal, /apply_order_reversal_complete_effect[\s\S]*status = 'refunded'/, 'completion must atomically mark a fully-refunded order refunded');
  assert.match(admin, /ORDER_STATUSES[\s\S]*'refunded'/, 'admin filter/status dropdown must include refunded');
  assert.match(admin, /REFUND_BLOCKING_STATUSES[\s\S]*'refunded'/, 'admin UI should hide refund action after refund');
  assert.match(schema, /order_status[\s\S]*'refunded'/);
  assert.match(migration, /alter type order_status add value if not exists 'refunded'/i);
});

test('#43 account routes preserve Company scope while profileless Buyers retain their own orders', () => {
  const notifications = read('functions/api/account/notifications.js');
  const orders = read('functions/api/account/orders.js');
  const order = read('functions/api/account/order.js');
  // Business-only notifications keep the 403 contract. Paid Order history and reorder also
  // support authenticated retail Buyers, scoped to their persisted Auth user id.
  const noCompanyContract = (src) => /requireCompany\(/.test(src) || /return json\(403,\s*\{\s*error:\s*'no_company'\s*\}\)/.test(src);
  assert.ok(noCompanyContract(notifications), 'notifications must enforce the no_company 403 contract');
  assert.match(orders, /requireCommerceUser\(request, env\)/);
  assert.match(order, /requireCommerceUser\(request, env\)/);
  assert.match(orders, /companyId\s*\?\s*ordersQuery\.eq\('company_id', companyId\)\s*:\s*ordersQuery\.eq\('user_id', user\.id\)/);
  assert.match(order, /companyId\s*\?\s*orderQuery\.eq\('company_id', companyId\)\s*:\s*orderQuery\.eq\('user_id', user\.id\)/);
  assert.match(orders, /const requisitionsQuery[\s\S]*\.eq\('user_id', user\.id\)/, 'saved requisitions must remain buyer-private');
  assert.match(orders, /order_items\(sku,product_sku,name,qty,unit_price,line_total\)/);
  assert.match(order, /order_items\(sku,product_sku,name,qty,unit_price,line_total\)/);
});
