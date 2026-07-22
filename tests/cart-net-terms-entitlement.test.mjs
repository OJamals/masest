import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cart = readFileSync(new URL('../cart.html', import.meta.url), 'utf8');

test('cart exposes NET checkout only from the account entitlement contract', () => {
  assert.match(cart, /const canUseNetTerms = data\.can_use_net_terms === true;/);
  assert.match(cart, /checkoutNet\.hidden = !canUseNetTerms;/);
  assert.doesNotMatch(cart, /checkoutNet\.hidden = !approved;/);
});

test('card checkout forwards an available buyer token without requiring authentication', () => {
  assert.match(cart, /let token = await getAuthToken\(\);\s+if \(mode === "net" && !token\)/);
  assert.doesNotMatch(cart, /if \(mode === "net"\) \{\s+token = await getAuthToken\(\);/);
});
