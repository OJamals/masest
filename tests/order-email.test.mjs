import assert from 'node:assert/strict';
import test from 'node:test';
import {
  money,
  orderItemsTableHtml,
  shipmentEmailCta,
  shipmentNotice,
  technicalDocumentRequestNoteHtml,
} from '../functions/_lib/order-email.js';

test('money formats currency uppercase with 2 decimals', () => {
  assert.equal(money(34.6, 'usd'), 'USD 34.60');
  assert.equal(money(null), 'USD 0.00');
});

test('orderItemsTableHtml renders a row per line with qty * unit_price', () => {
  const html = orderItemsTableHtml([
    { name: 'VertKleen HCR - 1 gal', sku: 'VK-HCR-1', qty: 2, unit_price: 17.3 },
  ], { currency: 'usd' });
  assert.match(html, /VertKleen HCR - 1 gal/);
  assert.match(html, /\(VK-HCR-1\)/);
  assert.match(html, /USD 34\.60/); // 2 * 17.30
  assert.match(html, /<th[^>]*>Product<\/th>/);
});

test('orderItemsTableHtml escapes line names', () => {
  const html = orderItemsTableHtml([{ name: '<script>x</script>', sku: 'A&B', qty: 1, unit_price: 1 }]);
  assert.ok(!html.includes('<script>x'), 'name is escaped');
  assert.match(html, /A&amp;B/);
});

test('orderItemsTableHtml omits totals rows that are not provided', () => {
  const onlyItems = orderItemsTableHtml([{ name: 'X', sku: 'Y', qty: 1, unit_price: 1 }], {});
  assert.ok(!/Subtotal|Total/.test(onlyItems), 'no totals table without values');
  const withTotals = orderItemsTableHtml([{ name: 'X', sku: 'Y', qty: 1, unit_price: 5 }], { subtotal: 5, total: 5 });
  assert.match(withTotals, /Subtotal/);
  assert.match(withTotals, /Total/);
  assert.ok(!/Tax/.test(withTotals), 'tax omitted when null (NET orders)');
});

test('order emails link public product files without access-gate copy', () => {
  const html = technicalDocumentRequestNoteHtml('https://masest.co/');
  assert.doesNotMatch(html, /request-only|register|sign in|request access/i);
  assert.match(html, /href="https:\/\/masest\.co\/resources"/);
  assert.match(html, /public product file/i);
});

test('packing notice does not claim a carrier label already exists', () => {
  const notice = shipmentNotice('packing');
  assert.equal(notice.label, 'packing');
  assert.doesNotMatch(notice.body, /label has been created/i);
  assert.match(notice.body, /prepared for shipment/i);
});

test('delivered notice works for guests without promising an account dashboard', () => {
  const notice = shipmentNotice('delivered');
  assert.doesNotMatch(notice.body, /dashboard/i);
  assert.match(notice.body, /short or damaged/i);
});

test('delivered email sends account buyers to orders and guests to products', () => {
  assert.deepEqual(
    shipmentEmailCta({ company_id: 'company-1' }, 'delivered', 'https://masest.co/'),
    { ctaText: 'View order & reorder', ctaUrl: 'https://masest.co/dashboard.html#orders' },
  );
  assert.deepEqual(
    shipmentEmailCta({ user_id: 'user-1' }, 'delivered', 'https://masest.co/'),
    { ctaText: 'View order & reorder', ctaUrl: 'https://masest.co/dashboard.html#orders' },
  );
  assert.deepEqual(
    shipmentEmailCta({}, 'delivered', 'https://masest.co/'),
    { ctaText: 'Shop VertKleen', ctaUrl: 'https://masest.co/products.html' },
  );
});
