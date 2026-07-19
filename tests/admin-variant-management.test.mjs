import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readRoot = (path) => readFileSync(new URL(`../${path.replace(/^site\//, "")}`, import.meta.url), "utf8");

test("admin UI can add, edit, and remove purchasable volume variants", () => {
  const html = read("admin.html");
  // Products tab (incl. variant CRUD) split into its own module in #36.
  assert.match(html, /<script type="module" src="js\/admin\.js\?v=\d{8}[a-z]"><\/script>/, "admin entry module should be cache-busted");
  assert.match(read("js/admin.js"), /import\(\s*["']\.\/admin\/products\.js\?v=\d{8}[a-z]["']\s*\)/, "admin should lazy-import a cache-busted products module");
  const admin = read("js/admin/products.js");

  for (const id of ["variantForm", "nvProductSku", "nvSku", "nvLabel", "nvGallons", "nvPrice", "nvStock"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }

  assert.match(admin, /product_variants/, "product table should render variants");
  assert.match(admin, /saveVariantRow/, "admin should save variant row edits");
  assert.match(admin, /removeVariant/, "admin should remove variants");
  assert.match(admin, /wireVariantForm/, "admin should add variants from a form");
  assert.match(admin, /confirmDialog\(`Remove \$\{vsku\}\? Existing order history stays intact\./, "variant removal should present a Remove confirmation");
  assert.match(admin, /body:\s*\{\s*vsku,\s*hard:\s*true\s*\}/, "variant removal should request a hard delete");
  assert.match(admin, /Variant removed\./, "variant removal should report removal");
  assert.doesNotMatch(admin, /Deactivate \$\{vsku\}/, "variant removal should not use deactivation copy");
  assert.doesNotMatch(admin, /Variant deactivated\./, "variant removal should not report soft deactivation");
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
    assert.match(source, /body\.hard[\s\S]*?query\.delete\(\)\.eq\('vsku',\s*vsku\)/, `${path} should hard-delete variants when requested`);
  }
});
