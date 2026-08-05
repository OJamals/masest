import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { uniqueServiceRates } from '../js/checkout.js';

const root = new URL('../', import.meta.url);
const checkout = readFileSync(new URL('checkout.html', root), 'utf8');
const cart = readFileSync(new URL('cart.html', root), 'utf8');
const checkoutSource = readFileSync(new URL('js/checkout.js', root), 'utf8');
const autocompleteSource = readFileSync(new URL('js/address-autocomplete.js', root), 'utf8');

test('checkout uses enclosed commerce chrome and a compact linear flow', () => {
  assert.match(checkout, /<body class="checkout-flow-page">/);
  assert.doesNotMatch(checkout, /src="js\/main\.js/);
  assert.match(checkout, /class="checkout-header"/);
  assert.match(checkout, /class="checkout-section"[^>]*aria-labelledby="contactTitle"/);
  assert.match(checkout, /class="checkout-section"[^>]*aria-labelledby="shippingTitle"/);
  assert.match(checkout, /id="businessOptions"/);
  assert.match(checkout, /id="poToggle"/);
  assert.match(checkout, /id="purchaseOrderField"[^>]*hidden/);
});

test('Google autocomplete owns the visible address line with manual fallback', () => {
  assert.match(checkout, /id="shippingAddressControl"/);
  assert.match(checkout, /id="shippingAutocomplete"/);
  assert.match(checkout, /id="shippingAddress1"[^>]*hidden/);
  assert.match(checkout, /id="shippingManualToggle"/);
  assert.match(checkout, /id="shippingAddressDetails"[^>]*hidden/);
  assert.match(checkout, /id="shippingSuiteToggle"/);
  assert.match(autocompleteSource, /onSelect/);
  assert.match(autocompleteSource, /autocomplete\.id = `\$\{mount\.id\}Input`/);
  assert.match(autocompleteSource, /autocomplete\.setAttribute\('name', mount\.id\)/);
  assert.match(checkoutSource, /showManualAddress/);
});

test('checkout summary supports product imagery and progressive shipping totals', () => {
  assert.match(checkout, /class="checkout-summary"/);
  assert.match(checkoutSource, /imageUrl/);
  assert.match(checkoutSource, /checkout-line-media/);
  assert.match(checkout, /id="checkoutPay"[^>]*disabled/);
});

test('shipping choices keep the cheapest rate for each carrier service', () => {
  const rates = uniqueServiceRates([
    { carrier_name: 'USPS', service_type: 'Priority Mail', amount_minor: 962 },
    { carrier_name: 'USPS', service_type: 'Priority Mail', amount_minor: 1059 },
    { carrier_name: 'UPS', service_type: 'Ground', amount_minor: 2515 },
  ]);
  assert.deepEqual(rates.map(({ index, rate }) => [index, rate.amount_minor]), [[0, 962], [2, 2515]]);
});

test('secondary cart actions stay collapsed behind one compact disclosure', () => {
  assert.match(cart, /<details class="cart-secondary-options"/);
  assert.match(cart, /Formal quote and saved requisition/);
});
