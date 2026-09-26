import assert from "node:assert/strict";
import test from "node:test";

import { onRequestGet, onRequestHead } from "../functions/product.html.js";
import * as extensionless from "../functions/product.js";
import * as legacyContact from "../functions/products/contact.js";
import { handleProductPage } from "../functions/products/_middleware.js";

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

test("Search Console legacy id URLs keep the selected product for GET and HEAD", () => {
  for (const [path, handlers] of [["/product.html", { onRequestGet, onRequestHead }], ["/product", extensionless]]) {
    for (const method of ["GET", "HEAD"]) {
      const response = handlers[method === "GET" ? "onRequestGet" : "onRequestHead"]({
        request: new Request(`https://masest.co${path}?id=hcr`, { method }),
      });
      assert.equal(response.status, 301);
      assert.equal(response.headers.get("location"), "https://masest.co/products/hcr");
      assert.equal(response.body, null);
    }
  }
});

test("legacy id aliases normalize and sku remains authoritative when both are supplied", () => {
  for (const [query, expected] of [["id=CR-HD", "crhd"], ["sku=cr&id=hcr", "cr"]]) {
    const response = extensionless.onRequestGet({ request: new Request(`https://masest.co/product?${query}`) });
    assert.equal(response.headers.get("location"), `https://masest.co/products/${expected}`);
  }
  for (const query of ["", "?id=%2F%2Fevil.example", "?id=..%2Fcontact"]) {
    const response = extensionless.onRequestGet({ request: new Request(`https://masest.co/product${query}`) });
    assert.equal(response.headers.get("location"), "https://masest.co/products");
  }
});

test("legacy product quote links preserve prefill through the existing product middleware", async () => {
  const request = new Request("https://masest.co/products/contact?type=quote&product=VertKleen%20Neutral&utm_source=legacy");
  const response = await handleProductPage({
    request,
    next: async () => legacyContact.onRequestGet({ request }),
  }, { loadPricing: () => { throw new Error("redirect must not request pricing"); } });
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://masest.co/contact?type=quote&product=VertKleen%20Neutral&utm_source=legacy");
  const head = legacyContact.onRequestHead({ request: new Request(request.url, { method: "HEAD" }) });
  assert.equal(head.headers.get("location"), response.headers.get("location"));
  assert.equal(head.body, null);
});
