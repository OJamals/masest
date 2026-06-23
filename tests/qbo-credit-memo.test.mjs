import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCreditMemoPayload } from '../functions/_lib/qbo.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const order = { id: 'ord-1', tax: 5, customer_email: 'a@b.com' };
const items = [
  { sku: 'VK-1', name: 'A', qty: 2, unit_price: 10, line_total: 20 },
  { sku: 'VK-2', name: 'B', qty: 1, unit_price: 7, line_total: 7 },
];
const itemRefs = { 'VK-1': '101', 'VK-2': '102' };

test('full refund credit memo reverses every invoice line + carries tax', () => {
  const p = buildCreditMemoPayload({ order, items, customerRef: '9', itemRefs, amount: 27, fullyRefunded: true });
  assert.equal(p.CustomerRef.value, '9');
  assert.equal(p.Line.length, 2);
  assert.equal(p.Line[0].SalesItemLineDetail.ItemRef.value, '101');
  assert.equal(p.Line[0].Amount, 20);
  assert.equal(p.TxnTaxDetail.TotalTax, 5);
  assert.equal(p.BillEmail.Address, 'a@b.com');
});

test('partial refund posts a single dollar line, untaxed', () => {
  const p = buildCreditMemoPayload({ order, items, customerRef: '9', itemRefs, amount: 12.5, fullyRefunded: false });
  assert.equal(p.Line.length, 1);
  assert.equal(p.Line[0].Amount, 12.5);
  assert.equal(p.Line[0].SalesItemLineDetail.UnitPrice, 12.5);
  assert.equal(p.Line[0].SalesItemLineDetail.ItemRef.value, '101');
  assert.equal(p.TxnTaxDetail, undefined);
});

test('tax-exempt full refund forces non-taxable lines', () => {
  const p = buildCreditMemoPayload({ order, items, customerRef: '9', itemRefs, amount: 27, fullyRefunded: true, taxExempt: true });
  assert.equal(p.Line[0].SalesItemLineDetail.TaxCodeRef.value, 'NON');
});

test('partial refund with no resolvable item ref throws (not a silent zero credit)', () => {
  assert.throws(
    () => buildCreditMemoPayload({ order, items: [{ sku: 'X' }], customerRef: '9', itemRefs: {}, amount: 5, fullyRefunded: false }),
    /qbo_credit_memo_item_ref_missing/,
  );
});

test('refund credit memo is wired end to end', () => {
  const sync = read('functions/api/qbo-sync.js');
  assert.match(sync, /runQboRefundSync/);
  assert.match(sync, /claim_qbo_refunds/);
  assert.match(sync, /syncRefund/);
  const admin = read('functions/api/admin/orders.js');
  assert.match(admin, /qbo_refunds/);
  const migration = read('supabase/schema-qbo-refunds.sql');
  assert.match(migration, /create table if not exists public\.qbo_refunds/);
  assert.match(migration, /function public\.claim_qbo_refunds/);
});
