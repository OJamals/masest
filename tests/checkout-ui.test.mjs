import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { groupServiceRates, shippingServiceLabel, uniqueServiceRates } from '../js/checkout.js';

const root = new URL('../', import.meta.url);
const checkout = readFileSync(new URL('checkout.html', root), 'utf8');
const cart = readFileSync(new URL('cart.html', root), 'utf8');
const checkoutSource = readFileSync(new URL('js/checkout.js', root), 'utf8');
const autocompleteSource = readFileSync(new URL('js/address-autocomplete.js', root), 'utf8');

test('checkout uses enclosed commerce chrome and a compact linear flow', () => {
  assert.match(checkout, /<body class="checkout-flow-page">/);
  assert.doesNotMatch(checkout, /src="js\/main\.js/);
  assert.match(checkout, /class="checkout-header"/);
  assert.match(checkout, /class="checkout-section"[^>]*aria-labelledby="shippingDetailsTitle"/);
  assert.match(checkout, /id="shippingDetailsTitle"[^>]*>[^<]*<span>1\.<\/span> Shipping details/);
  assert.doesNotMatch(checkout, /id="contactTitle"|id="shippingTitle"/);
  assert.match(checkout, /id="firstName"[^>]*autocomplete="shipping given-name"/);
  assert.match(checkout, /id="lastName"[^>]*autocomplete="shipping family-name"/);
  assert.doesNotMatch(checkout, /class="address-autocomplete"[^>]*aria-labelledby/);
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
  assert.match(autocompleteSource, /autocomplete\.description = ariaLabel/);
  assert.doesNotMatch(autocompleteSource, /autocomplete\.setAttribute\('aria-label'/);
  assert.doesNotMatch(autocompleteSource, /autocomplete\.setAttribute\('role'/);
  assert.match(checkoutSource, /showManualAddress/);
  assert.match(checkoutSource, /AddressLabel`\)\.htmlFor = result\.autocomplete\.id/);
});

test('checkout summary supports product imagery and progressive shipping totals', () => {
  assert.match(checkout, /class="checkout-summary"/);
  assert.match(checkoutSource, /imageUrl/);
  assert.match(checkoutSource, /checkout-line-media/);
  assert.match(checkout, /id="checkoutPay"[^>]*disabled/);
});

test('shipping choices keep the cheapest rate for each carrier service', () => {
  const rates = uniqueServiceRates([
    { carrier_name: 'USPS', service_type: 'Priority Mail', amount_minor: 1059, token: 'usps-high' },
    { carrier_name: 'UPS', service_type: 'Ground', amount_minor: 2515, token: 'ups-ground' },
    { carrier_name: 'USPS', service_type: 'Priority Mail', amount_minor: 962, token: 'usps-low' },
  ]);
  assert.deepEqual(rates.map(({ index, rate }) => [index, rate.amount_minor, rate.token]), [
    [2, 962, 'usps-low'], [1, 2515, 'ups-ground'],
  ]);
});

test('shipping choices prioritize three rates and keep remaining original tokens available', () => {
  const rates = Array.from({ length: 5 }, (_, index) => ({
    carrier_name: index % 2 ? 'UPS' : 'USPS',
    service_type: `Service ${index}`,
    amount_minor: 900 + index,
    token: `rate-${index}`,
  }));
  const groups = groupServiceRates(rates);
  assert.deepEqual(groups.recommended.map(({ index }) => index), [0, 1, 2]);
  assert.deepEqual(groups.additional.map(({ index }) => index), [3, 4]);
  assert.equal(groups.additional[0].rate.token, 'rate-3');
  assert.equal(shippingServiceLabel({ carrier_name: 'USPS', service_type: 'USPS Priority Mail' }), 'Priority Mail');
  assert.equal(shippingServiceLabel({ carrier_name: 'UPS', service_type: 'Ground' }), 'Ground');
});

test('audited cart and checkout states are compact and unambiguous', () => {
  assert.match(cart, /cart-line-media/);
  assert.match(checkoutSource, /Show .* more shipping methods/);
  assert.match(checkoutSource, /Recalculate rates/);
  assert.match(checkoutSource, /'shippingAutocomplete', 'billingAutocomplete'/);
  assert.match(checkoutSource, /Promise\.allSettled/);
  assert.match(checkoutSource, /if \(hadQuote\) renderTotals\(\)/);
  assert.doesNotMatch(checkout, /ph-circle-notch/);
  assert.doesNotMatch(checkoutSource, /ph-circle-notch/);
});

test('the requisition form stays collapsed but the quote route does not', () => {
  assert.match(cart, /<details class="cart-secondary-options"/);
  assert.match(cart, /Saved requisition/);
  // Bulk sizes (55 gal drums, 275 gal totes) are quote-routed and cannot be bought
  // online, so "Get formal quote" is the only path for a large share of buyers. It was
  // collapsed into the disclosure alongside the requisition form, which hid the primary
  // action for those buyers behind a closed <details> — it stays visible.
  const disclosure = cart.slice(cart.indexOf('<details class="cart-secondary-options"'));
  assert.doesNotMatch(disclosure, /Get formal quote/);
  assert.match(cart, /id="checkoutQuote"/);
});

// The address line-1 inputs are the only checkout controls that sit bare in
// .checkout-address-control instead of inside a .field, so they do not inherit the
// `width:100%` that .field input carries. Without an explicit width they collapse to the
// UA's default `size=20` — the longest field on the page rendering at ~183px inside a
// 624px column, on the manual-entry path. tools/cart-checkout-redirect.spec.mjs asserts
// the rendered width; this catches the rule being dropped without opening a browser.
test('bare address inputs declare their own width', () => {
  const style = readFileSync(new URL('css/style.css', root), 'utf8');
  const block = style.match(/\.checkout-address-control > input \{[^}]*\}/);
  assert.ok(block, '.checkout-address-control > input must be styled');
  assert.match(block[0], /width:\s*100%/, 'bare address inputs must fill their column');
});
