// Admin partial refunds (#22): `amount` param, cumulative refunded_amount tracking,
// status flips to 'refunded' only when fully refunded, stock re-increment on full refund.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { computeRefund } from '../functions/_lib/refund.js';
import { stockIncrements } from '../functions/_lib/order-shape.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- computeRefund: pure refund math ----
test('computeRefund refunds the full remaining balance by default', () => {
  const r = computeRefund({ total: 100, refundedAmount: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.amount, 100);
  assert.equal(r.amountCents, 10000);
  assert.equal(r.newRefundedAmount, 100);
  assert.equal(r.fullyRefunded, true);
});

test('computeRefund honors a partial amount and stays not-fully-refunded', () => {
  const r = computeRefund({ total: 100, refundedAmount: 0, requestedAmount: 30 });
  assert.equal(r.amount, 30);
  assert.equal(r.amountCents, 3000);
  assert.equal(r.newRefundedAmount, 30);
  assert.equal(r.fullyRefunded, false);
});

test('computeRefund accumulates prior partials and flips full at the total', () => {
  const r = computeRefund({ total: 100, refundedAmount: 70, requestedAmount: 30 });
  assert.equal(r.newRefundedAmount, 100);
  assert.equal(r.fullyRefunded, true);
});

test('computeRefund default after a partial refunds only the remainder', () => {
  const r = computeRefund({ total: 100, refundedAmount: 40 });
  assert.equal(r.amount, 60);
  assert.equal(r.newRefundedAmount, 100);
  assert.equal(r.fullyRefunded, true);
});

test('computeRefund rejects an amount over the remaining balance', () => {
  const r = computeRefund({ total: 100, refundedAmount: 80, requestedAmount: 30 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'amount_exceeds_remaining');
});

test('computeRefund rejects zero/negative/non-numeric amounts', () => {
  assert.equal(computeRefund({ total: 100, requestedAmount: 0 }).error, 'invalid_amount');
  assert.equal(computeRefund({ total: 100, requestedAmount: -5 }).error, 'invalid_amount');
  assert.equal(computeRefund({ total: 100, requestedAmount: 'x' }).error, 'invalid_amount');
});

test('computeRefund rejects when nothing remains', () => {
  const r = computeRefund({ total: 100, refundedAmount: 100 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'already_refunded');
});

test('computeRefund rejects an invalid total', () => {
  assert.equal(computeRefund({ total: 0 }).error, 'invalid_total');
  assert.equal(computeRefund({ total: 'x' }).error, 'invalid_total');
});

test('computeRefund converts dollars to cents without float drift', () => {
  assert.equal(computeRefund({ total: 19.99 }).amountCents, 1999);
  assert.equal(computeRefund({ total: 100, requestedAmount: 33.33 }).amountCents, 3333);
});

// ---- stockIncrements: RPC arg builder (mirror of stockDecrements) ----
test('stockIncrements builds RPC args only for lines with a sku', () => {
  const args = stockIncrements([{ sku: 'VK-1', qty: 2 }, { qty: 5 }, { sku: 'VK-2', qty: 1 }]);
  assert.deepEqual(args, [{ p_vsku: 'VK-1', p_qty: 2 }, { p_vsku: 'VK-2', p_qty: 1 }]);
});

test('stockIncrements tolerates null/empty input', () => {
  assert.deepEqual(stockIncrements(null), []);
  assert.deepEqual(stockIncrements([]), []);
});

// ---- source contract: orders.js refund action wiring ----
test('refund action accepts amount + uses computeRefund + audits partial', () => {
  const src = read('functions/api/admin/orders.js');
  assert.match(src, /computeRefund\(/, 'must delegate refund math to computeRefund');
  assert.match(src, /amount:\s*plan\.amountCents/, 'must pass the cents amount to Stripe');
  assert.match(src, /order\.refund_partial/, 'must audit partial refunds distinctly');
  assert.match(src, /increment_variant_stock/, 'must re-increment stock on full refund');
  assert.match(src, /refunded_amount:\s*plan\.newRefundedAmount/, 'must persist cumulative refunded_amount');
});

// ---- migration ----
test('schema-refunds.sql adds refunded_amount + increment_variant_stock', () => {
  const sql = read('supabase/schema-refunds.sql');
  assert.match(sql, /add column if not exists refunded_amount/i);
  assert.match(sql, /create or replace function public\.increment_variant_stock/i);
  assert.match(sql, /grant execute on function public\.increment_variant_stock/i);
});

// ---- admin UI sends a refund amount ----
test('admin refund control exposes an amount field', () => {
  const src = read('js/admin.js');
  assert.match(src, /data-refund-amount/, 'refund UI must let staff enter a partial amount');
});
