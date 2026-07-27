import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { withCatalogMediaFallback } = await import("../js/admin/products.js");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readRoot = (path) => readFileSync(new URL(`../${path.replace(/^site\//, "")}`, import.meta.url), "utf8");

test("admin catalog can manage product photos and remove products", () => {
  const html = read("admin.html");
  // Products tab split into its own module in #36.
  assert.match(read("js/admin.js"), /import\(\s*["']\.\/admin\/products\.js\?v=\d{8}[a-z]["']\s*\)/, "admin should lazy-import the products module");
  const admin = read("js/admin/products.js");

  assert.match(html, /id="npImageUrl"/, "product form should collect a public image URL");
  assert.match(html, /id="npPhotoAlt"/, "product form should collect product photo alt text");
  assert.match(admin, /npImageUrl/, "admin script should submit product image URL");
  assert.match(admin, /npPhotoAlt/, "admin script should submit product photo alt text");
  assert.match(admin, /image_url/, "admin script should render/edit product image URLs");
  assert.match(admin, /photo_alt/, "admin script should render/edit product photo alt text");
  assert.match(admin, /openImageLibraryPicker/, "product photos should use the shared CMS image library");
  assert.match(admin, /data-product-asset="primary"/, "primary photos should be selectable from CMS assets");
  assert.match(admin, /data-product-asset="gallery"/, "gallery photos should be selectable from CMS assets");
  assert.match(admin, /method:\s*['"]DELETE['"]/, "admin script should remove products through DELETE");
});

test("admin product APIs expose safe product media fields", () => {
  for (const path of [
    "site/functions/api/admin/products.js",
    "site/functions/api/admin/products.js",
  ]) {
    const source = readRoot(path);
    assert.match(source, /image_url/, `${path} should read/write image_url`);
    assert.match(source, /photo_alt/, `${path} should read/write photo_alt`);
  }

  const schema = read("supabase/schema-phase5.sql");
  assert.match(schema, /products\s+add column if not exists image_url/i);
  assert.match(schema, /products\s+add column if not exists photo_alt/i);
});

test("admin products show catalog media when CMS media fields are empty", () => {
  const fallback = withCatalogMediaFallback({
    sku: "cr-hd",
    name: "VertKlean CR HD",
    image_url: null,
    photo_alt: null,
  });
  assert.equal(fallback.image_url, "img/products/crhd-studio.webp");
  assert.equal(fallback.photo_alt, "VertKlean CR HD product image");

  const customized = withCatalogMediaFallback({
    sku: "hcr",
    name: "VertKlean CIP HCR",
    image_url: "https://cdn.example.test/custom-hcr.webp",
    photo_alt: "Custom HCR photo",
  });
  assert.equal(customized.image_url, "https://cdn.example.test/custom-hcr.webp");
  assert.equal(customized.photo_alt, "Custom HCR photo");
});
