import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductOffers,
  injectProductOffers,
} from "../functions/_lib/product-offer-jsonld.js";
import { handleProductPage } from "../functions/products/_middleware.js";

const PRODUCT_HTML = `<!doctype html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"MASEST Consulting LLC"},{"@type":"Product","name":"VertKleen HCR","sku":"VK-HCR","url":"https://masest.co/products/hcr"}]}</script>
</head><body>HCR</body></html>`;

const PRICING = {
  currency: "usd",
  variants: [
    {
      vsku: "VK-HCR-1G",
      product_sku: "hcr",
      product_name: "VertKleen HCR",
      label: "1 gal jug",
      active: true,
      product_mode: "buy",
      tiers: { retail: 21.63, hvac: 24.72 },
    },
    {
      vsku: "VK-HCR-2.5G",
      product_sku: "hcr",
      product_name: "VertKleen HCR",
      label: "2.5 gal jug",
      active: true,
      product_mode: "buy",
      stock: 0,
      track_stock: true,
      allow_backorder: true,
      tiers: { retail: 54.08 },
    },
    {
      vsku: "VK-HCR-5G",
      product_sku: "hcr",
      product_name: "VertKleen HCR",
      label: "5 gal pail",
      active: true,
      product_mode: "buy",
      stock: 0,
      track_stock: true,
      allow_backorder: false,
      tiers: { retail: 108.15 },
    },
    {
      vsku: "VK-HCR-55G",
      product_sku: "hcr",
      product_name: "VertKleen HCR",
      label: "55 gal drum",
      active: false,
      product_mode: "buy",
      tiers: { retail: 925.44 },
    },
    {
      vsku: "VK-HCR-QUOTE",
      product_sku: "hcr",
      product_name: "VertKleen HCR",
      label: "quoted configuration",
      active: true,
      product_mode: "quote",
      tiers: { retail: 500 },
    },
    {
      vsku: "VK-CR-1G",
      product_sku: "cr",
      product_name: "VertKleen CIP CR",
      label: "1 gal jug",
      active: true,
      product_mode: "buy",
      tiers: { retail: 19.27 },
    },
  ],
};

function productNode(html) {
  const body = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  const parsed = JSON.parse(body || "null");
  return (parsed?.["@graph"] || [parsed]).find((node) => node?.["@type"] === "Product");
}

test("buildProductOffers emits active buy variants with CMS prices and stock-aware availability", () => {
  const offers = buildProductOffers({
    productSku: "hcr",
    pageUrl: "https://masest.co/products/hcr",
    pricing: PRICING,
  });

  assert.deepEqual(offers, [
    {
      "@type": "Offer",
      sku: "VK-HCR-1G",
      name: "VertKleen HCR — 1 gal jug",
      price: "21.63",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      url: "https://masest.co/products/hcr",
      seller: { "@type": "Organization", name: "MASEST Consulting LLC" },
    },
    {
      "@type": "Offer",
      sku: "VK-HCR-2.5G",
      name: "VertKleen HCR — 2.5 gal jug",
      price: "54.08",
      priceCurrency: "USD",
      availability: "https://schema.org/BackOrder",
      itemCondition: "https://schema.org/NewCondition",
      url: "https://masest.co/products/hcr",
      seller: { "@type": "Organization", name: "MASEST Consulting LLC" },
    },
    {
      "@type": "Offer",
      sku: "VK-HCR-5G",
      name: "VertKleen HCR — 5 gal pail",
      price: "108.15",
      priceCurrency: "USD",
      availability: "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      url: "https://masest.co/products/hcr",
      seller: { "@type": "Organization", name: "MASEST Consulting LLC" },
    },
  ]);
});

test("injectProductOffers adds the CMS offers to the existing Product node", () => {
  const offers = buildProductOffers({
    productSku: "hcr",
    pageUrl: "https://masest.co/products/hcr",
    pricing: PRICING,
  });
  const html = injectProductOffers(PRODUCT_HTML, offers);
  const product = productNode(html);

  assert.equal(product.offers.length, 3);
  assert.equal(product.offers[0].sku, "VK-HCR-1G");
  assert.equal(product.name, "VertKleen HCR");
});

test("injectProductOffers safely escapes CMS text inside the JSON-LD script", () => {
  const offers = buildProductOffers({
    productSku: "hcr",
    pageUrl: "https://masest.co/products/hcr",
    pricing: {
      ...PRICING,
      variants: [{
        ...PRICING.variants[0],
        label: "1 gal </script><script>alert(1)</script>",
      }],
    },
  });
  const html = injectProductOffers(PRODUCT_HTML, offers);

  assert.doesNotMatch(html, /1 gal <\/script>/);
  assert.equal(productNode(html).offers[0].name, "VertKleen HCR — 1 gal </script><script>alert(1)</script>");
});

test("product middleware returns CMS Offer JSON-LD in the initial HTML response", async () => {
  const response = await handleProductPage({
    request: new Request("https://masest.co/products/hcr"),
    env: {},
    next: async () => new Response(PRODUCT_HTML, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        etag: "static-asset-etag",
      },
    }),
  }, {
    loadPricing: async (_env, productSku) => {
      assert.equal(productSku, "hcr");
      return { data: PRICING, error: null };
    },
  });
  const html = await response.text();

  assert.equal(productNode(html).offers.length, 3);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("etag"), false);
});

test("product middleware maps the editorial crhd route to the CMS cr-hd SKU", async () => {
  let loadedSku = "";
  await handleProductPage({
    request: new Request("https://masest.co/products/crhd"),
    env: {},
    next: async () => new Response(PRODUCT_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  }, {
    loadPricing: async (_env, productSku) => {
      loadedSku = productSku;
      return { data: PRICING, error: null };
    },
  });

  assert.equal(loadedSku, "cr-hd");
});

test("product middleware fails open when CMS pricing is unavailable", async () => {
  const response = await handleProductPage({
    request: new Request("https://masest.co/products/hcr"),
    env: {},
    next: async () => new Response(PRODUCT_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  }, {
    loadPricing: async () => ({ data: null, error: new Error("pricing_unavailable") }),
  });

  assert.equal(await response.text(), PRODUCT_HTML);
});
