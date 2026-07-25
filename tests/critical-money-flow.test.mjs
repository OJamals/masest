// Critical money-flow integrity (issues #7, #8, #9).
//   #7 — Stripe webhook must not silently drop a paid order: a failed atomic persist
//        returns a retryable 5xx (so Stripe re-delivers) instead of a 200.
//   #8 — Duplicate orders: a unique guard on orders.stripe_payment_intent makes the
//        webhook idempotent under concurrent Stripe delivery (insert conflict -> 200).
//   #9 — Credit-limit race: NET orders are placed via the complete atomic locking RPC
//        (place_net_order_v3); missing v3 fails closed with no non-atomic fallback.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyOrderInsert, isUniqueViolation } from '../functions/api/stripe-webhook.js';
import { isMissingFunctionError } from '../functions/_lib/credit.js';

const WEBHOOK = readFileSync(new URL('../functions/api/stripe-webhook.js', import.meta.url), 'utf8');
const CHECKOUT = readFileSync(new URL('../functions/api/checkout.js', import.meta.url), 'utf8');
const SCHEMA = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const MIGRATION = readFileSync(new URL('../supabase/schema-order-integrity.sql', import.meta.url), 'utf8');

// ---- #8: classify the paid-order insert (pure, executed for real) ----
test('isUniqueViolation is true only for Postgres 23505', () => {
  assert.equal(isUniqueViolation({ code: '23505' }), true);
  assert.equal(isUniqueViolation({ code: '23503' }), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation(undefined), false);
});

test('classifyOrderInsert: no error -> ok', () => {
  assert.equal(classifyOrderInsert(null), 'ok');
  assert.equal(classifyOrderInsert(undefined), 'ok');
});

test('classifyOrderInsert: unique violation -> duplicate (idempotent under concurrent delivery)', () => {
  assert.equal(classifyOrderInsert({ code: '23505', message: 'duplicate key value' }), 'duplicate');
});

test('classifyOrderInsert: any other error -> error (retryable)', () => {
  assert.equal(classifyOrderInsert({ code: '08006', message: 'connection failure' }), 'error');
  assert.equal(classifyOrderInsert({ message: 'boom' }), 'error');
});

// ---- #7: webhook returns a retryable 5xx + no side effects on a failed persist ----
test('webhook captures the atomic persistence error (not just data)', () => {
  assert.match(WEBHOOK, /error:\s*persistErr/, 'must capture the RPC persistence error');
});

test('webhook classifies the insert outcome and returns a retryable 5xx on failure', () => {
  assert.match(WEBHOOK, /classifyOrderInsert\(\s*orderErr\s*\)/, 'must classify the insert outcome');
  assert.match(WEBHOOK, /return\s+json\(\s*5\d\d\s*,/, 'must return a 5xx so Stripe retries a failed persist');
});

test('webhook short-circuits 200 on a duplicate insert (concurrent delivery race)', () => {
  assert.match(WEBHOOK, /'duplicate'/, 'must handle the duplicate outcome as idempotent success');
});

// ---- #9: checkout uses the complete atomic locking RPC and fails closed ----
test('isMissingFunctionError is true only for undefined-function error codes', () => {
  assert.equal(isMissingFunctionError({ code: '42883' }), true);    // Postgres undefined_function
  assert.equal(isMissingFunctionError({ code: 'PGRST202' }), true); // PostgREST function-not-found
  assert.equal(isMissingFunctionError({ code: '23505' }), false);
  assert.equal(isMissingFunctionError(null), false);
  assert.equal(isMissingFunctionError(undefined), false);
});

test('checkout places NET orders via place_net_order_v3 only', () => {
  assert.match(CHECKOUT, /\.rpc\(\s*'place_net_order_v3'/, 'must call the complete ledger RPC');
  assert.doesNotMatch(CHECKOUT, /\.rpc\(\s*'place_net_order'/, 'must never call v1 from the Worker');
});

test('checkout has no app-side NET ledger mutation fallback', () => {
  assert.match(CHECKOUT, /isMissingFunctionError\(/, 'must detect a missing v3 RPC');
  assert.match(CHECKOUT, /net_order_unavailable/, 'missing v3 must fail closed');
  assert.doesNotMatch(CHECKOUT, /from\(['"]orders['"]\)\.insert/, 'Worker must not insert NET order headers');
  assert.doesNotMatch(CHECKOUT, /from\(['"]order_items['"]\)\.insert/, 'Worker must not insert NET order items');
  assert.doesNotMatch(CHECKOUT, /decrement_variant_stock/, 'Worker must not mutate NET stock');
});

test('checkout no longer leaks the raw order-insert error message', () => {
  assert.doesNotMatch(CHECKOUT, /error:\s*orderErr\.message/, 'must not return raw DB error text to the client');
});

// ---- #8/#9: migration artifact present and correct ----
test('migration adds a unique guard on orders.stripe_payment_intent', () => {
  assert.match(MIGRATION, /unique/i);
  assert.match(MIGRATION, /stripe_payment_intent/);
});

test('migration retains v1 and adds service-role-only place_net_order_v2', () => {
  assert.match(MIGRATION, /function\s+public\.place_net_order/i);
  assert.match(MIGRATION, /function\s+public\.place_net_order_v2/i);
  assert.match(MIGRATION, /security\s+definer/i);
  assert.match(MIGRATION, /grant\s+execute[\s\S]*place_net_order_v2[\s\S]*service_role/i, 'service_role must call v2');
});

test('order persistence carries shipping and optional PO references atomically', () => {
  assert.match(SCHEMA, /shipping\s+numeric\(12,2\)\s+not null default 0/i);
  assert.match(SCHEMA, /purchase_order_number\s+text/i);
  assert.match(MIGRATION, /add column if not exists shipping\s+numeric\(12,2\)\s+not null default 0/i);
  assert.match(MIGRATION, /add column if not exists purchase_order_number\s+text/i);
  assert.match(MIGRATION, /p_order->>'shipping'/i);
  assert.match(MIGRATION, /p_order->>'purchase_order_number'/i);
  assert.match(MIGRATION, /function\s+public\.place_net_order_v3[\s\S]*p_purchase_order_number\s+text/i);
  assert.match(MIGRATION, /set purchase_order_number\s*=\s*v_purchase_order_number/i);
});

test('place_net_order_v2 owns item persistence and stock mutation with deterministic locks', () => {
  assert.match(MIGRATION, /net_request_key/i, 'must persist a per-Company request key');
  assert.match(MIGRATION, /unique\s+index[\s\S]*company_id[\s\S]*net_request_key/i,
    'must enforce per-Company request-key uniqueness');
  assert.match(MIGRATION, /net_request_cart\s+jsonb/i, 'must retain the canonical cart for conflict detection');
  assert.match(MIGRATION, /jsonb_agg\([\s\S]*order\s+by\s+(?:btrim\()?item\.sku/i,
    'must canonicalize cart identity independent of input order');
  assert.match(MIGRATION, /array_agg\([\s\S]*order\s+by\s+(?:btrim\()?item\.sku/i,
    'must build sorted SKU lock order');
  assert.match(MIGRATION, /foreach\s+v_sku[\s\S]*for\s+update/i,
    'must lock each variant in sorted SKU order');
  assert.match(MIGRATION, /insert\s+into\s+public\.order_items/i, 'RPC must insert every order item');
  assert.match(MIGRATION, /update\s+public\.product_variants/i, 'RPC must own stock decrement');
});
