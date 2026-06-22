// #10 residual: a dedicated non-QBO "mark NET paid" affordance. The generic
// status-update path accepts net_paid but does not guard that the order is
// actually a NET order in the net_open state, and record_qbo_payment requires a
// QuickBooks payment id. planNetSettlement is the NET-guarded manual settlement
// planner; the orders.js mark_net_paid action wires it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planNetSettlement } from '../functions/_lib/credit.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- planNetSettlement: pure NET-settlement validation ----
test('planNetSettlement settles an open NET order', () => {
  const r = planNetSettlement({ payment_method: 'net', status: 'net_open' });
  assert.equal(r.ok, true);
  assert.equal(r.update.status, 'net_paid');
});

test('planNetSettlement rejects a non-NET order', () => {
  const r = planNetSettlement({ payment_method: 'card', status: 'paid' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_net');
});

test('planNetSettlement rejects an already-settled NET order', () => {
  const r = planNetSettlement({ payment_method: 'net', status: 'net_paid' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'already_settled');
});

test('planNetSettlement rejects a NET order that is not net_open', () => {
  for (const status of ['cart', 'pending_payment', 'cancelled', 'refunded']) {
    const r = planNetSettlement({ payment_method: 'net', status });
    assert.equal(r.ok, false, `status ${status} must not settle`);
    assert.equal(r.error, 'not_open');
  }
});

test('planNetSettlement rejects a missing order', () => {
  assert.equal(planNetSettlement(null).error, 'not_found');
});

test('planNetSettlement trims and caps a settlement reference, empty -> null', () => {
  assert.equal(planNetSettlement({ payment_method: 'net', status: 'net_open' }).reference, null);
  assert.equal(
    planNetSettlement({ payment_method: 'net', status: 'net_open' }, { reference: '  wire 8841  ' }).reference,
    'wire 8841',
  );
  assert.equal(
    planNetSettlement({ payment_method: 'net', status: 'net_open' }, { reference: 'x'.repeat(500) }).reference.length,
    200,
  );
});

test('planNetSettlement does not invent a qbo_payment_id for manual settlement', () => {
  const r = planNetSettlement({ payment_method: 'net', status: 'net_open' }, { reference: 'check 12' });
  assert.equal('qbo_payment_id' in r.update, false);
});

// ---- source contract: orders.js mark_net_paid action wiring ----
test('mark_net_paid action delegates to planNetSettlement and audits the settlement', () => {
  const src = read('functions/api/admin/orders.js');
  assert.match(src, /body\.action\s*===\s*['"]mark_net_paid['"]/, 'must expose a mark_net_paid action');
  assert.match(src, /planNetSettlement\(/, 'must delegate NET-settlement validation to the helper');
  assert.match(src, /order\.mark_net_paid/, 'must audit the manual settlement distinctly');
  assert.match(src, /payment received/, 'must notify the company the NET balance is settled');
});

test('mark_net_paid is finance-gated (settlement adjusts credit state)', () => {
  const src = read('functions/api/admin/orders.js');
  assert.match(
    src,
    /mark_net_paid['"]\s*\)\s*\{[\s\S]{0,200}?staffCan\(role,\s*['"]company\.credit['"]\)/,
    'manual NET settlement must require owner/finance via company.credit',
  );
});
