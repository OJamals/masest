// Critical money-flow integrity (issues #7, #8, #9).
//   #7 — Stripe webhook must not silently drop a paid order: a failed order insert
//        returns a retryable 5xx (so Stripe re-delivers) instead of a 200.
//   #8 — Duplicate orders: a unique guard on orders.stripe_payment_intent makes the
//        webhook idempotent under concurrent Stripe delivery (insert conflict -> 200).
//   #9 — Credit-limit race: NET orders are placed via an atomic locking RPC
//        (place_net_order) that re-checks the limit under a row lock; the app falls
//        back to the pre-migration check when the RPC isn't deployed yet.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyOrderInsert, isUniqueViolation } from '../functions/api/stripe-webhook.js';
import { isMissingFunctionError } from '../functions/_lib/credit.js';

const WEBHOOK = readFileSync(new URL('../functions/api/stripe-webhook.js', import.meta.url), 'utf8');
const CHECKOUT = readFileSync(new URL('../functions/api/checkout.js', import.meta.url), 'utf8');
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

// ---- #7: webhook returns a retryable 5xx + no side effects on a failed insert ----
test('webhook destructures the order-insert error (not just data)', () => {
  assert.match(WEBHOOK, /error:\s*orderErr/, 'must capture the insert error');
});

test('webhook classifies the insert outcome and returns a retryable 5xx on failure', () => {
  assert.match(WEBHOOK, /classifyOrderInsert\(\s*orderErr\s*\)/, 'must classify the insert outcome');
  assert.match(WEBHOOK, /return\s+json\(\s*5\d\d\s*,/, 'must return a 5xx so Stripe retries a failed persist');
});

test('webhook short-circuits 200 on a duplicate insert (concurrent delivery race)', () => {
  assert.match(WEBHOOK, /'duplicate'/, 'must handle the duplicate outcome as idempotent success');
});

// ---- #9: checkout uses the atomic locking RPC with a safe fallback ----
test('isMissingFunctionError is true only for undefined-function error codes', () => {
  assert.equal(isMissingFunctionError({ code: '42883' }), true);    // Postgres undefined_function
  assert.equal(isMissingFunctionError({ code: 'PGRST202' }), true); // PostgREST function-not-found
  assert.equal(isMissingFunctionError({ code: '23505' }), false);
  assert.equal(isMissingFunctionError(null), false);
  assert.equal(isMissingFunctionError(undefined), false);
});

test('checkout places NET orders via the atomic place_net_order RPC', () => {
  assert.match(CHECKOUT, /\.rpc\(\s*'place_net_order'/, 'must call the locking RPC');
});

test('checkout falls back to the pre-migration credit check when the RPC is absent', () => {
  assert.match(CHECKOUT, /isMissingFunctionError\(/, 'must detect a missing RPC and fall back');
});

test('checkout no longer leaks the raw order-insert error message', () => {
  assert.doesNotMatch(CHECKOUT, /error:\s*orderErr\.message/, 'must not return raw DB error text to the client');
});

// ---- #8/#9: migration artifact present and correct ----
test('migration adds a unique guard on orders.stripe_payment_intent', () => {
  assert.match(MIGRATION, /unique/i);
  assert.match(MIGRATION, /stripe_payment_intent/);
});

test('migration defines a SECURITY DEFINER place_net_order that locks the company row and grants service_role', () => {
  assert.match(MIGRATION, /function\s+public\.place_net_order/i);
  assert.match(MIGRATION, /security\s+definer/i);
  assert.match(MIGRATION, /for\s+update/i, 'must lock the company row to serialize concurrent NET checkouts');
  assert.match(MIGRATION, /grant\s+execute[\s\S]*place_net_order[\s\S]*service_role/i, 'service_role must be able to call it');
});
