import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/_lib/integration-effects.js', import.meta.url), 'utf8');

test('order confirmation passes a stable idempotency key (Stripe webhook retries)', () => {
  // Each pending/confirmed email has a distinct event/effect ledger key, and a replay
  // of that row sends the same provider idempotency key.
  assert.match(src, /return `\$\{effectRow\.provider\}\/\$\{effectRow\.provider_event_id\}\/\$\{effectRow\.effect_key\}`/);
  assert.match(src, /idempotencyKey:\s*effectIdempotencyKey\(effectRow\)/);
});
