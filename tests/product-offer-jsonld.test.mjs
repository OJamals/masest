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

const EXPECTED_RETURN_POLICY = {
  "@type": "MerchantReturnPolicy",
  applicableCountry: "US",
  returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
  merchantReturnDays: 30,
  returnMethod: "https://schema.org/ReturnByMail",
  returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
  itemCondition: "https://schema.org/NewCondition",
  merchantReturnLink: "https://masest.co/shipping-returns",
};

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
    // The marine line rebrands the same product row, so it shares `product_sku`
    // and is separated only by `market`.
    {
      vsku: "VK-SB-1G",
      product_sku: "hcr",
      product_name: "Scale Buster",
      label: "1 gal jug",
      market: "marine",
      active: true,
      product_mode: "buy",
      tiers: { retail: 64.99 },
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
      hasMerchantReturnPolicy: EXPECTED_RETURN_POLICY,
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
      hasMerchantReturnPolicy: EXPECTED_RETURN_POLICY,
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
      hasMerchantReturnPolicy: EXPECTED_RETURN_POLICY,
    },
  ]);
});

test("buildProductOffers keeps the marine line out of the industrial product page", () => {
  const industrial = buildProductOffers({
    productSku: "hcr",
    pageUrl: "https://masest.co/products/hcr",
    pricing: PRICING,
  });

  assert.deepEqual(industrial.map((offer) => offer.sku), ["VK-HCR-1G", "VK-HCR-2.5G", "VK-HCR-5G"]);
  assert.equal(industrial.some((offer) => /Scale Buster/.test(offer.name)), false);
  // The published price range must match the buybar the page renders, not the
  // union of every market that shares this product_sku.
  assert.equal(Math.max(...industrial.map((offer) => Number(offer.price))), 108.15);

  const marine = buildProductOffers({
    productSku: "hcr",
    pageUrl: "https://masest.co/products/hcr",
    pricing: PRICING,
    market: "marine",
  });

  assert.deepEqual(marine.map((offer) => offer.sku), ["VK-SB-1G"]);
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
  assert.deepEqual(product.offers[0].hasMerchantReturnPolicy, EXPECTED_RETURN_POLICY);
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

test("product middleware returns the branded 404 before a held product asset can be served", async () => {
  let requestedAssetPath = "";
  const response = await handleProductPage({
    request: new Request("https://masest.co/products/cr60"),
    env: {},
    next: async (request) => {
      requestedAssetPath = request ? new URL(request.url).pathname : "/products/cr60";
      return new Response("<!doctype html><title>Page Not Found | MASEST VertKleen</title>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          etag: "404-static-asset-etag",
        },
      });
    },
  });
  const html = await response.text();

  assert.equal(response.status, 404);
  assert.equal(requestedAssetPath, "/404");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-robots-tag"), "noindex");
  assert.equal(response.headers.has("etag"), false);
  assert.match(html, /Page Not Found/);
  assert.doesNotMatch(html, /CR60/);
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
