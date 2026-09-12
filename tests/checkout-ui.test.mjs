import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { groupServiceRates, needsSuiteNumber, shippingServiceLabel, uniqueServiceRates } from '../js/checkout.js';

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
  assert.match(cart, /Save this cart/);
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

test('an address that needs a unit number names the field instead of blaming the street', () => {
  // Google answers a recognised building with no unit as address_not_deliverable plus
  // possible_next_action CONFIRM_ADD_SUBPREMISES. The generic copy sent the buyer back
  // over a street, city and ZIP that were all correct, past a collapsed "Add apartment
  // or suite" control sitting on the same form.
  assert.equal(needsSuiteNumber({ data: { error: 'address_not_deliverable', possible_next_action: 'CONFIRM_ADD_SUBPREMISES' } }), true);
  assert.equal(needsSuiteNumber({ data: { error: 'address_not_deliverable', possible_next_action: 'FIX' } }), false);
  assert.equal(needsSuiteNumber({ data: { error: 'shipping_rates_timeout' } }), false);
  assert.equal(needsSuiteNumber(undefined), false);

  assert.match(checkoutSource, /apartment, suite, or unit number\. Add it below and calculate again\./);
  // The message alone is not enough: the field it names is collapsed behind a button.
  assert.match(checkoutSource, /if \(needsSuiteNumber\(error\)\) setSuiteOpen\('shipping', true\);/);
  // setSuiteOpen is idempotent so an already-open field is never toggled shut.
  assert.match(checkoutSource, /function setSuiteOpen\(prefix, open, focus = true\)/);
});

test('a street no carrier can find reads as a street problem, not as unavailable shipping', () => {
  assert.match(checkoutSource, /shipping_address_unverified: 'No carrier could find that street address\./);
  assert.match(checkoutSource, /shipping_rates_unavailable: 'No shipping option is available for this address and cart\.'/);
});

test('the rate wait reports progress instead of holding one sentence for five seconds', () => {
  // Measured against production: 4.8-5.4s click to rates, of which Google validation is
  // 141-325ms and the carrier list 1.2-1.6s. One unchanging sentence for that long reads
  // as a hang.
  assert.match(checkoutSource, /showStatus\('Verifying the delivery address\.'\);/);
  assert.match(checkoutSource, /showStatus\('Comparing live carrier rates\. This usually takes a few seconds\.'\);/);
  // The second line must not claim the address passed — only the response knows that.
  assert.doesNotMatch(checkoutSource, /Address verified\. Comparing/);

  // A response that lands before the stage fires must not be overwritten by it, so the
  // timer is cleared on the success path, on the error path, and as a backstop.
  const submit = checkoutSource.slice(checkoutSource.indexOf("form.addEventListener('submit'"));
  const body = submit.slice(0, submit.indexOf('async function saveForReuse'));
  assert.equal((body.match(/clearStage\(\);/g) || []).length, 3, 'clearStage on success, on error, and in finally');
  assert.ok(body.indexOf('clearStage();') < body.indexOf('rateRequests.isCurrent(rateRequest, rateSnapshot())'),
    'the timer is cleared before the response is acted on');
});
