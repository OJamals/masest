import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const catalog = JSON.parse(read("data/catalog.seed.json"));
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const htmlText = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const displayName = (value) => value
  .replace(/\bStd\b/g, "Standard")
  .replace(/\bBio\b/g, "Biological")
  .replace(/\bSpecie ID\b/g, "Species ID");

function graphNodes(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/g)]
    .map((match) => JSON.parse(match[1]))
    .flatMap((node) => node["@graph"] || [node]);
}

test("generator publishes eight crawlable service-category pages", () => {
  assert.equal(catalog.service_categories.length, 8);
  const serviceRows = [...catalog.services, ...catalog.service_packages]
    .filter((item) => item?.active !== false);

  for (const category of catalog.service_categories) {
    const file = `services/${category.slug}.html`;
    assert.equal(existsSync(new URL(file, ROOT)), true, `${file} should exist`);
    const html = read(file);
    const items = serviceRows.filter((item) => (
      item.category === category.key
      || (category.key === "Testing - Materials" && item.category === "Lab Testing - Materials")
    ));

    assert.match(html, new RegExp(`<title>${escapeRegex(htmlText(category.seo_title))}</title>`));
    assert.match(html, new RegExp(`<meta name="description" content="${escapeRegex(htmlText(category.seo_description))}">`));
    assert.match(html, new RegExp(`<link rel="canonical" href="https://masest\\.co/services/${category.slug}">`));
    assert.match(html, new RegExp(`<h1[^>]*>${escapeRegex(htmlText(category.title))}</h1>`));
    assert.match(html, /href="\.\.\/services"/);
    assert.match(html, /href="\.\.\/contact\?type=services/);
    assert.doesNotMatch(html, /data-service-catalog/);

    for (const item of items) assert.match(html, new RegExp(escapeRegex(htmlText(displayName(item.name)))));

    const nodes = graphNodes(html);
    assert.ok(nodes.some((node) => node["@type"] === "Organization"));
    assert.ok(nodes.some((node) => node["@type"] === "BreadcrumbList"));
    const service = nodes.find((node) => node["@type"] === "Service");
    assert.ok(service, `${file} needs Service schema`);
    assert.equal(service.hasOfferCatalog.itemListElement.length, items.length);
  }
});

test("service hub and sitemap link all category routes", () => {
  const hub = read("services.html");
  const sitemap = read("sitemap.xml");

  for (const category of catalog.service_categories) {
    assert.match(hub, new RegExp(`href="services/${category.slug}"`));
    assert.match(sitemap, new RegExp(`<loc>https://masest\\.co/services/${category.slug}</loc>`));
  }
});
