// Checkout rates cartons; fulfillment buys labels. If the two derive different parcels,
// MASEST charges for one shipment and buys another. These tests pin them together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combinePackagesForRates, normalizePackagePlan } from '../functions/_lib/shipping-packages.js';
import { combinePackagesForRates as fromCheckout } from '../functions/_lib/checkout-shipping.js';
import { packagesFromOrderItems } from '../functions/_lib/shipstation-orders.js';
import { checkoutReadiness } from '../functions/api/health.js';

const jug = { shipping_weight_lb: 25, shipping_length_in: 10, shipping_width_in: 10, shipping_height_in: 15 };

function unitsFor(qty) {
  return packagesFromOrderItems(
    { order_items: [{ sku: 'VK-CR-2.5G', qty }] },
    [{ vsku: 'VK-CR-2.5G', ...jug }],
    { maxPackages: 250 },
  );
}

test('checkout re-exports the shared implementation, not a copy', () => {
  assert.equal(fromCheckout, combinePackagesForRates);
});

test('two 25 lb jugs consolidate into one carton at the 50 lb ceiling', () => {
  const cartons = combinePackagesForRates(unitsFor(2));
  assert.equal(cartons.length, 1);
  assert.equal(cartons[0].weight.value, 50);
  assert.equal(cartons[0].weight.unit, 'pound');
  // Stacked side by side, not summed along every axis.
  assert.equal(cartons[0].dimensions.height, 15);
});

test('a third jug opens a second carton rather than overloading the first', () => {
  const cartons = combinePackagesForRates(unitsFor(3));
  assert.equal(cartons.length, 2);
  assert.deepEqual(cartons.map((carton) => carton.weight.value).sort((a, b) => b - a), [50, 25]);
});

test('consolidation keeps a large cart under the provider package ceiling', () => {
  // 40 units is 1000 lb: 40 raw parcels would exceed the provider's 20-package limit,
  // 20 consolidated cartons do not.
  const cartons = combinePackagesForRates(unitsFor(40));
  assert.equal(cartons.length, 20);
  assert.ok(cartons.every((carton) => carton.weight.value <= 50));
});

test('units missing dimensions are rejected rather than rated as a guess', () => {
  assert.throws(
    () => combinePackagesForRates([{ weight: 25 }]),
    (error) => error.code === 'shipping_package_profile_missing',
  );
  assert.throws(
    () => combinePackagesForRates([]),
    (error) => error.code === 'shipping_package_profile_missing',
  );
});

test('a persisted plan round-trips through the provider validator', () => {
  const cartons = combinePackagesForRates(unitsFor(4));
  const replayed = normalizePackagePlan(JSON.parse(JSON.stringify(cartons)));
  assert.equal(replayed.length, cartons.length);
  assert.deepEqual(replayed[0].weight, cartons[0].weight);
  assert.equal(replayed[0].package_code, 'package');
});

test('a corrupt plan is rejected so fulfillment falls back instead of shipping garbage', () => {
  assert.equal(normalizePackagePlan(null), null);
  assert.equal(normalizePackagePlan([]), null);
  assert.equal(normalizePackagePlan([{ weight: { value: -1, unit: 'pound' } }]), null);
  assert.equal(normalizePackagePlan('not-an-array'), null);
});

test('health reports each checkout dependency by name', () => {
  const blocked = checkoutReadiness({});
  assert.equal(blocked.ready, false);
  assert.ok(blocked.blocking.includes('shipping_quote_secret'));
  assert.ok(blocked.blocking.includes('address_validation_key'));

  const shortSecret = checkoutReadiness({ SHIPPING_QUOTE_SECRET: 'too-short' });
  assert.equal(shortSecret.checks.shipping_quote_secret, 'too_short');

  // The browser Places key works only if Address Validation was added to its restrictions,
  // so it is reported as a distinct, non-blocking-but-suspect state.
  const fallback = checkoutReadiness({ GC_AUTOCOMPLETE_API_KEY: 'browser-key' });
  assert.equal(fallback.checks.address_validation_key, 'browser_key_fallback');
  assert.ok(!fallback.blocking.includes('address_validation_key'));

  const ready = checkoutReadiness({
    SHIPPING_QUOTE_SECRET: 'q'.repeat(48),
    GC_ADDRESS_VALIDATION_API_KEY: 'server-key',
    SHIPSTATION_API_KEY: 'k',
    SHIPSTATION_WAREHOUSE_ID: 'se-1',
    SHIPSTATION_WEBHOOK_TOKEN: 't',
    STRIPE_SECRET_KEY: 'sk',
    STRIPE_WEBHOOK_SECRET: 'wh',
    RESEND_API_KEY: 're',
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.blocking, []);
});
