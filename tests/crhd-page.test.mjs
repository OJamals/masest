import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "parse5";
import { PRODUCTS } from "../js/main/catalog-data.js";

const html = readFileSync(new URL("../products/crhd.html", import.meta.url), "utf8");
const doc = parse(html);
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))];
}
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const text = node => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(text).join("");
const section = id => all(doc, node => attr(node, "aria-labelledby") === id)[0];

test("CR HD uses exact package directions and distinguishes the Low Foam formulation", () => {
  const panel = section("product-dilution-crhd");
  const rows = all(panel, node => node.tagName === "tr").map(row => all(row, node => ["th", "td"].includes(node.tagName)).map(text));
  assert.deepEqual(rows, [["Cleaning job", "Label dilution / method"], ["Floors", "40:1 · mop or spray, then rinse"], ["General cleaning", "30:1 · apply, brush, and rinse"], ["Degreasing", "10:1 · brush, then rinse"], ["Heavy degreasing", "3:1 · brush, then rinse"]]);
  assert.match(text(section("product-mode-crhd-1")), /HD means high detergency/);
  assert.match(text(section("product-mode-crhd-1")), /produces ample foam/);
  assert.ok(all(doc, node => attr(node, "href") === "../products/cr-hd-low-foam").length);
  assert.match(text(section("product-application-crhd")), /potable water.*separate sanitation procedure/);
});

test("CR HD features authentic kitchen photos with the documented job context", () => {
  const result = section("product-result-crhd");
  assert.match(text(result), /Fort Lauderdale/);
  assert.match(text(result), /three weeks without a thorough clean/);
  const images = all(result, node => node.tagName === "img").map(node => attr(node, "src"));
  assert.equal(images.length, 2);
  assert.ok(images.some(src => src.includes("kitchen-before.webp")));
  assert.ok(images.some(src => src.includes("kitchen-after.webp")));
  const hero = all(doc, node => attr(node, "class") === "product-hero-proof")[0];
  assert.equal(attr(hero, "href"), "#product-result-crhd");
  assert.equal(text(hero), "See the kitchen before & after");
  assert.equal(PRODUCTS.crhd.application_image, undefined);
  assert.doesNotMatch(html, /cr-hd-degreasing-trial-v1|product-application-media/);
});

test("CR HD provides current manufacturer support without the stale competitor PDF", () => {
  assert.ok(all(section("product-reference-crhd"), node => attr(node, "href") === "https://www.enviromfg.com/s/syncleanhdwso-tds.pdf").length);
  const link = all(section("product-technical-crhd"), node => node.tagName === "a")[0];
  const url = new URL(attr(link, "href"), "https://masest.co/products/crhd");
  assert.equal(url.searchParams.get("product"), "VertKleen CR HD");
  assert.equal(url.searchParams.get("message"), "Please send VertKleen CR HD technical data and the latest SDS.");
  assert.doesNotMatch(html, /vertkleen-crhd-degreaser-comparison\.pdf/);
  assert.match(text(section("product-handling-crhd")), /Keep washwater out of storm drains/);
  const main = text(all(doc, node => node.tagName === "main")[0]);
  assert.doesNotMatch(main, /50% active|30% active|2×|twice as|148038|EPA.certified/i);
});

test("the linked CR HD comparison uses current competitor directions and measured-job criteria", () => {
  const comparison = readFileSync(new URL("../comparisons/cr-hd-vs-simple-green.html", import.meta.url), "utf8");
  assert.doesNotMatch(comparison, /50% degreaser|50% concentrate|15%-active|15% active|Full strength to 1:10|\$66-\$184/);
  assert.match(comparison, /10–30 parts water for medium soil/);
  assert.match(comparison, /30 or more parts water for light soil/);
  assert.match(comparison, /Active-ingredient percentage alone cannot predict grease removal/);
  assert.match(comparison, /Non-DOT-regulated in current US SDS/);
  assert.match(comparison, /SDS_EN-US_SimpleGreenIndustrialCleanerDegreaser\.pdf/);
  assert.match(comparison, /Use your current supplier quote/);
  assert.match(comparison, /type=sample&amp;product=VertKleen%20CR%20HD#quoteForm/);
  assert.match(comparison, /type=quote&product=VertKleen%20CR%20HD/);
});
