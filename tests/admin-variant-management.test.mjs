import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readRoot = (path) => readFileSync(new URL(`../${path.replace(/^site\//, "")}`, import.meta.url), "utf8");

test("admin UI can add, edit, and remove purchasable volume variants", () => {
  const html = read("admin.html");
  const admin = read("js/admin.js");

  for (const id of ["variantForm", "nvProductSku", "nvSku", "nvLabel", "nvGallons", "nvPrice", "nvStock"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }

  assert.match(admin, /product_variants/, "product table should render variants");
  assert.match(admin, /saveVariantRow/, "admin should save variant row edits");
  assert.match(admin, /removeVariant/, "admin should remove variants");
  assert.match(admin, /wireVariantForm/, "admin should add variants from a form");
});

test("admin product API supports variant read/write/delete contracts", () => {
  for (const path of [
    "site/functions/api/admin/products.js",
    "site/functions/api/admin/products.js",
  ]) {
    const source = readRoot(path);
    assert.match(source, /product_variants\(/, `${path} should select nested variants`);
    assert.match(source, /normalizeVariant/, `${path} should validate variant writes`);
    assert.match(source, /from\('product_variants'\)\.upsert/, `${path} should upsert variants`);
    assert.match(source, /body\.vsku/, `${path} should delete/deactivate by vsku`);
  }
});
