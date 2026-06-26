import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/stripe-webhook.js', import.meta.url), 'utf8');

test('order confirmation passes a stable idempotency key (Stripe webhook retries)', () => {
  assert.match(src, /idempotencyKey: order\?\.id \? `order-confirm:\$\{order\.id\}`/);
  assert.match(src, /session\?\.id \? `order-confirm:\$\{session\.id\}` : null/);
});
