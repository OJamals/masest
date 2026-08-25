// Project public segment tables from the reviewed website-publication snapshot.
// Emits JSON to stdout; prices remain runtime CMS data.

import { readFile } from 'node:fs/promises';

const publication = JSON.parse(await readFile(
  new URL('../data/vertkleen-website-publish-2026-v4.1.json', import.meta.url),
  'utf8',
));

const productCopy = new Map(publication.products.map((product) => [product.product, product]));
const allRows = [
  ...publication.unit_variants.map((row) => ({ ...row, package_kind: 'unit' })),
  ...publication.case_variants.map((row) => ({ ...row, package_kind: 'case' })),
  ...publication.bulk_variants.map((row) => ({ ...row, package_kind: 'bulk' })),
];

const specs = [
  {
    slug: 'hvac-facilities',
    title: 'HVAC & Facilities',
    intro: 'Current online list prices for descaling, degreasing, exterior cleaning, and everyday facility work.',
    products: [
      'VK HCR',
      'VK Descaler',
      'VK AlumiBrite',
      'VK CR (HVAC CR)',
      'VK CR HD',
      'VK MultiWash (Fortis)',
      'VK Neutral Degreaser',
      'VK LAM3',
      'VK Purgo (biocide)',
    ],
  },
  {
    slug: 'cip-food-beverage',
    title: 'CIP pricing',
    intro: 'Current online list prices for brewery, distillery, restaurant, and food-plant cleaning.',
    products: [
      'VK CR CIP',
      'VK HCR CIP',
      'VK CR HD',
      'VK Neutral Degreaser',
      'VK MultiWash (Fortis)',
      'VK Purgo (biocide)',
    ],
  },
];

const data = {
  source: {
    version: publication.source.version,
    sha256: publication.source.sha256,
  },
  currency: publication.policy.currency,
  volume_discount: 'Industrial cases are 10% below the same units bought singly. VK5 saves 5% on eligible online orders.',
  footer_note: 'Recommended $75 minimum order. Prices exclude sales tax and freight. FOB Merritt Island, FL. Drums and totes are quote-only.',
  segments: specs.map((spec) => ({
    slug: spec.slug,
    price_tier: 'retail',
    title: spec.title,
    intro: spec.intro,
    rows: spec.products.flatMap((productName) => {
      const copy = productCopy.get(productName);
      if (!copy) throw new Error(`segment product missing: ${productName}`);
      return allRows
        .filter((row) => row.product === productName && row.market === 'industrial')
        .map((row) => ({
          sku: row.sku,
          product_slug: row.product_slug,
          product: row.marketing_name,
          application: copy.primary_use,
          size_gal: Number(row.gallons),
          pack: row.size,
          package_kind: row.package_kind,
          quote_only: row.package_kind === 'bulk',
          notes: row.package_kind === 'case'
            ? '10% case saving versus singles'
            : row.package_kind === 'bulk'
              ? 'Freight quoted'
              : row.merch_tag || null,
        }));
    }),
  })),
};

process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
