import assert from "node:assert/strict";
import test from "node:test";

import { onRequestGet } from "../functions/product.html.js";

// SQ-17: /product.html?sku=<id> 404s — there's no product.html file, and
// nothing redirected the legacy URL shape to the live /products/<id> route.

test("legacy /product.html?sku=<id> redirects to the live product route", async () => {
  const response = onRequestGet({
    request: new Request("https://masest.co/product.html?sku=hcr"),
  });

  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://masest.co/products/hcr");
});

test("legacy sku alias maps to its current route slug", async () => {
  // The CMS sku is "cr-hd"; the route is "crhd" (see
  // functions/products/_middleware.js's PRODUCT_SKU_ALIASES). Old links used
  // the CMS sku directly, so the redirect has to know both spellings.
  const response = onRequestGet({
    request: new Request("https://masest.co/product.html?sku=cr-hd"),
  });

  assert.equal(response.headers.get("location"), "https://masest.co/products/crhd");
});

test("legacy sku lookup is case-insensitive", async () => {
  const response = onRequestGet({
    request: new Request("https://masest.co/product.html?sku=HCR"),
  });

  assert.equal(response.headers.get("location"), "https://masest.co/products/hcr");
});

test("a bare /product.html with no sku goes to the catalog, not a dead end", async () => {
  const response = onRequestGet({
    request: new Request("https://masest.co/product.html"),
  });

  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://masest.co/products");
});

test("an unrecognized sku shape falls back to the catalog instead of forwarding it verbatim", async () => {
  const response = onRequestGet({
    request: new Request("https://masest.co/product.html?sku=%3Cscript%3E"),
  });

  assert.equal(response.headers.get("location"), "https://masest.co/products");
});

test("redirect preserves the request's own origin", async () => {
  const response = onRequestGet({
    request: new Request("http://localhost:4195/product.html?sku=crhd"),
  });

  assert.equal(response.headers.get("location"), "http://localhost:4195/products/crhd");
});
