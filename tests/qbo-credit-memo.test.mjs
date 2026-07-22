import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCreditMemoPayload, syncRefund } from '../functions/_lib/qbo.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const order = { id: 'ord-1', tax: 5, customer_email: 'a@b.com' };
const items = [
  { sku: 'VK-1', name: 'A', qty: 2, unit_price: 10, line_total: 20 },
  { sku: 'VK-2', name: 'B', qty: 1, unit_price: 7, line_total: 7 },
];
const itemRefs = { 'VK-1': '101', 'VK-2': '102' };

function makeTable(store, table) {
  const state = { field: null, value: null };
  return {
    select() { return this; },
    eq(field, value) { state.field = field; state.value = value; return this; },
    async maybeSingle() {
      const rows = Object.values(store[table]);
      const found = rows.find((row) => row[state.field] === state.value);
      return { data: found || null, error: null };
    },
    async insert(row) {
      store[table][row.sku || row.key || row.id] = row;
      return { data: row, error: null };
    },
  };
}

function fakeSb(seed = {}) {
  const store = {
    qbo_customers: { ...(seed.qbo_customers || {}) },
    qbo_items: { ...(seed.qbo_items || {}) },
  };
  return { from(table) { return makeTable(store, table); } };
}

function qboJson(body, intuitTid) {
  return {
    ok: true,
    headers: intuitTid ? new Headers({ intuit_tid: intuitTid }) : undefined,
    async json() { return body; },
  };
}

test('full refund credit memo reverses every invoice line + carries tax', () => {
  const p = buildCreditMemoPayload({ order, items, customerRef: '9', itemRefs, amount: 27, fullyRefunded: true });
  assert.equal(p.CustomerRef.value, '9');
  assert.equal(p.Line.length, 2);
  assert.equal(p.Line[0].SalesItemLineDetail.ItemRef.value, '101');
  assert.equal(p.Line[0].Amount, 20);
  assert.equal(p.TxnTaxDetail.TotalTax, 5);
  assert.equal(p.BillEmail.Address, 'a@b.com');
});

test('full refund credit memo reverses the original Stripe discount', () => {
  const discountedOrder = { ...order, tax: 0, total: 3.85 };
  const discountedItems = [
    { sku: 'VK-1', name: 'A', qty: 1, unit_price: 19.27, line_total: 19.27 },
  ];
  const p = buildCreditMemoPayload({
    order: discountedOrder,
    items: discountedItems,
    customerRef: '9',
    itemRefs,
    amount: 3.85,
    fullyRefunded: true,
  });

  assert.equal(p.Line.length, 2);
  assert.equal(p.Line[1].DetailType, 'DiscountLineDetail');
  assert.equal(p.Line[1].Amount, 15.42);
  assert.equal(Number((p.Line[0].Amount - p.Line[1].Amount).toFixed(2)), 3.85);
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

test('syncRefund captures Intuit transaction ids from CreditMemo responses', async () => {
  const sb = fakeSb({
    qbo_customers: { 'company:c1': { key: 'company:c1', qbo_customer_id: '55' } },
    qbo_items: {
      'VK-1': { sku: 'VK-1', qbo_item_id: '101' },
      'VK-2': { sku: 'VK-2', qbo_item_id: '102' },
    },
  });
  const result = await syncRefund(
    sb,
    {},
    'tok',
    'realm',
    { id: 'refund-1', amount: 27, fully_refunded: true },
    { ...order, company_id: 'c1', payment_method: 'stripe' },
    items,
    { c1: 'Acme' },
    {
      fetchImpl: async (url) => {
        const decoded = decodeURIComponent(String(url));
        if (decoded.includes('from CreditMemo')) return qboJson({ QueryResponse: {} }, 'tid_cm_query');
        if (url.includes('/creditmemo?')) return qboJson({ CreditMemo: { Id: 'cm-900' } }, 'tid_cm_create');
        throw new Error(`unexpected QBO request: ${url}`);
      },
    },
  );

  assert.equal(result.creditMemoId, 'cm-900');
  assert.equal(result.intuitTid, 'tid_cm_create');
  assert.deepEqual(result.intuitTids.map((entry) => entry.intuit_tid), ['tid_cm_query', 'tid_cm_create']);
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
  assert.match(migration, /stripe_refund_id\s+text/);
  assert.match(migration, /qbo_refunds_stripe_refund_id_uniq/);
  assert.match(migration, /function public\.claim_qbo_refunds/);
});
