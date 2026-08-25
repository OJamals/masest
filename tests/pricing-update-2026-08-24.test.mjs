import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const publication = () => JSON.parse(read('data/vertkleen-website-publish-2026-v4.1.json'));
const catalog = () => JSON.parse(read('data/catalog.seed.json'));

const cents = (value) => Math.round(Number(value) * 100);

test('v4.1 workbook publication is captured with exact provenance and row counts', () => {
  const data = publication();
  assert.equal(data.source.file, 'VertKleen_Website_Publish_List_2026_EXTERNAL.xlsx');
  assert.equal(data.source.sha256, 'fc555e6ec410a20d945bc6e0635bdcda3ce1389bed47205f6696989fe8041d7e');
  assert.equal(data.source.version, 'v4.1 EXTERNAL');
  assert.equal(data.policy.currency, 'USD');
  assert.equal(data.policy.price_hold_months, 12);
  assert.equal(data.policy.minimum_order_recommended, 75);
  assert.deepEqual(data.policy.online_promotion, { code: 'VK5', percent_off: 5 });
  assert.equal(data.products.length, 24);
  assert.equal(data.unit_variants.length, 96);
  assert.equal(data.case_variants.length, 64);
  assert.equal(data.bulk_variants.length, 48);
});

test('all workbook SKUs are unique and checkout prices satisfy floor policy', () => {
  const data = publication();
  const all = [...data.unit_variants, ...data.case_variants, ...data.bulk_variants];
  assert.equal(all.length, 208);
  assert.equal(new Set(all.map((row) => row.sku)).size, all.length);

  for (const row of data.unit_variants) {
    assert.ok(Number(row.online_price) > 0, `${row.sku} needs an online price`);
    assert.ok(Number(row.minimum_checkout_price) > 0, `${row.sku} needs a floor`);
    assert.ok(cents(row.vk5_price) >= cents(row.minimum_checkout_price), `${row.sku} VK5 breaches its floor`);
    assert.equal(cents(row.vk5_price), Math.round(cents(row.online_price) * 0.95), `${row.sku} VK5 mismatch`);
  }
  for (const row of data.case_variants) {
    const unit = data.unit_variants.find((candidate) => candidate.sku === row.unit_sku);
    assert.ok(unit, `${row.sku} needs its unit SKU`);
    assert.equal(cents(row.online_price), Math.round(cents(unit.online_price) * row.units_per_case * 0.9));
    assert.equal(cents(row.minimum_checkout_price), cents(unit.minimum_checkout_price) * row.units_per_case);
    assert.ok(Math.round(cents(row.online_price) * 0.95) >= cents(row.minimum_checkout_price));
  }
  assert.ok(data.bulk_variants.every((row) => row.online_price == null));
  assert.ok(data.bulk_variants.every((row) => row.cart_type === 'Request pricing'));
});

test('representative workbook prices remain exact', () => {
  const data = publication();
  const bySku = new Map(
    [...data.unit_variants, ...data.case_variants, ...data.bulk_variants]
      .map((row) => [row.sku, row]),
  );
  assert.deepEqual(
    ['WS60-QT', 'CR60-1G', 'HCR-1G', 'HCRCIP-1G', 'SB-1G', 'MAM-25G']
      .map((sku) => [sku, bySku.get(sku)?.online_price]),
    [
      ['WS60-QT', 6.49],
      ['CR60-1G', 20.49],
      ['HCR-1G', 28.99],
      ['HCRCIP-1G', 28.99],
      ['SB-1G', 44.99],
      ['MAM-25G', 144.99],
    ],
  );
  assert.equal(bySku.get('CRHD-HG-CS')?.online_price, 45.85);
  assert.equal(bySku.get('SB-55D')?.online_price, null);
});

test('catalog projects every workbook SKU without embedding CMS prices', () => {
  const prices = publication();
  const data = catalog();
  const workbookSkus = [...prices.unit_variants, ...prices.case_variants, ...prices.bulk_variants]
    .map((row) => row.sku)
    .sort();
  assert.equal(data.products.length, 16);
  assert.equal(data.product_variants.length, 208);
  assert.deepEqual(data.product_variants.map((row) => row.sku).sort(), workbookSkus);
  assert.ok(data.product_variants.every((row) => !('retail_price' in row)));
  assert.ok(data.product_variants.every((row) => !('minimum_checkout_price' in row)));
  assert.ok(data.product_variants.every((row) => ['industrial', 'marine'].includes(row.market)));
  assert.ok(data.product_variants.every((row) => ['unit', 'case', 'bulk'].includes(row.package_kind)));
  assert.ok(data.product_variants.filter((row) => row.package_kind === 'bulk').every((row) => (
    row.active === false && row.requires_quote === true
  )));
});

test('unverified parcel profiles fail closed instead of guessing weights or dimensions', () => {
  const data = catalog();
  const pending = data.product_variants.filter((row) => row.activation_blocker === 'shipping_package_profile_missing');
  assert.equal(pending.length, 112);
  assert.ok(pending.every((row) => row.active === false));
  assert.ok(pending.every((row) => row.intended_active === true));

  const ready = data.product_variants.filter((row) => row.active === true);
  assert.equal(ready.length, 48);
  assert.ok(ready.every((row) => [1, 2.5].includes(Number(row.size_gal))));
  assert.ok(ready.every((row) => [
    row.shipping_weight_lb,
    row.shipping_length_in,
    row.shipping_width_in,
    row.shipping_height_in,
  ].every((value) => Number(value) > 0)));
});

test('database migration owns prices, floors, market metadata, and exact readback gates', () => {
  const sql = read('supabase/update-pricing-2026-08-24.sql');
  assert.match(sql, /fc555e6ec410a20d945bc6e0635bdcda3ce1389bed47205f6696989fe8041d7e/);
  assert.match(sql, /v4\.1 EXTERNAL/);
  assert.match(sql, /minimum_checkout_price/);
  assert.match(sql, /market/);
  assert.match(sql, /package_kind/);
  assert.match(sql, /marketing_name/);
  assert.match(sql, /pricing_update_expected_160_priced_variants/);
  assert.match(sql, /pricing_update_expected_48_quote_only_variants/);
  assert.match(sql, /pricing_update_exact_readback_failed/);
  assert.match(sql, /select count\(\*\) from public\.price_tiers\) <> 160/);
  assert.match(sql, /shipping_package_profile_missing/);
  assert.match(sql, /stripe_price_id = null/);
  assert.match(sql, /current\.stripe_price_id is not null/);
  assert.match(sql, /price = null,\n  currency = 'usd',\n  stripe_price_id = null,/);
  assert.match(sql, /current_product\.stripe_price_id is not null/);
  assert.doesNotMatch(sql, /SB-55D[^\n]+(?:[1-9]\d*\.\d{2})/);

  const legacySafeConstraint = sql.indexOf(
    'constraint product_variants_active_shipping_profile_complete\n    check',
  );
  const variantReplacement = sql.indexOf('insert into public.product_variants (');
  const legacyPrune = sql.indexOf('delete from public.product_variants');
  const constraintValidation = sql.indexOf(
    'validate constraint product_variants_active_shipping_profile_complete',
  );
  assert.ok(legacySafeConstraint >= 0);
  assert.match(sql.slice(legacySafeConstraint, variantReplacement), /not valid/);
  assert.ok(legacySafeConstraint < variantReplacement);
  assert.ok(variantReplacement < legacyPrune);
  assert.ok(legacyPrune < constraintValidation);
});

test('expand-only migration is backward-compatible and cannot replace live pricing', () => {
  const sql = read('supabase/expand-pricing-schema-2026-08-24.sql');
  assert.match(sql, /^-- Expand-only compatibility migration/);
  assert.match(sql, /add column if not exists minimum_checkout_price/);
  assert.match(sql, /add column if not exists pricing_source_version/);
  assert.match(sql, /create or replace function public\.set_variant_pricing/);
  assert.match(sql, /price_below_minimum_checkout/);
  assert.match(sql, /commit;/);
  assert.doesNotMatch(sql, /pricing_update_20260824/);
  assert.doesNotMatch(sql, /insert into public\.products/);
  assert.doesNotMatch(sql, /delete from public\.products/);
  assert.doesNotMatch(sql, /update public\.product_variants set active/);
});

test('tracked migration and segment tables exactly match their canonical generators', () => {
  const run = (tool) => execFileSync(
    process.execPath,
    [fileURLToPath(new URL(`../tools/${tool}`, import.meta.url))],
    { encoding: 'utf8' },
  );
  assert.equal(run('build-pricing-update-2026-08-24.mjs'), read('supabase/update-pricing-2026-08-24.sql'));
  assert.equal(run('build-segment-pricing.mjs'), read('data/segment-pricing.json'));
});

test('CMS and checkout expose floors while public commerce separates product lines', () => {
  const adminApi = read('functions/api/admin/variant-pricing.js');
  const adminUi = read('js/admin/pricing.js');
  const productsApi = read('functions/api/products.js');
  const pricingApi = read('functions/api/pricing.js');
  const productPricing = read('functions/_lib/public-product-pricing.js');
  const checkout = read('functions/api/checkout.js');
  const commerce = read('js/main/commerce-ui.js');

  assert.match(adminApi, /minimum_checkout_price/);
  assert.match(adminUi, /Minimum checkout/);
  assert.match(productsApi, /market/);
  assert.match(productsApi, /package_kind/);
  assert.match(productsApi, /marketing_name/);
  assert.match(pricingApi, /market/);
  assert.match(pricingApi, /package_kind/);
  assert.match(pricingApi, /marketing_name/);
  assert.match(pricingApi, /pricing_source_version/);
  assert.match(productPricing, /pricing_source_version/);
  assert.match(checkout, /minimum_checkout_price/);
  assert.match(checkout, /checkout_price_below_floor/);
  assert.match(commerce, /market/);
  assert.match(commerce, /package_kind/);
  assert.match(commerce, /marketing_name/);
});

test('public pricing surfaces disclose the workbook recommended order minimum', () => {
  assert.match(read('products.html'), /\$75 recommended order minimum/i);
  assert.match(read('pricing-hvac-facilities.html'), /\$75<\/b> recommended order minimum/i);
  assert.match(read('pricing-cip-food-beverage.html'), /\$75<\/b> recommended order minimum/i);
  assert.match(read('data/segment-pricing.json'), /Recommended \$75 minimum order/);
});
