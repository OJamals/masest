import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const exists = (path) => existsSync(new URL(path, root));

const priorityIndustries = [
  ["data-centers", "Data Centers", "Cooling tower scale, Legionella compliance, green mandates", "watersafe60 hcr descaler", "Schedule a water-treatment audit."],
  ["golf-courses", "Golf Courses", "Equipment, carts, irrigation scale, exterior stains", "torque lam3 hcr multiwash", "Request grounds-crew trial"],
  ["solar-panel-cleaning", "Solar / Panel Cleaning", "Soft-wash at scale without panel damage", "multiwash lam3", "Request per-MW quote"],
  ["municipalities-water-utilities", "Municipalities & Water Utilities", "NSF-60 requirements, worker safety, bids", "cr2 watersafe60 hcr", "Get on our bid list"],
  ["hotels-property-management", "Hotels / Property Management", "Facades, pools, restrooms, HVAC", "multiwash lam3 descaler neutral", "Request property walkthrough"],
];

const comparisonPages = [
  ["comparisons/vertkleen-hcr-vs-clr.html", "VertKleen HCR vs CLR", "$21.63/gal", "CLR PRO MAX", "DDC Engineering"],
  ["comparisons/hcr-vs-rydlyme.html", "HCR vs RYDLYME", "$21.63/gal", "$34.00-$48.60/gal", "DDC Engineering"],
  ["comparisons/cr-hd-vs-simple-green.html", "CR HD vs Simple Green", "$10.61/gal", "$13.20-$36.80/gal", "Walmart"],
  ["comparisons/lam3-vs-wet-forget.html", "LAM3 vs Wet & Forget", "$22.21/gal", "$34.00/gal", "Wet & Forget"],
  ["comparisons/beer-line-cleaner-cost-comparison.html", "Beer line cleaner cost comparison", "$22.02/gal", "$38.85/gal", "Brewlando"],
];

test("priority 2 target industry pages exist with workbook-specified products and CTAs", () => {
  const index = read("industries.html");
  const contact = read("contact.html");
  const sitemap = read("sitemap.xml");

  assert.match(contact, /<option>Data Centers<\/option>/, "contact form should expose Data Centers as an industry");

  for (const [slug, name, problem, products, cta] of priorityIndustries) {
    const path = `industries/${slug}.html`;
    assert.equal(exists(path), true, `${path} should exist`);

    const html = read(path);
    assert.match(index, new RegExp(`href="industries/${slug}"`), `${name} should be linked from industries index`);
    assert.match(sitemap, new RegExp(`https://masest\\.co/industries/${slug}`), `${name} should be in sitemap`);
    assert.match(html, new RegExp(`<title>${name.replace(/&/g, "&amp;")} \\| MASEST VertKleen</title>`));
    assert.match(html, new RegExp(problem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(`data-ind-products="${products}"`), `${name} should use the specified hero products`);
    assert.match(html, new RegExp(cta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${name} CTA should match the workbook`);
    assert.match(html, new RegExp(`data-cms-content="page_sections" data-cms-page="industries/${slug}" data-cms-region="body"`), `${name} should expose a CMS page-section mount`);
    assert.match(html, /href="\.\.\/contact\?industry=.*&type=/, `${name} primary CTA should prefill CRM quote fields`);
  }
});

test("priority 2 comparison landing pages include price math, swap row, proof point, and quote CTA", () => {
  const sitemap = read("sitemap.xml");

  for (const [path, title, vkMath, marketMath, proof] of comparisonPages) {
    assert.equal(exists(path), true, `${path} should exist`);
    const html = read(path);
    const route = path.replace(/\.html$/, "");
    assert.match(sitemap, new RegExp(`https://masest\\.co/${route}`), `${route} should be in sitemap`);
    assert.match(html, new RegExp(`<title>${title.replace(/&/g, "&amp;")} \\| MASEST VertKleen</title>`));
    assert.match(html, new RegExp(vkMath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${title} should show VertKleen per-gallon math`);
    assert.match(html, new RegExp(marketMath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${title} should show competitor per-gallon math`);
    assert.match(html, /<table class="cmp-table comparison-swap-table">/, `${title} should include the swap-table row`);
    assert.match(html, new RegExp(proof.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${title} should include a proof point`);
    assert.match(html, /href="\.\.\/contact\?type=quote/, `${title} should route quote CTA to the quote form`);
    assert.match(html, new RegExp(`data-cms-content="page_sections" data-cms-page="${route}" data-cms-region="body"`), `${title} should expose a CMS page-section mount`);
  }
});

test("CIP pricing route is backed by the full Tab 3 row set", () => {
  const data = JSON.parse(read("data/segment-pricing.json"));
  const cip = data.segments.find((segment) => segment.slug === "cip-food-beverage");
  assert.ok(cip, "CIP Food & Beverage segment should exist");
  assert.equal(cip.rows.length, 31, "CIP Tab 3 has 31 public rows");
  assert.equal(cip.rows.find((row) => row.sku === "VK-CR-1G")?.price_per_unit, "22.02");
  assert.equal(cip.rows.find((row) => row.sku === "VK-HCR-2.5G")?.price_per_unit, "61.80");
  assert.equal(cip.rows.find((row) => row.sku === "VK-PRG-2.5G")?.price_per_unit, "53.73");
});
