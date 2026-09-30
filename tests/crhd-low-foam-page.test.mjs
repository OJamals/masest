import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "parse5";
import { PRODUCTS } from "../js/main/catalog-data.js";

const html = readFileSync(new URL("../products/cr-hd-low-foam.html", import.meta.url), "utf8");
const doc = parse(html);
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))];
}
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const text = node => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(text).join("");
const section = suffix => all(doc, node => attr(node, "aria-labelledby") === `product-${suffix}-cr-hd-low-foam`)[0];

test("Low Foam uses LF-specific application ratios without importing HD label directions", () => {
  const panel = section("dilution");
  const rows = all(panel, node => node.tagName === "tr").map(row => all(row, node => ["th", "td"].includes(node.tagName)).map(text));
  assert.deepEqual(rows, [["Cleaning job", "LF technical-sheet dilution"], ["Caked-on hydraulic fluid or grease", "10:1"], ["Floors, vehicles, and carpets", "30:1"]]);
  assert.match(text(panel), /Confirm the water-and-concentrate recipe/);
  assert.match(text(panel), /EMS technical-sheet dilution examples/);
  assert.doesNotMatch(text(panel), /label dilutions/);
  assert.doesNotMatch(text(panel), /40:1|3:1|100:1|RTU gallon/);
  assert.match(text(section("application")), /machine model, tank capacity, operating temperature/);
  assert.match(text(section("handling")), /Standard CR HD and Low Foam have different foam profiles/);
});

test("Low Foam publishes its exact manufacturer sheet and product-specific document request", () => {
  assert.ok(all(section("reference"), node => attr(node, "href") === "https://www.enviromfg.com/s/syncleanlf-tds.pdf").length);
  const link = all(section("technical"), node => node.tagName === "a")[0];
  const url = new URL(attr(link, "href"), "https://masest.co/products/cr-hd-low-foam");
  assert.equal(url.searchParams.get("product"), "VertKleen CR HD Low Foam");
  assert.equal(url.searchParams.get("message"), "Please send VertKleen CR HD Low Foam package directions, technical data, and the latest SDS.");
  const main = text(all(doc, node => node.tagName === "main")[0]);
  assert.doesNotMatch(main, /148038|Safer Choice|EPA.certified|50% active|30% active|three-year|3.year shelf/i);
  assert.match(text(section("technical")), /DOT, TDG, IMO, IATA, and IMDG/);
});

test("Low Foam labels family packaging and omits synthetic scenes and unrelated case photos", () => {
  const media = all(doc, node => attr(node, "data-commerce-media") === "cr-hd-low-foam")[0];
  assert.match(text(media), /CR HD family packaging shown/);
  assert.match(text(media), /Use the Low Foam directions/);
  assert.equal(PRODUCTS["cr-hd-low-foam"].application_image, undefined);
  assert.doesNotMatch(html, /cr-hd-low-foam-machine-wash-v1|product-application-media|kitchen-before.webp|distribution-center-assessment/);
});
