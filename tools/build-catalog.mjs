// Build MASEST commerce catalog artifacts from product/service metadata plus the
// reviewed VertKleen website-publication snapshot.
//
// Catalog policy, owner-approved 2026-06-20:
// - The v4.1 publication replaces the legacy SKU/pack matrix.
// - Verified 1 and 2.5 gal parcel profiles remain checkout-ready.
// - Quart, half-gallon, and case packs stay inactive until exact package
//   weights/dimensions are supplied; the generator never guesses freight data.
// - Bulk 55/275 gal drums/totes remain unpriced and quote-routed.
// - Prices/floors remain absent here. Live CMS/database pricing is authoritative.
//
// Idempotent: re-running produces the same output.
// Run: node tools/build-catalog.mjs

import { readFile, writeFile } from 'node:fs/promises';

const here = (p) => new URL(`../${p}`, import.meta.url);

const catalog = JSON.parse(await readFile(here('data/catalog.seed.json'), 'utf8'));
const publication = JSON.parse(await readFile(
  here('data/vertkleen-website-publish-2026-v4.1.json'),
  'utf8',
));

catalog.product_variants = publicationVariants(publication);

// 1) Apply product and variant policy.
for (const product of catalog.products) {
  product.mode = 'buy';
}

for (const variant of catalog.product_variants) {
  const gallons = Number(variant.size_gal);
  if (gallons >= 55) {
    variant.active = false;
    variant.intended_active = false;
    variant.requires_quote = true;
  }
}

// 2) Guardrails.
const activeVariants = catalog.product_variants.filter((v) => v.active);
const bigBuyable = activeVariants.filter((v) => Number(v.size_gal) >= 55);
const dupV = findDupes(catalog.product_variants.map((v) => v.sku));
const dupP = findDupes(catalog.products.map((p) => p.slug));
const productSlugs = new Set(catalog.products.map((p) => p.slug));
const orphanVariants = catalog.product_variants.filter((variant) => !productSlugs.has(variant.product_slug));
const missingReadyProfiles = activeVariants.filter((variant) => [
  variant.shipping_weight_lb,
  variant.shipping_length_in,
  variant.shipping_width_in,
  variant.shipping_height_in,
].some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0));
const errors = [
  ...bigBuyable.map((v) => `bulk variant must be quote-routed: ${v.sku}`),
  ...dupV.map((sku) => `duplicate variant sku: ${sku}`),
  ...dupP.map((slug) => `duplicate product slug: ${slug}`),
  ...orphanVariants.map((variant) => `variant product missing: ${variant.sku} -> ${variant.product_slug}`),
  ...missingReadyProfiles.map((variant) => `active variant shipping profile missing: ${variant.sku}`),
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
await writeFile(here('data/services.json'), servicesJson(catalog));

const pendingProfiles = catalog.product_variants.filter((variant) => (
  variant.activation_blocker === 'shipping_package_profile_missing'
)).length;
console.log(`catalog: ${catalog.products.length} products, ${catalog.product_variants.length} variants, ${activeVariants.length} checkout-ready, ${pendingProfiles} awaiting parcel profiles, ${(catalog.services || []).length + (catalog.service_packages || []).length} services`);

function publicationVariants(source) {
  const profiles = source.policy?.verified_shipping_profiles || {};
  const version = source.source?.version || '';
  const unitRows = source.unit_variants || [];
  const caseRows = source.case_variants || [];
  const bulkRows = source.bulk_variants || [];

  const project = (row, packageKind) => {
    const gallons = Number(row.gallons);
    const profile = packageKind === 'unit' ? profiles[String(gallons)] : null;
    const intendedActive = packageKind !== 'bulk';
    const ready = intendedActive && Boolean(profile);
    const bulk = packageKind === 'bulk';
    return {
      sku: row.sku,
      product_slug: row.product_slug,
      label: row.size,
      size_gal: gallons,
      container_type: packageKind === 'case'
        ? 'case'
        : bulk
          ? (gallons === 55 ? 'drum' : 'tote')
          : (gallons < 1 ? 'bottle' : 'jug'),
      market: row.market,
      package_kind: packageKind,
      marketing_name: row.marketing_name,
      units_per_case: packageKind === 'case' ? Number(row.units_per_case) : 1,
      ...(packageKind === 'case' ? { unit_sku: row.unit_sku } : {}),
      active: ready,
      intended_active: intendedActive,
      public_visible: true,
      account_only: false,
      requires_quote: bulk,
      ...(intendedActive && !ready
        ? { activation_blocker: 'shipping_package_profile_missing' }
        : {}),
      freight_mode: bulk ? 'ltl_final_quote' : ready ? 'parcel_or_ground' : 'parcel_profile_pending',
      ships_ground: ready,
      ships_ltl: bulk,
      ...(profile ? {
        shipping_weight_lb: Number(profile.shipping_weight_lb),
        shipping_length_in: Number(profile.shipping_length_in),
        shipping_width_in: Number(profile.shipping_width_in),
        shipping_height_in: Number(profile.shipping_height_in),
        shipping_profile_evidence: profile.evidence,
      } : {}),
      pricing_source_version: version,
      sort: variantSort(row.sku, packageKind),
    };
  };

  return [
    ...unitRows.map((row) => project(row, 'unit')),
    ...caseRows.map((row) => project(row, 'case')),
    ...bulkRows.map((row) => project(row, 'bulk')),
  ];
}

function variantSort(sku, packageKind) {
  const value = String(sku || '').toUpperCase();
  if (packageKind === 'bulk') return value.includes('275') ? 10 : 9;
  const base = value.includes('-QT') ? 1
    : value.includes('-HG') ? 2
      : value.includes('-1G') ? 3
        : value.includes('-25G') ? 4
          : 8;
  return packageKind === 'case' ? base + 4 : base;
}

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
    sort: p.sort,
  }));
  return JSON.stringify(rows, null, 2) + '\n';
}

function productsSql(products) {
  const currentSkus = products.map((p) => sqlStr(p.slug)).join(',');
  const rows = products.map((p) => `(${[
    sqlStr(p.slug),
    sqlStr(p.name),
    sqlStr(p.group_key),
    sqlStr(p.hmis),
    sqlStr(p.mode),
    Boolean(p.hazmat),
    Boolean(p.taxable),
    Number(p.sort || 0),
  ].join(',')})`);
  return `-- MASEST products - generated by tools/build-catalog.mjs from data/catalog.seed.json. DO NOT edit by hand.\n`
    + `insert into public.products (sku, name, group_key, hmis, mode, hazmat, taxable, sort)\nvalues\n`
    + rows.join(',\n')
    + `\non conflict (sku) do update set\n`
    + `  name = excluded.name,\n`
    + `  group_key = excluded.group_key,\n`
    + `  hmis = excluded.hmis,\n`
    + `  mode = excluded.mode,\n`
    + `  hazmat = excluded.hazmat,\n`
    + `  taxable = excluded.taxable,\n`
    + `  sort = excluded.sort;\n\n`
    + `delete from public.products where sku not in (${currentSkus});\n`;
}

function variantsSql(variants) {
  const currentVskus = variants.map((v) => sqlStr(v.sku)).join(',');
  const rows = variants.map((v) => `(${[
    sqlStr(v.sku),
    sqlStr(v.product_slug),
    sqlStr(v.label),
    Number(v.size_gal),
    sqlStr(v.market),
    sqlStr(v.package_kind),
    sqlStr(v.marketing_name),
    Number(v.units_per_case || 1),
    v.unit_sku ? sqlStr(v.unit_sku) : 'null',
    Boolean(v.active),
    Boolean(v.intended_active),
    v.activation_blocker ? sqlStr(v.activation_blocker) : 'null',
    Boolean(v.requires_quote),
    v.shipping_weight_lb == null ? 'null' : Number(v.shipping_weight_lb),
    v.shipping_length_in == null ? 'null' : Number(v.shipping_length_in),
    v.shipping_width_in == null ? 'null' : Number(v.shipping_width_in),
    v.shipping_height_in == null ? 'null' : Number(v.shipping_height_in),
    sqlStr(v.pricing_source_version),
    Number(v.sort || 0),
  ].join(',')})`);
  return `-- MASEST product variants - generated by tools/build-catalog.mjs from data/catalog.seed.json. DO NOT edit by hand.\n`
    + `-- Prices are CMS/database-managed and intentionally omitted.\n`
    + `-- active=true -> public checkout may sell the variant when CMS pricing exists.\n`
    + `-- active=false -> bulk quote route or unavailable checkout variant.\n`
    + `delete from public.product_variants where vsku not in (${currentVskus});\n\n`
    + `insert into public.product_variants (vsku, product_sku, label, gallons, market, package_kind, marketing_name, units_per_case, unit_vsku, active, intended_active, activation_blocker, requires_quote, shipping_weight_lb, shipping_length_in, shipping_width_in, shipping_height_in, pricing_source_version, sort)\nvalues\n`
    + rows.join(',\n')
    + `\non conflict (vsku) do update set\n`
    + `  product_sku = excluded.product_sku,\n`
    + `  label = excluded.label,\n`
    + `  gallons = excluded.gallons,\n`
    + `  market = excluded.market,\n`
    + `  package_kind = excluded.package_kind,\n`
    + `  marketing_name = excluded.marketing_name,\n`
    + `  units_per_case = excluded.units_per_case,\n`
    + `  unit_vsku = excluded.unit_vsku,\n`
    + `  active = excluded.active,\n`
    + `  intended_active = excluded.intended_active,\n`
    + `  activation_blocker = excluded.activation_blocker,\n`
    + `  requires_quote = excluded.requires_quote,\n`
    + `  shipping_weight_lb = excluded.shipping_weight_lb,\n`
    + `  shipping_length_in = excluded.shipping_length_in,\n`
    + `  shipping_width_in = excluded.shipping_width_in,\n`
    + `  shipping_height_in = excluded.shipping_height_in,\n`
    + `  pricing_source_version = excluded.pricing_source_version,\n`
    + `  sort = excluded.sort;\n`;
}

// Public services catalog fetched by js/main/service-catalog.js (services.html + about.html).
// Only client-safe fields — internal `source` / `payment_capture` notes are dropped.
function servicesJson(catalog) {
  const pub = (item) => ({
    sku: item.sku,
    name: item.name,
    summary: item.summary,
    category: item.category,
    unit: item.unit,
    active: item.active !== false,
    ...(item.sort_order != null ? { sort_order: Number(item.sort_order) } : {}),
    ...(item.lifecycle_stage ? { lifecycle_stage: item.lifecycle_stage } : {}),
  });
  return JSON.stringify({
    services: (catalog.services || []).map(pub),
    service_packages: (catalog.service_packages || []).map(pub),
  }, null, 2) + '\n';
}

function sqlStr(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}
