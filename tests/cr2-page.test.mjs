import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "parse5";
import { PRODUCTS } from "../js/main/catalog-data.js";

const html = readFileSync(new URL("../products/cr2.html", import.meta.url), "utf8");
const doc = parse(html);
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))];
}
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const text = node => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(text).join("");
const section = id => all(doc, node => attr(node, "aria-labelledby") === id)[0];

test("HVAC CR retains exact soil ratios and label contact times", () => {
  const panel = section("product-dilution-cr2");
  const rows = all(panel, node => node.tagName === "tr").map(row => all(row, node => ["th", "td"].includes(node.tagName)).map(text));
  assert.deepEqual(rows, [["Soil / odor level", "Label dilution"], ["Light soil / mild odor", "10:1 · dwell 10–15 min"], ["Moderate soil / odor", "5:1 · dwell, then rinse"], ["Severe soil / odor", "2:1 · dwell 20 min"]]);
  assert.match(text(panel), /Every label method finishes with rinsing/);
  assert.doesNotMatch(text(panel), /Vehicle condition|RTU gallon|140°F/);
});

test("HVAC CR keeps replacement strength separate from cleaning and water-treatment doses", () => {
  assert.match(PRODUCTS.cr2.replaces, /60% caustic/);
  const reference = section("product-reference-cr2");
  assert.match(text(reference), /use the HVAC label ratios for cleaning/);
  assert.match(text(reference), /starting pH, target, and water analysis/);
  assert.ok(all(reference, node => attr(node, "href") === "https://www.phlexapeel.com/products").length);
  assert.doesNotMatch(text(all(doc, node => node.tagName === "main")[0]), /92 mg\/L|NSF\/ANSI\/CAN 60|Safer Choice certified|neutral-pH/);
});

test("HVAC CR uses manufacturer records without invented job imagery or unrestricted material claims", () => {
  assert.equal(PRODUCTS.cr2.application_image, undefined);
  assert.doesNotMatch(html, /hvac-cr-drain-maintenance-v1|product-application-media/);
  const hero = all(doc, node => attr(node, "class") === "product-hero-proof")[0];
  assert.equal(text(hero), "See the caustic replacement record");
  assert.equal(attr(hero, "href"), "#records");
  assert.equal(text(all(doc, node => attr(node, "id") === "records")[0]), "Caustic replacement");
  assert.match(html, /class="doc-pill">Product record</);
  assert.ok(all(section("product-technical-cr2"), node => attr(node, "href") === "https://www.phlexapeel.com/s/pHlex-CR2-Label.pdf").length);
  assert.match(text(section("product-technical-cr2")), /The HVAC CR label reports biodegradation in less than 10 days/);
  assert.match(text(section("product-handling-cr2")), /Confirm compatibility before treating aluminum, coated coils/);
  assert.match(text(section("product-application-cr2")), /confirm drainage before returning/);
});
