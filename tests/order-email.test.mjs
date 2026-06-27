import assert from 'node:assert/strict';
import test from 'node:test';
import { orderItemsTableHtml, sdsNoteHtml, money } from '../functions/_lib/order-email.js';

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

test('sdsNoteHtml is empty for 0, singular for 1, plural for many', () => {
  assert.equal(sdsNoteHtml(0), '');
  assert.equal(sdsNoteHtml(null), '');
  assert.match(sdsNoteHtml(1), /Safety Data Sheet is attached/);
  assert.match(sdsNoteHtml(1), /the product you ordered/);
  assert.match(sdsNoteHtml(3), /Safety Data Sheets are attached/);
  assert.match(sdsNoteHtml(3), /the products you ordered/);
});
