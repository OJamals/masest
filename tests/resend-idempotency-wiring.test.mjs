import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/stripe-webhook.js', import.meta.url), 'utf8');

test('order confirmation passes a stable idempotency key (Stripe webhook retries)', () => {
  // Keyed per variant: 'order-received' (unsettled ACH) must not block the real
  // 'order-confirm' email once async_payment_succeeded lands.
  assert.match(src, /const keyPrefix = pending \? 'order-received' : 'order-confirm'/);
  assert.match(src, /idempotencyKey: order\?\.id \? `\$\{keyPrefix\}:\$\{order\.id\}`/);
  assert.match(src, /session\?\.id \? `\$\{keyPrefix\}:\$\{session\.id\}` : null/);
});
