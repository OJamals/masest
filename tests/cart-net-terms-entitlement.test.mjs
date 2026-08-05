import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cart = readFileSync(new URL('../cart.html', import.meta.url), 'utf8');
const checkout = readFileSync(new URL('../js/checkout.js', import.meta.url), 'utf8');

test('cart defers payment decisions until verified delivery checkout', () => {
  assert.match(cart, /id="checkoutContinue"[^>]+href="checkout\.html"/);
  assert.doesNotMatch(cart, /id="checkoutPay"/);
  assert.doesNotMatch(cart, /id="checkoutNet"/);
});

test('card checkout forwards an available buyer token without requiring authentication', () => {
  assert.match(checkout, /state\.token = await getToken\(\)\.catch\(\(\) => null\)/);
  assert.match(checkout, /await checkout\(\{[\s\S]+token: state\.token/);
  assert.doesNotMatch(checkout, /if \(!state\.token\)[\s\S]{0,100}checkout/);
});
