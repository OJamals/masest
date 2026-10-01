import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { findAll, attr } from "../tools/html-query.mjs";
import { waterGuides, renderHvacWaterHub } from "../tools/hvac-water-page.mjs";
import { waterProgramFeatures, renderWaterPrograms, initWaterPrograms } from "../js/main/water-programs.js";
import { industryDiscoveryMatches } from "../js/main/engagement.js";

const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const registry = JSON.parse(read("data/industry-applications.json")).industries;
const equipmentSlugs = ["data-centers", "education", "healthcare", "hvac-water", "mechanical-contractors-water-treatment", "municipalities-water-utilities"];

test("equipment recommendations, job paths, and document ownership use HVAC identities", () => {
  for (const slug of equipmentSlugs) {
    const industry = registry.find((i) => i.slug === slug);
    for (const ids of [industry.products, industry.document_products, ...Object.values(industry.job_paths)]) {
      assert.ok(!ids.includes("hcr") && !ids.includes("cr"), slug + ": CIP ID leaked into equipment selection");
    }
    const html = read("industries/" + slug + ".html");
    assert.match(html, /href="(?:\.\.\/|\/)products\/hcr-t16"/, slug);
    assert.doesNotMatch(html, /href="(?:\.\.\/|\/)products\/(?:hcr|cr)"/, slug);
  }
  const brewery = registry.find((i) => i.slug === "breweries-distilleries-wineries");
  assert.ok(brewery.products.includes("hcr") && brewery.products.includes("cr"), "process CIP records stay distinct");
});

test("industry search combines all search terms with optional job and clear returns all", () => {
  const route = { text: "Data Centers Cooling Towers Mineral Scale", jobs: "descale cooling-water" };
  assert.equal(industryDiscoveryMatches(route, {}), true);
  assert.equal(industryDiscoveryMatches(route, { q: "COOLING scale" }), true);
  assert.equal(industryDiscoveryMatches(route, { q: "cooling grease" }), false);
  assert.equal(industryDiscoveryMatches(route, { q: "scale", job: "descale" }), true);
  assert.equal(industryDiscoveryMatches(route, { q: "scale", job: "cip" }), false);
});

test("recirculation directions preserve preparation, water-test, rinse, and restart order", () => {
  const guide = waterGuides.guides.find((g) => g.id === "recirculation");
  assert.deepEqual(guide.steps.map((s) => s.title), [
    "Baseline and isolate", "Build and water-test the circuit", "Charge the approved solution",
    "Circulate and log", "Drain and rinse", "Restart and hand off",
  ]);
  assert.match(guide.prepare, /metallurgy.*isolated volume.*concentration.*contact time.*rinse limits/);
  assert.match(guide.steps[3].detail, /pH alone does not prove/);
  assert.match(guide.stop, /live potable-water circuit/);
  assert.match(guide.record, /rinse acceptance.*owner sign-off/);
  for (const g of waterGuides.guides) assert.ok(g.prepare && g.stop && g.record && g.steps.length >= 4);
});

test("hub inquiry retains task and industry while static cards retain exact HVAC identities", () => {
  const industry = registry.find((i) => i.slug === "hvac-water");
  const html = renderHvacWaterHub({ ...industry, sub: industry.marketing });
  const primary = findAll(html, { tag: "a", attrs: { "data-system-primary-cta": null } })[0];
  const params = new URL(attr(primary, "href"), "https://masest.co/industries/hvac-water").searchParams;
  assert.equal(params.get("industry"), "HVAC & Water Systems");
  assert.equal(params.get("type"), "audit");
  assert.match(params.get("message"), /System volume:.*Buildup\/water analysis:/s);
  const grid = findAll(html, { attrs: { "data-ind-products": null } })[0];
  const products = attr(grid, "data-ind-products").split(" ");
  assert.ok(products.includes("hcr-t16"));
  assert.ok(products.includes("cr2"));
});

test("service-level renderer uses pricing owner's service features and excludes legacy chemical bundles", () => {
  const features = ["WaterSafe60, Purgo, DBNPA, HCR", "Quarterly visit and water test", "Manual dosing", "Everything in Gold, plus DDC design and commissioning"];
  assert.deepEqual(waterProgramFeatures(features), ["Quarterly visit and water test", "Manual dosing", "Adds DDC design and commissioning"]);
  const html = renderWaterPrograms([{ name: 'Essentials <script>', tier: "Bronze", price: "$385-715", features }]);
  assert.doesNotMatch(html, /DBNPA|<script>/);
  assert.match(html, /Essentials &lt;script&gt;/);
  const link = findAll(html, { tag: "a" })[0];
  const params = new URL(attr(link, "href"), "https://masest.co").searchParams;
  assert.equal(params.get("type"), "program");
  assert.equal(params.get("industry"), "HVAC & Water Systems");
  assert.match(params.get("message"), /Water-treatment service level: Essentials <script>/);
});

test("service-level request fails to a usable quote path and can recover on next initialization", async () => {
  const priorDocument = globalThis.document;
  const priorFetch = globalThis.fetch;
  const mount = { innerHTML: "" }, status = { textContent: "" };
  globalThis.document = { querySelector: (selector) => selector === "[data-water-programs]" ? mount : status };
  try {
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await initWaterPrograms();
    assert.equal(mount.innerHTML, "");
    assert.match(status.textContent, /Request the current comparison/);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ pricing_tiers: [{ name: "Essentials", price: "$385-715", features: ["Quarterly visit and water test"] }] }) });
    await initWaterPrograms();
    assert.match(mount.innerHTML, /Quarterly visit and water test/);
    assert.match(status.textContent, /Current published service levels/);
  } finally {
    globalThis.document = priorDocument;
    globalThis.fetch = priorFetch;
  }
});
