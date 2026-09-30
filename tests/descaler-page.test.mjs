import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "parse5";
import { PRODUCTS } from "../js/main/catalog-data.js";

const html = readFileSync(new URL("../products/descaler.html", import.meta.url), "utf8");
const doc = parse(html);
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))];
}
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const text = node => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(text).join("");
const section = id => all(doc, node => attr(node, "aria-labelledby") === id)[0];

test("Descaler keeps HVAC label ratios separate from case-specific service times", () => {
  const panel = section("product-dilution-descaler");
  const rows = all(panel, node => node.tagName === "tr").map(row => all(row, node => ["th", "td"].includes(node.tagName)).map(text));
  assert.deepEqual(rows, [["Buildup", "Label dilution"], ["Light / regular cleaning", "20:1"], ["Moderate cleaning", "3:1"], ["Severe buildup / scale", "1:1"]]);
  assert.match(text(panel), /does not prescribe a fixed circulation time/);
  assert.doesNotMatch(text(panel), /24 hours|30 minutes|per ton|RTU gallon/);
  assert.match(text(section("product-mode-descaler-2")), /responsible service technician/);
});

test("Descaler documents the fire-pump outcome without presenting new-equipment photos as after-cleaning evidence", () => {
  const result = section("product-result-descaler");
  for (const term of ["Cocoa, Florida", "solenoid for 30 minutes", "24 hours", "30-minute operational test", "proper flow and pressure"]) assert.ok(text(result).includes(term), term);
  assert.equal(all(result, node => node.tagName === "img").length, 0);
  const hero = all(doc, node => attr(node, "class") === "product-hero-proof")[0];
  assert.equal(attr(hero, "href"), "#product-result-descaler");
  assert.equal(text(hero), "See the fire-pump result");
  assert.ok(all(result, node => attr(node, "href") === "../products/watersafe60").length);
  assert.equal(PRODUCTS.descaler.application_image, undefined);
  assert.doesNotMatch(html, /hvac-descaling-loop-v1|product-application-media/);
});

test("Descaler supports equipment-specific cleaning and direct technical inquiries", () => {
  const comparison = section("product-performance-descaler");
  assert.match(text(comparison), /Copper and aluminum compatible at label dilution/);
  assert.match(text(comparison), /CDC\/NIOSH/);
  assert.ok(all(comparison, node => attr(node, "href") === "https://www.cdc.gov/niosh/npg/npgd0332.html").length);
  assert.match(text(section("product-mode-descaler-1")), /copper and aluminum compatibility at dilution/);
  assert.match(text(section("product-reference-descaler")), /Boca Raton/);
  const link = all(section("product-technical-descaler"), node => node.tagName === "a")[0];
  const url = new URL(attr(link, "href"), "https://masest.co/products/descaler");
  assert.equal(url.searchParams.get("product"), "VertKleen Descaler");
  assert.equal(url.searchParams.get("message"), "Please send VertKleen Descaler technical data and the latest SDS.");
  assert.match(text(section("product-handling-descaler")), /Keep runoff out of storm drains/);
  const main = text(all(doc, node => node.tagName === "main")[0]);
  assert.doesNotMatch(main, /280×|15% more|609\.5|\$75|NSF\/ANSI\/CAN 60|EPA.certified/i);
});
