import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allocateStoreCredit,
  normalizeStoreCreditAdjustment,
  normalizeStoreCreditIntentId,
  reserveCompanyStoreCredit,
} from '../functions/_lib/store-credit.js';

test('store credit allocation is exact, deterministic, and never makes a negative unit price', () => {
  const result = allocateStoreCredit(
    [
      { sku: 'A', name: 'A', price: 10, currency: 'usd' },
      { sku: 'B', name: 'B', price: 2.5, currency: 'usd' },
    ],
    { A: 3, B: 2 },
    3201,
  );

  assert.equal(result.subtotalMinor, 3500);
  assert.equal(result.amountMinor, 3201);
  assert.deepEqual(
    result.lines.map(({ product, quantity, unitAmountMinor }) => ({ sku: product.sku, quantity, unitAmountMinor })),
    [
      { sku: 'A', quantity: 3, unitAmountMinor: 0 },
      { sku: 'B', quantity: 1, unitAmountMinor: 149 },
      { sku: 'B', quantity: 1, unitAmountMinor: 150 },
    ],
  );
  assert.equal(
    result.lines.reduce((sum, line) => sum + line.quantity * line.unitAmountMinor, 0),
    result.subtotalMinor - result.amountMinor,
  );
  assert.ok(result.lines.every((line) => line.unitAmountMinor >= 0));
});

test('allocation caps account credit at merchandise subtotal', () => {
  const result = allocateStoreCredit(
    [{ sku: 'A', name: 'A', price: 1.25, currency: 'usd' }],
    { A: 2 },
    99999,
  );
  assert.equal(result.amountMinor, 250);
  assert.deepEqual(result.lines.map((line) => line.unitAmountMinor), [0]);
});

test('staff adjustment accepts exact signed USD amounts only', () => {
  assert.deepEqual(normalizeStoreCreditAdjustment('25.50'), { value: 2550 });
  assert.deepEqual(normalizeStoreCreditAdjustment('-10'), { value: -1000 });
  for (const value of ['', '0', '0.001', '1,000', '1000000.01', Infinity]) {
    assert.deepEqual(normalizeStoreCreditAdjustment(value), { error: 'invalid_store_credit_adjustment' });
  }
});

test('checkout intent identity must be a UUID', () => {
  assert.equal(normalizeStoreCreditIntentId('17d1f696-4296-4f8f-8cbb-a6c111ae8fb6'), '17d1f696-4296-4f8f-8cbb-a6c111ae8fb6');
  assert.equal(normalizeStoreCreditIntentId('not-an-id'), '');
});

test('reservation forwards the exact Checkout expiry to the ledger', async () => {
  let captured;
  const result = await reserveCompanyStoreCredit({
    async rpc(name, args) {
      captured = { name, args };
      return { data: { id: 'reservation', amount_minor: 500 } };
    },
  }, {
    companyId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    intentId: '33333333-3333-4333-8333-333333333333',
    maxAmountMinor: 500,
    expiresAt: '2026-08-20T12:35:00.000Z',
  });
  assert.equal(result.id, 'reservation');
  assert.equal(captured.name, 'reserve_company_store_credit');
  assert.equal(captured.args.p_expires_at, '2026-08-20T12:35:00.000Z');
});
