// Drift lock: keeps functions/_lib/sds-docs.js in sync with the catalog. If a product or
// SKU stem is added/renamed in data/catalog.seed.json, or a product starts/stops publishing
// an SDS in js/main/catalog-data.js, or an SDS PDF is moved, one of these assertions fails —
// forcing the order-email attachment map to be updated deliberately rather than silently rot.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { STEMS, SDS_BY_STEM } from '../functions/_lib/sds-docs.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(readFileSync(resolve(root, 'data/catalog.seed.json'), 'utf8'));

// slug -> the first "Safety Data Sheet" file in PRODUCTS[slug].docs, parsed straight from
// the catalog-data.js source so this test is the single check that the two stay aligned.
function sdsBySlugFromCatalogData() {
  const src = readFileSync(resolve(root, 'js/main/catalog-data.js'), 'utf8');
  const keyRe = /^ {2}([a-z0-9-]+):\s*\{/gm;
  const keys = [];
  let m;
  while ((m = keyRe.exec(src))) keys.push({ slug: m[1], at: m.index });
  const map = {};
  for (let i = 0; i < keys.length; i += 1) {
    const block = src.slice(keys[i].at, i + 1 < keys.length ? keys[i + 1].at : src.length);
    const sds = block.match(/Safety Data Sheet[^]*?file:\s*"(docs\/sds\/[^"]*sds[^"]*)"/i);
    if (sds) map[keys[i].slug] = sds[1];
  }
  return map;
}

test('STEMS exactly equals the set of sku_stem in the catalog seed', () => {
  const seedStems = [...new Set(seed.products.map((p) => p.sku_stem))].sort();
  assert.deepEqual([...STEMS].sort(), seedStems);
});

test('every SDS_BY_STEM key is a known stem', () => {
  for (const stem of Object.keys(SDS_BY_STEM)) {
    assert.ok(STEMS.includes(stem), `${stem} is not a known sku_stem`);
  }
});

test('every product that publishes an SDS is represented (no silent gaps)', () => {
  const slug2stem = Object.fromEntries(seed.products.map((p) => [p.slug, p.sku_stem]));
  const sdsBySlug = sdsBySlugFromCatalogData();
  assert.ok(Object.keys(sdsBySlug).length >= 10, 'catalog-data SDS parse looks wrong');
  for (const [slug, file] of Object.entries(sdsBySlug)) {
    const stem = slug2stem[slug];
    if (!stem) continue; // catalog-data copy block with no matching buyable product
    assert.equal(SDS_BY_STEM[stem], file,
      `SDS for ${slug} (${stem}) drifted: catalog-data has ${file}, map has ${SDS_BY_STEM[stem]}`);
  }
});

test('every mapped SDS PDF exists on disk', () => {
  for (const file of Object.values(SDS_BY_STEM)) {
    assert.doesNotThrow(() => readFileSync(resolve(root, file)), `${file} missing`);
  }
});
