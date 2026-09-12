import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CATALOG_GROUPS, CATALOG_ORDER } from "../js/main/catalog-data.js";
import { catalogCard } from "../js/main/commerce-ui.js";
import {
  MARINE_CATALOG_GROUP,
  loadMarineCatalog,
  marineSearchRow,
  parseMarineCatalog,
} from "../js/main/marine-catalog.js";
import { rankProductIds } from "../js/main/product-search.js";

const payload = JSON.parse(readFileSync(new URL("../data/industry-applications.json", import.meta.url), "utf8"));
const expectedNames = [
  "Scale Buster",
  "SeaVap Coil Kleener",
  "Sea Drain Kleener",
  "MultiWash Marine",
  "Marine Degreaser",
  "AlumiBrite Marine",
  "Marine Wash & Wax",
  "Marine Antimicrobial",
];

test("marine catalog derives eight cards from owner-approved metadata", () => {
  const entries = parseMarineCatalog(payload);

  assert.deepEqual(MARINE_CATALOG_GROUP, { key: "marine", label: "Marine Line" });
  assert.equal(CATALOG_GROUPS.some(({ label }) => /marine/i.test(label)), false);
  assert.equal(entries.length, 8);
  assert.deepEqual(entries.map(({ name }) => name), expectedNames);
  assert.equal(new Set(entries.map(({ id }) => id)).size, entries.length);

  for (const entry of entries) {
    assert.ok(CATALOG_ORDER.includes(entry.id), `${entry.name}: reuse published base product`);
    assert.match(entry.sku, /^VK-/);
    assert.equal(entry.market, "marine");
    // SQ-17: root-absolute — a relative "products/<id>" resolved to
    // "/products/products/<id>" from anywhere but /products itself.
    assert.equal(entry.href, `/products/${entry.id}?market=marine`);
    assert.match(entry.image, /^\/img\/products\/vertkleen-.+-marine-studio\.webp$/);
    assert.ok(entry.summary.length > 20);
  }
});

test("marine catalog fails closed without approved release metadata", () => {
  const changed = structuredClone(payload);
  changed.industries.find(({ slug }) => slug === "marine").marine_brand_release.status = "draft";
  assert.deepEqual(parseMarineCatalog(changed), []);

  const malformed = structuredClone(payload);
  delete malformed.industries.find(({ slug }) => slug === "marine").approved_product_names[0].image;
  assert.deepEqual(parseMarineCatalog(malformed), []);

  const untrusted = structuredClone(payload);
  untrusted.industries.find(({ slug }) => slug === "marine").approved_product_names[0].image = "https://example.com/fake-marine-studio.webp";
  assert.deepEqual(parseMarineCatalog(untrusted), []);
});

test("marine catalog accepts only the approved CMS origin for compiled image URLs", () => {
  const compiled = structuredClone(payload);
  const products = compiled.industries.find(({ slug }) => slug === "marine").approved_product_names;
  products.forEach((product) => {
    product.image = `https://media.masest.co/site/${product.image}`;
  });

  const entries = parseMarineCatalog(compiled);
  assert.equal(entries.length, 8);
  assert.ok(entries.every(({ image }) => image.startsWith("https://media.masest.co/site/img/products/")));
});

test("marine catalog loads the public artifact with a source-tree fallback", async () => {
  const requested = [];
  const entries = await loadMarineCatalog(async (url) => {
    requested.push(url);
    if (url === "/data/marine-catalog.json?v=20260912a") return { ok: false };
    return { ok: true, async json() { return payload; } };
  });

  assert.deepEqual(requested, ["/data/marine-catalog.json?v=20260912a", "/data/industry-applications.json"]);
  assert.equal(entries.length, 8);
});

test("marine aliases and job focus are searchable without new product IDs", () => {
  const entries = parseMarineCatalog(payload);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const rowFor = (id) => marineSearchRow({ sku: id, variants: [] }, byId.get(id));
  const ids = entries.map(({ id }) => id);

  assert.equal(rankProductIds(ids, "seavap", rowFor)[0], "descaler");
  assert.equal(rankProductIds(ids, "bilges diesel soot", rowFor)[0], "crhd");
  assert.equal(rankProductIds(ids, "marine antimicrobial", rowFor)[0], "purgo");
});

test("marine catalog cards use alias copy and route while keeping base commerce identity", () => {
  const entry = parseMarineCatalog(payload).find(({ id }) => id === "descaler");
  const html = catalogCard(entry.id, true, entry);

  assert.match(html, /data-id="descaler"/);
  assert.match(html, /data-market="marine"/);
  assert.match(html, /href="\/products\/descaler\?market=marine"/);
  assert.match(html, />SeaVap Coil Kleener<\/b>/);
  // SQ-13: the description sentence is dropped from the card — it was one of
  // the two blocks (with FITS/RESULTS) that made every row's height depend on
  // how its own copy happened to wrap. entry.summary itself is still real,
  // owner-approved data (asserted elsewhere in this file); it just renders on
  // the detail page rather than the card now.
  assert.match(html, /src="\/img\/products\/vertkleen-seavap-coil-kleener-v2-marine-studio\.webp"/);
  assert.match(html, /alt="SeaVap Coil Kleener marine product jug"/);
  assert.match(html, /data-commerce-action="descaler"/);
  assert.doesNotMatch(html, /data-commerce-action="seavap/i);
});
