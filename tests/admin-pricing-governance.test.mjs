import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("admin catalog presents workbook pricing as read-only", () => {
  const html = read("admin.html");
  const products = read("js/admin/products.js");
  const pricing = read("js/admin/pricing.js");

  assert.match(html, /id="catalogPriceGovernance"[\s\S]*VertKleen_Website_Pricing_WebDev\.xlsx[\s\S]*npm run seed/);
  assert.match(html, /id="npPrice"[^>]*readonly/);
  assert.match(html, /id="nvPrice"[^>]*readonly/);
  assert.doesNotMatch(products, /data-field="price"/);
  assert.doesNotMatch(products, /data-vfield="price"/);
  assert.doesNotMatch(products, /price:\s*\$\('n[vp]Price'\)/);
  assert.doesNotMatch(pricing, /data-price-tier=/);
  assert.doesNotMatch(pricing, /method:\s*'POST'/);
});

test("admin APIs reject direct price mutations", () => {
  const productsApi = read("functions/api/admin/products.js");
  const tiersApi = read("functions/api/admin/variant-pricing.js");

  assert.match(productsApi, /includesManagedPrice\(body\.variant\)[\s\S]*price_workbook_managed/);
  assert.match(productsApi, /includesManagedPrice\(productInput\)[\s\S]*price_workbook_managed/);
  assert.match(tiersApi, /request\.method === 'POST'[\s\S]*return json\(409,[\s\S]*price_workbook_managed/);
});
