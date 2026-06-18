import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readRoot = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("admin catalog can manage product photos and remove products", () => {
  const html = read("admin.html");
  const admin = read("js/admin.js");

  assert.match(html, /id="npImageUrl"/, "product form should collect a public image URL");
  assert.match(html, /id="npPhotoAlt"/, "product form should collect product photo alt text");
  assert.match(admin, /npImageUrl/, "admin script should submit product image URL");
  assert.match(admin, /npPhotoAlt/, "admin script should submit product photo alt text");
  assert.match(admin, /image_url/, "admin script should render/edit product image URLs");
  assert.match(admin, /photo_alt/, "admin script should render/edit product photo alt text");
  assert.match(admin, /method:\s*['"]DELETE['"]/, "admin script should remove products through DELETE");
});

test("admin product APIs expose safe product media fields", () => {
  for (const path of [
    "site/functions/api/admin/products.js",
    "site/netlify/functions/admin-products.js",
  ]) {
    const source = readRoot(path);
    assert.match(source, /image_url/, `${path} should read/write image_url`);
    assert.match(source, /photo_alt/, `${path} should read/write photo_alt`);
  }

  const schema = read("supabase/schema-phase5.sql");
  assert.match(schema, /products\s+add column if not exists image_url/i);
  assert.match(schema, /products\s+add column if not exists photo_alt/i);
});
