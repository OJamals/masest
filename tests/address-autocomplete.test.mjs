import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { addressAutocompleteConfig, onRequestGet } from '../functions/api/address-autocomplete-config.js';
import { addressFromPlace } from '../js/address-autocomplete.js';

const component = (type, longText, shortText = longText) => ({ types: [type], longText, shortText });

test('address autocomplete config exposes only a valid browser-restricted key', async () => {
  const key = `AIza${'x'.repeat(32)}`;
  assert.deepEqual(addressAutocompleteConfig({ GC_AUTOCOMPLETE_API_KEY: '' }), { enabled: false });
  assert.deepEqual(addressAutocompleteConfig({ GC_AUTOCOMPLETE_API_KEY: 'invalid' }), { enabled: false });
  assert.deepEqual(addressAutocompleteConfig({ GC_AUTOCOMPLETE_API_KEY: key }), {
    enabled: true,
    api_key: key,
    included_region_codes: ['us'],
  });
  const response = await onRequestGet({ env: { GC_AUTOCOMPLETE_API_KEY: key } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, max-age=300');
  assert.equal((await response.json()).api_key, key);
});

test('Google Place address components map deterministically to the saved-address form', () => {
  assert.deepEqual(addressFromPlace({
    formattedAddress: '100 Main Street, Melbourne, FL 32901, USA',
    addressComponents: [
      component('street_number', '100'),
      component('route', 'Main Street'),
      component('subpremise', 'Suite 200'),
      component('locality', 'Melbourne'),
      component('administrative_area_level_1', 'Florida', 'FL'),
      component('postal_code', '32901'),
      component('postal_code_suffix', '1234'),
      component('country', 'United States', 'US'),
    ],
  }), {
    line1: '100 Main Street',
    line2: 'Suite 200',
    city: 'Melbourne',
    state: 'FL',
    zip: '32901-1234',
    country: 'US',
  });
});

test('dashboard mounts autocomplete as progressive enhancement while retaining manual fields', () => {
  const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
  const docs = readFileSync(new URL('../docs/ADDRESS_AUTOCOMPLETE.md', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../js/dashboard.js', import.meta.url), 'utf8');
  assert.match(html, /id="addressAutocompleteMount"/);
  assert.match(html, /gmp-place-autocomplete[^}]*color-scheme:\s*light/);
  for (const referrer of ['https://masest.co', 'https://masest.co/*', 'https://www.masest.co', 'https://www.masest.co/*']) {
    assert.ok(docs.includes(`\`${referrer}\``));
  }
  for (const id of ['aLine1', 'aLine2', 'aCity', 'aState', 'aZip']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(source, /mountAddressAutocomplete/);
  assert.match(source, /line1:\s*\$\('aLine1'\)/);
});
