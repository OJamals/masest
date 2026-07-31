import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const exists = (path) => existsSync(new URL(path, root));
const managedImages = new Set(
  JSON.parse(read("data/content/site-images.json")).assets.map((asset) => asset.public_url),
);
const industryBySlug = new Map(
  JSON.parse(read("data/industry-applications.json"))
    .industries
    .map((industry) => [industry.slug, industry]),
);
const industryProducts = new Map(
  [...industryBySlug.values()]
    .map((industry) => [industry.slug, industry.products.join(" ")]),
);

const priorityIndustries = [
  "data-centers",
  "golf-courses",
  "solar-panel-cleaning",
  "municipalities-water-utilities",
  "hotels-property-management",
];

const tab4IndustryPages = [
  "education",
  "mechanical-contractors-water-treatment",
  "breweries-distilleries-wineries",
  "restaurants-commercial-kitchens",
  "data-centers",
  "warehousing-distribution-centers",
  "pressure-washing-soft-wash-contractors",
  "drone-cleaning-companies",
  "marine-marinas-boatyards",
  "aviation-fbos-mro-airports",
  "municipalities-water-utilities",
  "healthcare-senior-living",
  "fleet-trucking-car-washes",
  "oil-gas",
  "agriculture",
];

const comparisonPages = [
  ["comparisons/vertkleen-hcr-vs-clr.html", "VertKleen HCR vs CLR", "VertKleen HCR vs CLR: Industrial Descaling", "VK-HCR-5G", "CLR PRO MAX", "controlled mineral-removal"],
  ["comparisons/hcr-vs-rydlyme.html", "HCR vs RYDLYME", "HCR vs RYDLYME: System-Cost Guide", "VK-HCR-5G", "$34.00-$48.60/gal", "controlled mineral removal"],
  ["comparisons/cr-hd-vs-simple-green.html", "CR HD vs Simple Green", "CR HD vs Simple Green: Task-Cost Guide", "VK-CRHD-5G", "$13.20-$36.80/gal", "cost per completed task"],
  ["comparisons/lam3-vs-wet-forget.html", "LAM3 vs Wet & Forget", "LAM3 vs Wet & Forget: Finished-Area Guide", "VK-LAM3-5G", "$34.00/gal", "visibly cleaner hardscape"],
  ["comparisons/beer-line-cleaner-cost-comparison.html", "Beer line cleaner cost comparison", "VertKleen Brewery CIP: Full-Cycle Cost Guide", "VK-CR-2.5G", "$38.85/gal", "Brewlando"],
];

const comparisonBlogPosts = [
  ["blog/vertkleen-hcr-vs-clr.html", "VertKleen HCR vs CLR", "VK-HCR-5G", "CLR PRO MAX", "Carbonate chemistry"],
  ["blog/hcr-vs-rydlyme.html", "HCR vs RYDLYME", "VK-HCR-5G", "$34.00-$48.60/gal", "Field result"],
  ["blog/cr-hd-vs-simple-green.html", "CR HD vs Simple Green", "VK-CRHD-5G", "$13.20-$36.80/gal", "cost per completed task"],
  ["blog/lam3-vs-wet-forget.html", "LAM3 vs Wet & Forget", "VK-LAM3-5G", "$34.00/gal", "Price by treated area"],
  ["blog/beer-line-cleaner-cost-comparison.html", "Beer line cleaner cost comparison", "VK-CR-2.5G", "$38.85/gal", "completed-cycle cost"],
];

const industryLabelPages = [
  "food-beverage",
  "breweries-distilleries-wineries",
  "restaurants-commercial-kitchens",
  "pressure-washing-soft-wash-contractors",
  "drone-cleaning-companies",
  "fleet-trucking-car-washes",
  "golf-courses",
];

test("product and industry listings stay concise and product-focused", () => {
  const products = read("products.html");
  assert.match(products, /Choose chemistry by what you need to remove\./);
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

  for (const slug of priorityIndustries) {
    const { label: name, marketing: problem, cta_label: cta } = industryBySlug.get(slug);
    const path = `industries/${slug}.html`;
    assert.equal(exists(path), true, `${path} should exist`);

    const html = read(path);
    assert.match(index, new RegExp(`href="industries/${slug}"`), `${name} should be linked from industries index`);
    assert.match(sitemap, new RegExp(`https://masest\\.co/industries/${slug}`), `${name} should be in sitemap`);
    assert.match(html, new RegExp(`<title>${name.replace(/&/g, "&amp;")} \\| MASEST VertKleen</title>`));
    assert.match(html, new RegExp(problem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(`data-ind-products="${industryProducts.get(slug)}"`), `${name} should use the canonical starting products`);
    assert.match(html, new RegExp(cta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${name} CTA should match the workbook`);
    assert.match(html, new RegExp(`data-cms-content="page_sections" data-cms-page="industries/${slug}" data-cms-region="body"`), `${name} should expose a CMS page-section mount`);
    assert.match(html, /href="\.\.\/contact\?industry=.*&type=/, `${name} primary CTA should prefill CRM quote fields`);
  }
});

test("Tab 4 industry rows each have a generated landing page", () => {
  const sitemap = read("sitemap.xml");
  const contact = read("contact.html");

  for (const slug of tab4IndustryPages) {
    const { label: name, marketing: problem, cta_label: cta } = industryBySlug.get(slug);
    const htmlName = name.replace(/&/g, "&amp;");
    const path = `industries/${slug}.html`;
    assert.equal(exists(path), true, `${path} should exist`);

    const html = read(path);
    assert.match(sitemap, new RegExp(`https://masest\\.co/industries/${slug}`), `${slug} should be in sitemap`);
    assert.match(html, new RegExp(`<title>${htmlName} \\| MASEST VertKleen</title>`), `${slug} title should match Tab 4 row`);
    assert.match(html, new RegExp(problem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${slug} should include the Tab 4 problem`);
    assert.match(html, new RegExp(`data-ind-products="${industryProducts.get(slug)}"`), `${slug} should use the canonical starting products`);
    assert.match(html, new RegExp(cta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${slug} should include the Tab 4 CTA`);
    assert.match(contact, new RegExp(`<option>${htmlName}</option>`), `${name} should be available in the industry dropdown`);
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
    gym: read("industries/golf-courses.html"),
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
    assert.match(html, /crs-studio\.webp/);
    assert.match(html, /multiwash-pressure-wash-studio\.webp/);
    assert.match(html, /Apply at 1:20 via downstream injector/);
    assert.match(html, /Rust &amp; fertilizer stains/);
    assert.match(html, /<span class="catalog-type">PW label<\/span>/);
    assert.doesNotMatch(html, /Published pack prices|1400 gal tote/);
  }
  assert.match(pages.fleet, /data-label-variant="pw-crhd"/);
  assert.match(pages.fleet, /data-label-variant="pw-multiwash"/);

  assert.match(pages.gym, /multiwash-gym-studio\.webp/);
  assert.match(pages.gym, /purgo-studio\.webp/);
  assert.match(pages.gym, /Floors &amp; tile:<\/strong>&nbsp; Dilute 5:1/);
  assert.match(pages.gym, /High-touch odor:<\/strong>&nbsp; Dilute 1:16/);
  assert.doesNotMatch(pages.gym, /Published pack prices|1 gal jug — \$21\.49/);

  for (const asset of [
    "cip-cr-studio.webp",
    "cip-hcr-studio.webp",
    "crhd-food-beverage-studio.webp",
    "multiwash-food-beverage-studio.webp",
    "crhd-pressure-wash-studio.webp",
    "crs-studio.webp",
    "multiwash-pressure-wash-studio.webp",
    "multiwash-gym-studio.webp",
    "purgo-studio.webp",
  ]) {
    assert.equal(managedImages.has(`/img/products/${asset}`), true, `${asset} should be registered in CMS`);
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

  for (const [path, title, seoTitle, vkMath, marketMath, proof] of comparisonPages) {
    assert.equal(exists(path), true, `${path} should exist`);
    const html = read(path);
    const route = path.replace(/\.html$/, "");
    assert.match(sitemap, new RegExp(`https://masest\\.co/${route}`), `${route} should be in sitemap`);
    assert.match(html, new RegExp(`<title>${seoTitle.replace(/&/g, "&amp;")} \\| MASEST VertKleen</title>`));
    assert.match(html, new RegExp(`data-price-vsku="${vkMath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `${title} should bind VertKleen pricing`);
    assert.match(html, new RegExp(marketMath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${title} should show competitor per-gallon math`);
    assert.match(html, /<table class="cmp-table comparison-swap-table">/, `${title} should include the swap-table row`);
    assert.match(html, new RegExp(proof.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${title} should include a proof point`);
    assert.match(html, /href="\.\.\/contact\?type=quote/, `${title} should route quote CTA to the quote form`);
    assert.match(html, new RegExp(`data-cms-content="page_sections" data-cms-page="${route}" data-cms-region="body"`), `${title} should expose a CMS page-section mount`);
  }
});

test("comparison SEO pages are also generated as mechanism-first blog posts", () => {
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
    assert.match(html, new RegExp(`data-price-vsku="${vkMath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `${title} blog post should bind VertKleen pricing`);
    assert.match(html, new RegExp(marketMath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${title} blog post should show competitor per-gallon math`);
    assert.match(html, new RegExp(proof.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${title} blog post should include a proof point`);
    assert.match(html, /href="(?:\.\.\/|\/)contact\?type=(?:quote|audit)(?:&amp;industry=)?/, `${title} blog post should include a task CTA`);
  }
});

test("CIP pricing route keeps canonical membership without static values", () => {
  const data = JSON.parse(read("data/segment-pricing.json"));
  const cip = data.segments.find((segment) => segment.slug === "cip-food-beverage");
  assert.ok(cip, "CIP pricing segment should exist");
  assert.equal(cip.rows.length, 30);
  assert.ok(cip.rows.some((row) => row.sku === "VK-CR-1G"));
  assert.ok(cip.rows.some((row) => row.sku === "VK-HCR-2.5G"));
  assert.ok(cip.rows.every((row) => !("price_per_unit" in row) && !("price_per_gallon" in row)));
});
