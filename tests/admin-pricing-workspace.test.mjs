import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../js/admin/pricing.js', import.meta.url), 'utf8');
const pricingUi = await import('../js/admin/pricing.js');

test('pricing workspace defaults to one resource type instead of one long mixed wall', () => {
  for (const scope of ['products', 'services', 'programs']) {
    assert.match(html, new RegExp(`data-price-scope="${scope}"`));
  }
  assert.match(html, /data-price-scope="products"[^>]+aria-pressed="true"/);
  assert.match(html, /<label[^>]+class="adm-price-search"[^>]*>Search prices/);
  assert.match(html, /placeholder="Search product name or VSKU…"/);
});

test('pricing scope filters product, service, and program records without changing the API contract', () => {
  assert.equal(typeof pricingUi.filterPricingData, 'function');
  const data = {
    tiers: ['retail'],
    rows: [{ vsku: 'VK-CR-1G', product_name: 'VertKleen CIP CR', label: '1 gal jug' }],
    services: [{ sku: 'MS-LAB-WTR-TOWER', name: 'Tower Water Analysis' }],
    programs: [{ slug: 'premium', title: 'Premium', price: '$2,420-4,950' }],
  };

  assert.deepEqual(pricingUi.filterPricingData(data, '', 'products'), {
    tiers: ['retail'],
    rows: data.rows,
    services: [],
    programs: [],
  });
  assert.deepEqual(pricingUi.filterPricingData(data, 'tower', 'services'), {
    tiers: ['retail'],
    rows: [],
    services: data.services,
    programs: [],
  });
  assert.deepEqual(pricingUi.filterPricingData(data, 'premium', 'programs'), {
    tiers: ['retail'],
    rows: [],
    services: [],
    programs: data.programs,
  });
});

test('pricing row actions name the record they save', () => {
  assert.match(source, /aria-label="Save prices for \$\{esc\(row\.product_name\)\}/);
  assert.match(source, /aria-label="Save price for \$\{esc\(service\.name\)\}/);
  assert.match(source, /aria-label="Save display prices for \$\{esc\(program\.title/);
});

test('nested promo and pricing sections do not inherit storefront section spacing', () => {
  assert.match(html, /\.adm-promo-history\s*\{[^}]*padding:\s*2px 0 0/);
  assert.match(html, /\.adm-price-section\s*\{[^}]*padding:\s*0/);
});
