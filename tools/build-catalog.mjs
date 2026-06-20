// Build MASEST commerce catalog artifacts from data/catalog.seed.json.
//
// Catalog policy, owner-approved 2026-06-20:
// - Most product families are buyable in small packs: 1, 2.5, and 5 gal.
// - Documentation-gated products stay quote-first until SDS/TDS/certification
//   and launch pricing proof are confirmed: WaterSafe60, CR2, SAR, EG 50/50.
// - Bulk 55/275 gal drums and totes stay quote-routed because freight/final
//   scope changes at that size.
// - Missing small-pack prices are derived from the product's 5 gal list price
//   when present, otherwise from the 55 gal list price per gallon.
//
// Idempotent: re-running produces the same output.
// Run: node tools/build-catalog.mjs

import { readFile, writeFile } from 'node:fs/promises';

const here = (p) => new URL(`../${p}`, import.meta.url);
const SMALL_PACKS = new Set([1, 2.5, 5]);
const QUOTE_REVIEW_PRODUCTS = new Set(['watersafe60', 'cr2', 'sar', 'eg5050']);

const catalog = JSON.parse(await readFile(here('data/catalog.seed.json'), 'utf8'));

function fixedMoney(value) {
  return Number(value).toFixed(2);
}

function pricedByProduct(variants) {
  return variants.reduce((map, variant) => {
    if (Number(variant.retail_price) > 0) {
      if (!map.has(variant.product_slug)) map.set(variant.product_slug, []);
      map.get(variant.product_slug).push(variant);
    }
    return map;
  }, new Map());
}

function deriveSmallPackPrice(variant, pricedMap) {
  if (Number(variant.retail_price) > 0) return fixedMoney(variant.retail_price);
  const priced = pricedMap.get(variant.product_slug) || [];
  const fiveGal = priced.find((row) => Number(row.size_gal) === 5);
  const drum = priced.find((row) => Number(row.size_gal) === 55);
  const basis = fiveGal || drum;
  if (!basis) return null;
  const unitPrice = Number(basis.retail_price) / Number(basis.size_gal);
  return fixedMoney(unitPrice * Number(variant.size_gal));
}

// 1) Apply product and variant policy.
for (const product of catalog.products) {
  product.mode = QUOTE_REVIEW_PRODUCTS.has(product.slug) ? 'quote' : 'buy';
}

const pricedMap = pricedByProduct(catalog.product_variants);
for (const variant of catalog.product_variants) {
  const gallons = Number(variant.size_gal);
  if (SMALL_PACKS.has(gallons)) {
    variant.retail_price = deriveSmallPackPrice(variant, pricedMap);
    const quoteReview = QUOTE_REVIEW_PRODUCTS.has(variant.product_slug);
    variant.active = !quoteReview && variant.retail_price != null;
    variant.requires_quote = quoteReview || !variant.active;
    continue;
  }
  if (gallons >= 55) {
    variant.active = false;
    variant.requires_quote = true;
  }
}

// 2) Guardrails.
const activeVariants = catalog.product_variants.filter((v) => v.active);
const badPriced = activeVariants.filter((v) => !(Number(v.retail_price) > 0));
const bigBuyable = activeVariants.filter((v) => Number(v.size_gal) >= 55);
const missingSmallPack = catalog.products.flatMap((product) => {
  const small = catalog.product_variants.filter((v) => (
    v.product_slug === product.slug && SMALL_PACKS.has(Number(v.size_gal))
  ));
  if (!small.length) return [product.slug];
  if (QUOTE_REVIEW_PRODUCTS.has(product.slug)) {
    return product.mode === 'quote' && small.every((v) => v.active === false && v.requires_quote === true)
      ? []
      : [product.slug];
  }
  return product.mode === 'buy'
    && small.every((v) => v.active === true && Number(v.retail_price) > 0 && v.requires_quote === false)
    ? []
    : [product.slug];
});
const dupV = findDupes(catalog.product_variants.map((v) => v.sku));
const dupP = findDupes(catalog.products.map((p) => p.slug));
const errors = [
  ...badPriced.map((v) => `active variant has invalid price: ${v.sku}`),
  ...bigBuyable.map((v) => `bulk variant must be quote-routed: ${v.sku}`),
  ...missingSmallPack.map((slug) => `product small-pack readiness policy failed: ${slug}`),
  ...dupV.map((sku) => `duplicate variant sku: ${sku}`),
  ...dupP.map((slug) => `duplicate product slug: ${slug}`),
];
if (errors.length) {
  console.error('build-catalog failed:\n' + errors.join('\n'));
  process.exit(1);
}

// 3) Emit artifacts.
await writeFile(here('data/catalog.seed.json'), JSON.stringify(catalog, null, 2) + '\n');
await writeFile(here('supabase/variants_seed.sql'), variantsSql(catalog.product_variants));
await writeFile(here('supabase/seed.sql'), productsSql(catalog.products));
await writeFile(here('data/products.seed.json'), productsJson(catalog.products));
await writeFile(here('data/drum-pricing.json'), drumPricingJson(catalog.product_variants));
await writeFile(here('data/services.json'), servicesJson(catalog));

console.log(`catalog: ${catalog.products.length} products, ${catalog.product_variants.length} variants, ${activeVariants.length} active small-pack variants, ${(catalog.services || []).length + (catalog.service_packages || []).length} services`);

function findDupes(items) {
  const seen = new Set();
  const dupes = new Set();
  for (const item of items) {
    if (seen.has(item)) dupes.add(item);
    seen.add(item);
  }
  return [...dupes];
}

function productsJson(products) {
  const rows = products.map((p) => ({
    sku: p.slug,
    name: p.name,
    group_key: p.group_key,
    hmis: p.hmis,
    mode: p.mode,
    hazmat: p.hazmat,
    taxable: p.taxable,
    price: null,
    sort: p.sort,
  }));
  return JSON.stringify(rows, null, 2) + '\n';
}

function productsSql(products) {
  const rows = products.map((p) => `(${[
    sqlStr(p.slug),
    sqlStr(p.name),
    sqlStr(p.group_key),
    sqlStr(p.hmis),
    sqlStr(p.mode),
    Boolean(p.hazmat),
    Boolean(p.taxable),
    'null',
    Number(p.sort || 0),
  ].join(',')})`);
  return `-- MASEST products - generated by tools/build-catalog.mjs from data/catalog.seed.json. DO NOT edit by hand.\n`
    + `insert into public.products (sku, name, group_key, hmis, mode, hazmat, taxable, price, sort)\nvalues\n`
    + rows.join(',\n')
    + `\non conflict (sku) do update set\n`
    + `  name = excluded.name,\n`
    + `  group_key = excluded.group_key,\n`
    + `  hmis = excluded.hmis,\n`
    + `  mode = excluded.mode,\n`
    + `  hazmat = excluded.hazmat,\n`
    + `  taxable = excluded.taxable,\n`
    + `  price = excluded.price,\n`
    + `  sort = excluded.sort;\n`;
}

function variantsSql(variants) {
  const rows = variants.map((v) => `(${[
    sqlStr(v.sku),
    sqlStr(v.product_slug),
    sqlStr(v.label),
    Number(v.size_gal),
    v.retail_price == null ? 'null' : Number(v.retail_price),
    Boolean(v.active),
    Number(v.sort || 0),
  ].join(',')})`);
  return `-- MASEST product variants - generated by tools/build-catalog.mjs from data/catalog.seed.json. DO NOT edit by hand.\n`
    + `-- active=true -> public checkout may sell the variant (priced small packs only).\n`
    + `-- active=false -> bulk quote route or unavailable checkout variant.\n`
    + `insert into public.product_variants (vsku, product_sku, label, gallons, price, active, sort)\nvalues\n`
    + rows.join(',\n')
    + `\non conflict (vsku) do update set\n`
    + `  product_sku = excluded.product_sku,\n`
    + `  label = excluded.label,\n`
    + `  gallons = excluded.gallons,\n`
    + `  price = excluded.price,\n`
    + `  active = excluded.active,\n`
    + `  sort = excluded.sort;\n`;
}

function drumPricingJson(variants) {
  const out = {};
  for (const v of variants) {
    if (Number(v.size_gal) >= 55 && v.retail_price != null) {
      (out[v.product_slug] ||= []).push({
        label: v.label,
        gallons: Number(v.size_gal),
        price: Number(v.retail_price),
        currency: v.currency || 'usd',
      });
    }
  }
  for (const slug of Object.keys(out)) out[slug].sort((a, b) => a.gallons - b.gallons);
  return JSON.stringify(out, null, 2) + '\n';
}

// Public services catalog fetched by js/main/service-catalog.js (services.html + about.html).
// Only client-safe fields — internal `source` / `payment_capture` notes are dropped.
function servicesJson(catalog) {
  const pub = (item) => ({
    sku: item.sku,
    name: item.name,
    category: item.category,
    unit: item.unit,
    public_price: item.public_price != null ? Number(item.public_price) : null,
    currency: item.currency || 'usd',
    active: item.active !== false,
  });
  return JSON.stringify({
    services: (catalog.services || []).map(pub),
    service_packages: (catalog.service_packages || []).map(pub),
  }, null, 2) + '\n';
}

function sqlStr(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}
