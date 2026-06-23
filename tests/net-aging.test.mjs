// #10 residual — NET aging/overdue surfacing in admin order view.
// Pure helper `netAging` computes days-outstanding + overdue bucket for an open
// NET order; admin orders endpoint attaches it; admin.js renders an aging badge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { netAging } from '../functions/_lib/credit.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86400000;
const NOW = Date.UTC(2026, 5, 22, 0, 0, 0); // 2026-06-22T00:00:00Z
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

test('non-NET orders have no aging', () => {
  assert.equal(netAging({ payment_method: 'stripe', status: 'paid', created_at: daysAgo(40) }, 30, NOW), null);
});

test('settled NET orders have no aging', () => {
  assert.equal(netAging({ payment_method: 'net', status: 'net_paid', created_at: daysAgo(40) }, 30, NOW), null);
});

test('null/missing order has no aging', () => {
  assert.equal(netAging(null, 30, NOW), null);
  assert.equal(netAging(undefined, 30, NOW), null);
});

test('invalid created_at has no aging', () => {
  assert.equal(netAging({ payment_method: 'net', status: 'net_open', created_at: 'not-a-date' }, 30, NOW), null);
});

test('open NET within terms is current, not overdue', () => {
  const a = netAging({ payment_method: 'net', status: 'net_open', created_at: daysAgo(10) }, 30, NOW);
  assert.equal(a.ageDays, 10);
  assert.equal(a.overdue, false);
  assert.equal(a.daysOverdue, 0);
  assert.equal(a.bucket, 'current');
  assert.equal(a.terms, 30);
});

test('open NET past terms is overdue with correct overdue days', () => {
  const a = netAging({ payment_method: 'net', status: 'net_open', created_at: daysAgo(45) }, 30, NOW);
  assert.equal(a.ageDays, 45);
  assert.equal(a.overdue, true);
  assert.equal(a.daysOverdue, 15);
  assert.equal(a.bucket, 'over30');
});

test('overdue buckets escalate by days past due (≤30 / ≤60 / >60)', () => {
  const t = 30;
  // daysOverdue = ageDays - terms
  assert.equal(netAging({ payment_method: 'net', status: 'net_open', created_at: daysAgo(45) }, t, NOW).bucket, 'over30'); // 15 past due
  assert.equal(netAging({ payment_method: 'net', status: 'net_open', created_at: daysAgo(75) }, t, NOW).bucket, 'over60'); // 45 past due
  assert.equal(netAging({ payment_method: 'net', status: 'net_open', created_at: daysAgo(130) }, t, NOW).bucket, 'over90'); // 100 past due
});

test('zero terms cannot be overdue (no meaningful due date) but still ages', () => {
  const a = netAging({ payment_method: 'net', status: 'net_open', created_at: daysAgo(20) }, 0, NOW);
  assert.equal(a.ageDays, 20);
  assert.equal(a.overdue, false);
  assert.equal(a.bucket, 'current');
});

test('missing/garbage terms treated as zero', () => {
  const a = netAging({ payment_method: 'net', status: 'net_open', created_at: daysAgo(20) }, null, NOW);
  assert.equal(a.terms, 0);
  assert.equal(a.overdue, false);
});

test('future-dated order clamps age to zero, never negative', () => {
  const a = netAging({ payment_method: 'net', status: 'net_open', created_at: daysAgo(-5) }, 30, NOW);
  assert.equal(a.ageDays, 0);
  assert.equal(a.daysOverdue, 0);
});

test('omitting nowMs falls back to current time without throwing', () => {
  const a = netAging({ payment_method: 'net', status: 'net_open', created_at: new Date().toISOString() }, 30);
  assert.ok(a && a.ageDays >= 0 && a.overdue === false);
});

// ---- source-contract wiring ----
test('admin orders endpoint selects net_terms_days and attaches net_aging', () => {
  const src = readFileSync(join(root, 'functions/api/admin/orders.js'), 'utf8');
  assert.match(src, /companies\(name,net_terms_days\)/, 'GET select must include net_terms_days');
  assert.match(src, /netAging/, 'must use the netAging helper');
  assert.match(src, /net_aging/, 'must attach a net_aging field per order');
});

test('admin.js renders a NET aging badge from net_aging', () => {
  const src = readFileSync(join(root, 'js/admin/orders.js'), 'utf8'); // netAgingBadge moved in #36
  assert.match(src, /net_aging/, 'order row must read net_aging');
  assert.match(src, /net-age/, 'must render a net-age badge element');
});
