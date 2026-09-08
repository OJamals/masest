import assert from "node:assert/strict";
import test from "node:test";

test("commerce catalog keeps industrial and marine prices isolated while filters switch", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  globalThis.location = { pathname: "/products.html", search: "?category=marine" };
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        products: [{
          products: { sku: "descaler", name: "VertKleen Descaler", active: true, mode: "buy" },
          product_variants: [
            { vsku: "VK-DESC-1G", label: "1 gal jug", gallons: 1, price: 45, currency: "usd", active: true, market: "industrial", marketing_name: "VertKleen Descaler" },
            { vsku: "SVC-1G", label: "1 gal jug", gallons: 1, price: 31.99, currency: "usd", active: true, market: "marine", marketing_name: "SeaVap Coil Kleener" },
          ],
        }],
      };
    },
  });

  try {
    const { catalogCard, loadCommerceCatalog } = await import("../js/main/commerce-ui.js");
    const { parseMarineCatalog } = await import("../js/main/marine-catalog.js");
    const payload = (await import("node:fs")).readFileSync(new URL("../data/industry-applications.json", import.meta.url), "utf8");
    const marine = parseMarineCatalog(JSON.parse(payload)).find(({ id }) => id === "descaler");

    await loadCommerceCatalog();
    assert.match(catalogCard("descaler", false, marine), /<strong class="price-main">\$31\.99<\/strong>/);

    globalThis.location.search = "";
    assert.match(catalogCard("descaler"), /<strong class="price-main">\$45<\/strong>/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.location = originalLocation;
  }
});
