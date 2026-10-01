import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "parse5";
import { PRODUCTS } from "../js/main/catalog-data.js";

const html = readFileSync(new URL("../products/neutral.html", import.meta.url), "utf8");
const doc = parse(html);
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))];
}
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const text = node => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(text).join("");
const section = suffix => all(doc, node => attr(node, "aria-labelledby") === `product-${suffix}-neutral`)[0];

test("Neutral uses its near-neutral mechanism and does not invent a single label recipe", () => {
  const main = text(all(doc, node => node.tagName === "main")[0]);
  assert.match(main, /non-emulsifying formula/);
  assert.match(main, /pH 7\.5/);
  assert.doesNotMatch(main, /pH-7\b|pH 7\b(?!\.5)|holds it in the wash|1:20|40:1|30:1|100:1/);
  assert.match(text(section("application")), /directions supplied with your Neutral package/);
  assert.match(main, /Choose CR HD Low Foam when the machine/);
  assert.match(text(section("handling")), /mild skin and eye irritation/);
  assert.doesNotMatch(main, /safe on all|zero risk|no PPE|freely dump|aviation approved|Safer Choice certified/i);
});

test("Neutral offers technical data and product-specific application requests", () => {
  assert.ok(all(section("reference"), node => attr(node, "href")?.startsWith("../contact?type=quote&product=VertKleen%20Neutral&message=")).length);
  const technical = all(section("technical"), node => node.tagName === "a")[0];
  const technicalUrl = new URL(attr(technical, "href"), "https://masest.co/products/neutral");
  assert.equal(technicalUrl.searchParams.get("product"), "VertKleen Neutral");
  assert.equal(technicalUrl.searchParams.get("message"), "Please send VertKleen Neutral dilution guidance, package directions, and the latest SDS.");
  const request = all(section("application"), node => node.tagName === "a")[0];
  const url = new URL(attr(request, "href"), "https://masest.co/products/neutral");
  assert.equal(url.searchParams.get("product"), "VertKleen Neutral");
  assert.equal(url.hash, "#quoteForm");
});

test("Neutral shows the supplied Desktop label without fabricated evidence", () => {
  assert.equal(PRODUCTS.neutral.image, "img/products/neutral-desktop-label-20261001.webp");
  assert.equal(PRODUCTS.neutral.image_review_pending, undefined);
  assert.equal(PRODUCTS.neutral.application_image, undefined);
  const media = all(doc, node => attr(node, "data-commerce-media") === "neutral")[0];
  const image = all(media, node => node.tagName === "img")[0];
  assert.equal(attr(image, "src"), "../img/products/neutral-desktop-label-20261001.webp");
  assert.match(attr(image, "alt"), /Neutral jug with the supplied product label/);
  assert.doesNotMatch(text(media), /Product rendering/);
  assert.doesNotMatch(html, /neutral-studio.webp|neutral-material-test-patch-v1/);
});

test("commerce hydration cannot restore withdrawn artwork from a catalog image URL", () => {
  const source = readFileSync(new URL("../js/main/commerce-ui.js", import.meta.url), "utf8");
  const definition = source.match(/function commerceMediaFor\(id\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(definition);
  const resolve = new Function("PRODUCTS", "commerceRowFor", "isPosterFallback", `${definition}; return commerceMediaFor;`)(
    PRODUCTS, () => ({ image_url: "/img/products/neutral-studio.webp", photo_alt: "Catalog photo" }), () => false,
  );
  assert.deepEqual(resolve("neutral"), { src: PRODUCTS.neutral.image, alt: PRODUCTS.neutral.image_alt });
  assert.equal(resolve("crhd").src, "/img/products/neutral-studio.webp");
  const compiled = structuredClone(PRODUCTS);
  compiled.neutral.image_replaces = compiled.neutral.image_replaces.map(path => `https://media.masest.co/site/${path}`);
  const resolveCompiled = new Function("PRODUCTS", "commerceRowFor", "isPosterFallback", `${definition}; return commerceMediaFor;`)(
    compiled, () => ({ image_url: "https://media.masest.co/site/img/products/neutral-studio.webp" }), () => false,
  );
  assert.equal(resolveCompiled("neutral").src, PRODUCTS.neutral.image, "R2-rewritten legacy paths must still be blocked");
});
