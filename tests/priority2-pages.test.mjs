import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const exists = (path) => existsSync(new URL(path, root));

const priorityIndustries = [
  ["data-centers", "Data Centers", "Cooling tower scale, Legionella compliance, green mandates", "watersafe60 hcr descaler", "Schedule a water-treatment audit."],
  ["golf-courses", "Golf Courses", "Equipment, carts, irrigation scale, exterior stains", "torque lam3 hcr multiwash purgo", "Request grounds-crew trial"],
  ["solar-panel-cleaning", "Solar / Panel Cleaning", "Soft-wash at scale without panel damage", "multiwash lam3", "Request per-MW quote"],
  ["municipalities-water-utilities", "Municipalities & Water Utilities", "NSF-60 requirements, worker safety, bids", "cr2 watersafe60 hcr", "Get on our bid list"],
  ["hotels-property-management", "Hotels / Property Management", "Facades, pools, restrooms, HVAC", "multiwash lam3 descaler neutral", "Request property walkthrough"],
];

const tab4IndustryPages = [
  ["schools-universities", "Schools &amp; Universities", "HVAC scale, coil maintenance, and hazmat chemicals near kids", "descaler hcr multiwash", "Request district pricing"],
  ["mechanical-contractors-water-treatment", "Mechanical Contractors &amp; Water Treatment", "Callback-driven descaling and hazmat handling costs", "hcr descaler watersafe60", "Open a contractor account"],
  ["breweries-distilleries-wineries", "Breweries, Distilleries &amp; Wineries", "CIP acid and caustic hazards", "cr hcr cr-hd-low-foam", "Book a free CIP demo"],
  ["restaurants-commercial-kitchens", "Restaurants &amp; Commercial Kitchens", "Grease, drains, hood filters, and equipment cleaning", "crhd purgo multiwash neutral", "Get a sample kit"],
  ["data-centers", "Data Centers", "Cooling tower scale, Legionella compliance, green mandates", "watersafe60 hcr descaler", "Schedule a water-treatment audit."],
  ["warehousing-distribution-centers", "Warehousing &amp; Distribution Centers", "Floor degreasing at scale", "crhd multiwash", "Request drum pricing"],
  ["hotels-resorts-property-management", "Hotels, Resorts &amp; Property Management", "Facades, pools, restrooms, HVAC", "multiwash lam3 descaler neutral", "Request property walkthrough"],
  ["pressure-washing-soft-wash-contractors", "Pressure-Washing &amp; Soft-Wash Contractors", "Bleach damage, plant kill, and runoff liability", "lam3 multiwash crhd", "Distributor application"],
  ["drone-cleaning-companies", "Drone Cleaning Companies", "safe, drone-rated chemistry", "multiwash lam3 crhd", "Book a drone-wash consult"],
  ["marine-marinas-boatyards", "Marine, Marinas &amp; Boatyards", "Hull scale, salt, wax, and aluminum brightwork", "torque alumibrite hcr", "Get marina bulk pricing"],
  ["aviation-fbos-mro-airports", "Aviation - FBOs, MRO, Airports", "precision degreasing without corrosion", "crhd alumibrite", "Request aviation spec sheet"],
  ["municipalities-water-utilities", "Municipalities &amp; Water Utilities", "NSF-60 requirements, worker safety, bids", "cr2 watersafe60 hcr", "Get on our bid list"],
  ["golf-courses-sports-facilities", "Golf Courses &amp; Sports Facilities", "Equipment, carts, irrigation scale, exterior stains", "torque lam3 hcr multiwash purgo", "Request grounds-crew trial"],
  ["healthcare-senior-living", "Healthcare &amp; Senior Living", "Cleaning near vulnerable people", "neutral multiwash descaler", "Request facilities assessment"],
  ["fleet-trucking-car-washes", "Fleet, Trucking &amp; Car Washes", "Degreasing, wash and wax", "torque crhd multiwash alumibrite", "Fleet program pricing"],
  ["oil-gas-industrial-plants", "Oil &amp; Gas / Industrial Plants", "Tank cleaning, scale", "hcr cr crhd", "Talk to an EHS consultant"],
  ["food-processing-agriculture", "Food Processing &amp; Agriculture", "CIP, organic residue", "cr hcr cr-hd-low-foam", "Request plant trial"],
  ["solar-farms-panel-cleaning", "Solar Farms &amp; Panel Cleaning", "Soft-wash at scale without panel damage", "multiwash lam3", "Request per-MW quote"],
];

const comparisonPages = [
  ["comparisons/vertkleen-hcr-vs-clr.html", "VertKleen HCR vs CLR", "$21.63/gal", "CLR PRO MAX", "DDC Engineering"],
  ["comparisons/hcr-vs-rydlyme.html", "HCR vs RYDLYME", "$21.63/gal", "$34.00-$48.60/gal", "DDC Engineering"],
  ["comparisons/cr-hd-vs-simple-green.html", "CR HD vs Simple Green", "$10.61/gal", "$13.20-$36.80/gal", "Walmart"],
  ["comparisons/lam3-vs-wet-forget.html", "LAM3 vs Wet & Forget", "$22.21/gal", "$34.00/gal", "Wet & Forget"],
  ["comparisons/beer-line-cleaner-cost-comparison.html", "Beer line cleaner cost comparison", "$22.02/gal", "$38.85/gal", "Brewlando"],
];

const comparisonBlogPosts = [
  ["blog/vertkleen-hcr-vs-clr.html", "VertKleen HCR vs CLR", "$21.63/gal", "CLR PRO MAX", "DDC Engineering"],
  ["blog/hcr-vs-rydlyme.html", "HCR vs RYDLYME", "$21.63/gal", "$34.00-$48.60/gal", "DDC Engineering"],
  ["blog/cr-hd-vs-simple-green.html", "CR HD vs Simple Green", "$10.61/gal", "$13.20-$36.80/gal", "Walmart"],
  ["blog/lam3-vs-wet-forget.html", "LAM3 vs Wet & Forget", "$22.21/gal", "$34.00/gal", "Wet & Forget"],
  ["blog/beer-line-cleaner-cost-comparison.html", "Beer line cleaner cost comparison", "$22.02/gal", "$38.85/gal", "Brewlando"],
];

const industryLabelPages = [
  "food-beverage",
  "breweries-distilleries-wineries",
  "restaurants-commercial-kitchens",
  "food-processing-agriculture",
  "pressure-washing-soft-wash-contractors",
  "drone-cleaning-companies",
  "fleet-trucking-car-washes",
  "golf-courses",
  "golf-courses-sports-facilities",
];

test("product and industry listings stay concise and product-focused", () => {
  const products = read("products.html");
  assert.match(products, /Search by job or current chemical\./);
  assert.doesNotMatch(products, /VertKleen covers acids, caustics, degreasers/);

  for (const slug of industryLabelPages) {
    const html = read(`industries/${slug}.html`);
    assert.doesNotMatch(html, /Published pack prices|1400 gal tote|\(Fortis\)/i, `${slug} should not repeat catalog pricing`);
  }

  const industryCard = read("js/main/commerce-ui.js").match(/export function productCard[\s\S]*?\n}\n/)?.[0] || "";
  assert.doesNotMatch(industryCard, /product-fit-list|product-proof-line/);
});

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

test("Tab 4 industry rows each have a generated landing page", () => {
  const sitemap = read("sitemap.xml");
  const contact = read("contact.html");

  for (const [slug, name, problem, products, cta] of tab4IndustryPages) {
    const path = `industries/${slug}.html`;
    assert.equal(exists(path), true, `${path} should exist`);

    const html = read(path);
    assert.match(sitemap, new RegExp(`https://masest\\.co/industries/${slug}`), `${slug} should be in sitemap`);
    assert.match(html, new RegExp(`<title>${name} \\| MASEST VertKleen</title>`), `${slug} title should match Tab 4 row`);
    assert.match(html, new RegExp(problem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${slug} should include the Tab 4 problem`);
    assert.match(html, new RegExp(`data-ind-products="${products}"`), `${slug} should use the Tab 4 hero products`);
    assert.match(html, new RegExp(cta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${slug} should include the Tab 4 CTA`);
    assert.match(contact, new RegExp(`<option>${name}</option>`), `${name} should be available in the industry dropdown`);
  }
});

test("FB, PW, and gym label variants keep source directions without catalog price duplication", () => {
  const pages = {
    food: read("industries/food-beverage.html"),
    brewery: read("industries/breweries-distilleries-wineries.html"),
    restaurant: read("industries/restaurants-commercial-kitchens.html"),
    pressure: read("industries/pressure-washing-soft-wash-contractors.html"),
    drone: read("industries/drone-cleaning-companies.html"),
    fleet: read("industries/fleet-trucking-car-washes.html"),
    gym: read("industries/golf-courses-sports-facilities.html"),
  };

  assert.match(pages.food, /data-label-variant="fb-cip-cr"/);
  assert.match(pages.food, /cip-hcr-studio\.webp/);
  assert.match(pages.food, /crhd-food-beverage-studio\.webp/);
  assert.match(pages.food, /multiwash-food-beverage-studio\.webp/);
  assert.match(pages.brewery, /0\.5 L per 10 gal/);
  assert.match(pages.restaurant, /Kitchen line — light grease/);
  assert.match(pages.restaurant, /Bar tops, glass &amp; tables/);
  assert.match(pages.restaurant, /<span class="catalog-type">FB label<\/span>/);
  assert.doesNotMatch(pages.restaurant, /Published pack prices|1 gal jug — \$12\.12/);

  for (const html of [pages.pressure, pages.drone]) {
    assert.match(html, /crhd-pressure-wash-studio\.webp/);
    assert.match(html, /crs-pressure-wash-studio\.webp/);
    assert.match(html, /multiwash-pressure-wash-studio\.webp/);
    assert.match(html, /Apply at 1:20 via downstream injector/);
    assert.match(html, /Rust &amp; fertilizer stains/);
    assert.match(html, /<span class="catalog-type">PW label<\/span>/);
    assert.doesNotMatch(html, /Published pack prices|1400 gal tote/);
  }
  assert.match(pages.fleet, /data-label-variant="pw-crhd"/);
  assert.match(pages.fleet, /data-label-variant="pw-multiwash"/);

  assert.match(pages.gym, /multiwash-gym-studio\.webp/);
  assert.match(pages.gym, /purgo-gym-studio\.webp/);
  assert.match(pages.gym, /Floors &amp; tile:<\/strong>&nbsp; Dilute 5:1/);
  assert.match(pages.gym, /High-touch odor:<\/strong>&nbsp; Dilute 1:16/);
  assert.doesNotMatch(pages.gym, /Published pack prices|1 gal jug — \$21\.49/);

  for (const asset of [
    "cip-cr-studio.webp",
    "cip-hcr-studio.webp",
    "crhd-food-beverage-studio.webp",
    "multiwash-food-beverage-studio.webp",
    "crhd-pressure-wash-studio.webp",
    "crs-pressure-wash-studio.webp",
    "multiwash-pressure-wash-studio.webp",
    "multiwash-gym-studio.webp",
    "purgo-gym-studio.webp",
  ]) {
    assert.equal(exists(`img/products/${asset}`), true, `${asset} should exist`);
  }
});

test("industry page images route to industry pages, not proof or contact", () => {
  const html = read("industries.html");
  const sectorData = JSON.parse(read("data/content/industry-sectors.json"));

  for (const match of html.matchAll(/class="(?:row-thumb|proof-thumb)" href="([^"]+)"/g)) {
    assert.match(match[1], /^industries\//, `industry image should link to an industry page: ${match[1]}`);
    assert.doesNotMatch(match[1], /^proof|^contact/, `industry image should not route to proof/contact: ${match[1]}`);
  }

  for (const sector of sectorData.industry_sectors) {
    assert.match(sector.href, /^industries\//, `${sector.slug} CMS image href should route to its industry page`);
    assert.doesNotMatch(sector.href, /^proof|^contact/, `${sector.slug} CMS image href should not route to proof/contact`);
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

test("comparison SEO pages are also generated as blog posts", () => {
  const sitemap = read("sitemap.xml");
  const blogData = JSON.parse(read("data/content/blog.json"));
  const postSlugs = new Set(blogData.blog_posts.map((post) => post.slug));

  for (const [path, title, vkMath, marketMath, proof] of comparisonBlogPosts) {
    const slug = path.replace(/^blog\//, "").replace(/\.html$/, "");
    assert.ok(postSlugs.has(slug), `${slug} should be present in data/content/blog.json`);
    assert.equal(exists(path), true, `${path} should be generated`);

    const html = read(path);
    assert.match(sitemap, new RegExp(`https://masest\\.co/blog/${slug}`), `${slug} blog URL should be in sitemap`);
    assert.match(html, new RegExp(`<title>${title.replace(/&/g, "&amp;")} \\| MASEST VertKleen</title>`));
    assert.match(html, new RegExp(vkMath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${title} blog post should show VertKleen per-gallon math`);
    assert.match(html, new RegExp(marketMath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${title} blog post should show competitor per-gallon math`);
    assert.match(html, /Swap table row/, `${title} blog post should include the swap-table row`);
    assert.match(html, new RegExp(proof.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${title} blog post should include a proof point`);
    assert.match(html, /href="\/contact\?type=quote|href="\/contact\?type=quote&amp;industry=/, `${title} blog post should include a quote CTA`);
  }
});

test("CIP pricing route is backed by the full Tab 3 row set", () => {
  const data = JSON.parse(read("data/segment-pricing.json"));
  const cip = data.segments.find((segment) => segment.slug === "cip-food-beverage");
  assert.ok(cip, "CIP pricing segment should exist");
  assert.equal(cip.rows.length, 31, "CIP Tab 3 has 31 public rows");
  assert.equal(cip.rows.find((row) => row.sku === "VK-CR-1G")?.price_per_unit, "22.02");
  assert.equal(cip.rows.find((row) => row.sku === "VK-HCR-2.5G")?.price_per_unit, "61.80");
  assert.equal(cip.rows.find((row) => row.sku === "VK-CRHD-55G")?.price_per_gallon, "6.40");
  assert.equal(cip.rows.find((row) => row.sku === "VK-PRG-2.5G")?.price_per_unit, "53.73");
});
