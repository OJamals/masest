import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const PUBLIC = ["index.html", "about.html", "contact.html", "products.html", "programs.html", "proof.html", "resources.html", "industries.html", "industries/oil-gas.html"];
const PRIVATE = ["account.html", "admin.html", "dashboard.html", "cart.html", "order-confirmed.html"];

test("public pages carry canonical + og:url + og:image", () => {
  for (const p of PUBLIC) {
    const h = read(p);
    assert.match(h, /rel="canonical"/, `${p} missing canonical`);
    assert.match(h, /property="og:url"/, `${p} missing og:url`);
    assert.match(h, /property="og:image"/, `${p} missing og:image`);
  }
});

test("og:image is the dedicated social card, not the logo placeholder", () => {
  for (const p of PUBLIC) {
    const h = read(p);
    const m = h.match(/property="og:image"\s+content="([^"]+)"/);
    assert.ok(m, `${p} missing og:image content`);
    assert.match(m[1], /\/img\/og-card\.png$/, `${p} og:image should be /img/og-card.png`);
    assert.doesNotMatch(m[1], /masest-logo/, `${p} og:image still points at the logo placeholder`);
  }
});

test("public pages declare twitter:card summary_large_image", () => {
  for (const p of PUBLIC) {
    assert.match(read(p), /name="twitter:card"\s+content="summary_large_image"/, `${p} missing twitter:card`);
  }
});

test("home page exposes Organization/WebSite JSON-LD", () => {
  const h = read("index.html");
  assert.match(h, /application\/ld\+json/, "index missing JSON-LD");
  const block = h.match(/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => JSON.parse(block), "index JSON-LD must be valid JSON");
});

test("private/transactional pages are noindex", () => {
  for (const p of PRIVATE) {
    assert.match(read(p), /name="robots"\s+content="noindex/, `${p} should be noindex`);
  }
});

test("sitemap lists industry and product detail pages as final URLs", () => {
 const xml = read("sitemap.xml");
 assert.match(xml, /https:\/\/masest\.co\/industries\/oil-gas/, "sitemap missing industry pages");
 assert.match(xml, /https:\/\/masest\.co\/products\/hcr/, "sitemap missing product detail pages");
 assert.doesNotMatch(xml, /<loc>https:\/\/masest\.co\/[^<]+\.html<\/loc>/, "sitemap should list final extensionless URLs");
 const locs = [...xml.matchAll(/<loc>([^<]+)/g)].map((m) => m[1]);
 assert.equal(locs.length, new Set(locs).size, "sitemap has duplicate <loc> entries");
});
test("product no-script fallback starts with an h1", () => {
  const html = read("product.html");
  const fallback = html.match(/<noscript>[\s\S]*?<\/noscript>/i)?.[0] || "";
  const firstHeading = fallback.match(/<h([1-6])\b/i)?.[1];

  assert.equal(firstHeading, "1");
  assert.match(fallback, /Find the VertKleen replacement before the next PO\./);
});
