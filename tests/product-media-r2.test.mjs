import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeProduct } from "../functions/api/admin/products.js";
import { canonicalizeProductMedia } from "../functions/_lib/product-media.js";

const LEGACY_BASE = "https://mvfxzvkzcqmnwcoblvfc.supabase.co/storage/v1/object/public/content-assets/";
const MEDIA_BASE = "https://media.masest.co/";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("product media responses canonicalize legacy Supabase and root image URLs to R2", () => {
  assert.deepEqual(canonicalizeProductMedia({
    sku: "hcr",
    image_url: `${LEGACY_BASE}site/img/products/hcr-studio.webp`,
    gallery: [
      "/img/products/hcr-detail.webp",
      `${LEGACY_BASE}site/img/products/hcr-studio.webp`,
      "https://cdn.example.com/hcr-lab.webp",
      null,
    ],
  }), {
    sku: "hcr",
    image_url: `${MEDIA_BASE}site/img/products/hcr-studio.webp`,
    gallery: [
      `${MEDIA_BASE}site/img/products/hcr-detail.webp`,
      `${MEDIA_BASE}site/img/products/hcr-studio.webp`,
      "https://cdn.example.com/hcr-lab.webp",
    ],
  });
  assert.deepEqual(canonicalizeProductMedia(null), { image_url: null, gallery: [] });
});

test("admin product writes persist the R2 canonical URL", () => {
  const normalized = normalizeProduct({
    sku: "hcr",
    image_url: `${LEGACY_BASE}site/img/products/hcr-studio.webp`,
  });
  assert.equal(normalized.row.image_url, `${MEDIA_BASE}site/img/products/hcr-studio.webp`);
});

test("public and admin product reads use the shared product-media canonicalizer", () => {
  assert.match(read("functions/api/products.js"), /canonicalizeProductMedia\(product\)/);
  assert.match(read("functions/api/admin/products.js"), /canonicalizeProductMedia\(product\)/);
  assert.match(read("functions/api/admin/product-image.js"), /canonicalizeProductMedia/);
});

test("the product metadata migration replaces Supabase content-assets URLs with R2", () => {
  const migration = read("supabase/migrate-product-media-to-r2-2026-09-02.sql");
  assert.match(migration, /mvfxzvkzcqmnwcoblvfc\.supabase\.co\/storage\/v1\/object\/public\/content-assets\//);
  assert.match(migration, /https:\/\/media\.masest\.co\//);
  assert.match(migration, /update\s+products[\s\S]*image_url/i);
  assert.match(migration, /jsonb_array_elements[\s\S]*gallery/i);
});
