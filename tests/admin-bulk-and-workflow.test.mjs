import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ordersApi = read('functions/api/admin/orders.js');
const ordersUi = read('js/admin/orders.js');
const reviewsApi = read('functions/api/admin/reviews.js');
const reviewsUi = read('js/admin/reviews.js');
const admin = read('js/admin.js');
const html = read('admin.html');

test('review moderation applies to a selection, not one row at a time', () => {
  // One code path serves both forms: `ids` when present, `id` as the single row.
  assert.match(reviewsApi, /const ids = \[\.\.\.new Set\(\(Array\.isArray\(body\.ids\) \? body\.ids : \[body\.id\]\)\.filter\(Boolean\)\)\]/);
  assert.match(reviewsApi, /\.in\('id', ids\)/);
  assert.match(reviewsApi, /json\(200, \{ ok: true, updated: \(data \|\| \[\]\)\.length \}\)/);
  assert.match(reviewsApi, /\.slice\(0, 200\)/, 'a selection must be bounded');

  assert.match(reviewsUi, /id="rvAll"/);
  assert.match(reviewsUi, /class="rv-check"/);
  assert.match(reviewsUi, /data-review-bulk="approve"/);
  assert.match(reviewsUi, /data-review-bulk="reject"/);
  assert.match(reviewsUi, /body: \{ action, ids \}/);
  // Single-row approve/reject must survive alongside the batch form.
  assert.match(reviewsUi, /\[data-review-approve\]/);
  assert.match(reviewsUi, /\[data-review-reject\]/);
});

test('orders bulk-accept is bounded, audited, and reports what it skipped', () => {
  assert.match(ordersApi, /if \(body\.action === 'accept_orders'\)/);
  assert.match(ordersApi, /staffCan\(role, 'order\.write'\)/);
  assert.match(ordersApi, /\.slice\(0, 200\)/);
  // Only orders that can move are touched; the rest are skipped, not failed.
  assert.match(ordersApi, /ACCEPTABLE_STATUSES\.has\(order\.status\) && !order\.accepted_at/);
  assert.match(ordersApi, /\.is\('accepted_at', null\)/, 'concurrent accepts must not double-stamp');
  assert.match(ordersApi, /action: 'order\.accept_bulk'/);
  assert.match(ordersApi, /accepted: acceptedIds\.length, skipped: ids\.length - acceptedIds\.length/);

  assert.match(ordersUi, /id="ordAll"/);
  assert.match(ordersUi, /class="ord-check"/);
  assert.match(ordersUi, /id="ordBulkAccept"/);
  assert.match(ordersUi, /action: 'accept_orders', ids/);
  assert.match(ordersUi, /skipped \(already accepted or closed\)/);
});

test('economic status moves require explicit per-order commands', () => {
  // Accept is safe to batch because it stamps ownership only. Economic status
  // changes remain per-order and cannot bypass refund/cancel/settlement commands.
  assert.doesNotMatch(ordersApi, /action === 'bulk_status'|action === 'update_orders'/);
  assert.match(ordersApi, /error: 'use_explicit_order_action'/);
  assert.match(ordersApi, /queueRefundCommand\(/);
  assert.match(ordersApi, /confirmCancellationCommand\(/);
  assert.doesNotMatch(ordersUi, /data-order-status=/);
});

test('manual order entry uses a business picker and structured line items', () => {
  assert.match(html, /id="ordCreateCompanySearch"/);
  assert.match(html, /<select id="ordCreateCompany"[^>]*>\s*<option value="">No business \(guest order\)<\/option>/);
  assert.match(html, /id="ordCreateLines"/);
  assert.match(html, /id="ordCreateAddLine"/);

  assert.match(ordersUi, /function orderLineRow\(item = \{\}\)/);
  assert.match(ordersUi, /function readLinesFrom\(container\)/);
  assert.match(ordersUi, /items: readLinesFrom\(\$\('ordCreateLines'\)\)/);
  for (const field of ['sku', 'product_sku', 'name', 'qty', 'unit_price', 'backordered']) {
    assert.match(ordersUi, new RegExp(`data-line="${field}"`), `line rows need a ${field} field`);
  }
  // Business lookup by name, with stale responses dropped.
  assert.match(ordersUi, /\/api\/admin\/companies\?search=\$\{encodeURIComponent\(term\)\}/);
  assert.match(ordersUi, /if \(token !== lookupSeq\) return/);
  // Totals derive from the lines so they cannot disagree with them.
  assert.match(ordersUi, /function refreshOrderCreateTotals\(\)/);
  assert.match(ordersUi, /subtotal \+ tax/);
  assert.doesNotMatch(html, /id="ordCreateSubtotal"[^>]*type="number"/, 'subtotal is derived, not typed');
});

test('the per-order editor shares the create form line-item contract', () => {
  // Both surfaces used to disagree: the create form took structured rows while
  // the editor still took a pipe-delimited blob.
  assert.match(ordersUi, /data-edit-lines="\$\{id\}"/);
  assert.match(ordersUi, /function orderLineRows\(order\)/);
  assert.match(ordersUi, /items: readLinesFrom\(pick\('lines'\)\)/);
  assert.match(ordersUi, /\[data-edit-add-line\]/);
  // The pipe-delimited parser and serializer are gone, not merely bypassed.
  assert.doesNotMatch(ordersUi, /parseOrderItemLines|orderItemsText/);
  assert.doesNotMatch(ordersUi, /data-edit-items=/, 'the editor textarea should be gone');
  assert.doesNotMatch(html, /data-edit-items|adm-order-lines"[^>]*placeholder="SKU/);
});

test('deep links clear the sticky staff chrome', () => {
  // scroll-padding-top:auto left anchor jumps (the #qbo deep link) underneath the
  // 59px sticky bar.
  assert.match(html, /html \{ scroll-padding-top: 75px; \}/);
});

test('the two newsletter send paths are separated by audience', () => {
  // Both sends are irreversible and reach different lists; only one composer is
  // on screen at a time.
  assert.match(html, /data-nl-view="campaigns"/);
  assert.match(html, /data-nl-view="announcements"/);
  assert.match(html, /id="admNewsletter" data-nl-panel="campaigns"/);
  assert.match(html, /data-nl-panel="announcements" hidden/);
  assert.match(html, /Goes to <b>customer accounts<\/b>[\s\S]{0,120}<b>not<\/b> to newsletter subscribers/);
  assert.match(admin, /wireSubViews\('nlToggle', 'nl'\)/);
});

test('panels that stack unrelated jobs split into named sub-views', () => {
  // Products held six jobs: catalog browse, add product, add variant, stock,
  // promo codes, tier pricing.
  for (const view of ['catalog', 'inventory', 'pricing']) {
    assert.match(html, new RegExp(`data-prod-view="${view}"`), `Products needs a ${view} view`);
    assert.match(html, new RegExp(`data-prod-panel="${view}"`), `Products needs a ${view} panel`);
  }
  assert.match(html, /data-prod-panel="inventory" hidden/);
  assert.match(html, /data-prod-panel="pricing" hidden/);
  assert.match(admin, /wireSubViews\('prodToggle', 'prod'\)/);

  // One generic toggle serves every panel that needs it.
  assert.match(admin, /function wireSubViews\(toggleId, key\)/);
  assert.match(admin, /panel\.hidden = panel\.getAttribute\(panelAttr\) !== view/);
  assert.match(admin, /tab\.setAttribute\('aria-pressed', String\(active\)\)/);
});
