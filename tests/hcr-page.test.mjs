import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "parse5";
import { PRODUCTS } from "../js/main/catalog-data.js";

const html = readFileSync(new URL("../products/hcr.html", import.meta.url), "utf8");
const doc = parse(html);
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))];
}
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const text = node => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(text).join("");
const section = id => all(doc, node => attr(node, "aria-labelledby") === id)[0];
const rows = node => all(node, child => child.tagName === "tr").map(row => all(row, child => ["th", "td"].includes(child.tagName)).map(text));

test("HCR preserves calcium-carbonate benchmark conditions and solution identities", () => {
  const panel = section("product-performance-hcr");
  assert.deepEqual(rows(panel), [["Test solution", "Cube dissolved"], ["HCR, undiluted", "100%"], ["HCR at 50%", "97%"], ["HCR at 33%", "54%"], ["Hydrochloric acid at 15%", "87%"], ["Hydrochloric acid at 7.5%", "46%"]]);
  for (const term of ["8 hours at 100°F", "one-inch calcium-carbonate cube", "mineral benchmark"]) assert.ok(text(panel).includes(term), term);
  assert.doesNotMatch(text(panel), /calcium oxide|3 minutes|280/);
});

test("HCR separates label dosing, laboratory comparison, and combined brewery result", () => {
  assert.deepEqual(rows(section("product-dilution-hcr")), [["Mineral buildup", "Product per 10 gal"], ["Light beer stone", "0.5 L"], ["Moderate", "1 L"], ["Severe", "1.5 L"]]);
  const reference = section("product-reference-hcr");
  for (const term of ["December 2023", "7%", "15%", "as supplied", "mechanical cleaning", "industrial trial"]) assert.ok(text(reference).includes(term), term);
  const link = all(reference, node => node.tagName === "a")[0];
  assert.equal(attr(link, "href"), "../docs/carib-brewery-lab-report.pdf");
  assert.ok(attr(link, "data-document-id"));
  assert.match(text(section("product-result-hcr")), /HCR followed the CR organic wash/);
  assert.ok(all(section("product-result-hcr"), node => attr(node, "href") === "../products/cr").length);
  assert.match(text(section("product-application-hcr")), /sanitation and release procedure/);
});

test("HCR features real brewery evidence and material-specific handling", () => {
  assert.equal(PRODUCTS.hcr.application_image, undefined);
  assert.doesNotMatch(html, /cip-cycle-skid-v1|product-application-media/);
  const hero = all(doc, node => attr(node, "class") === "product-hero-proof")[0];
  assert.equal(attr(hero, "href"), "#product-result-hcr");
  assert.equal(text(hero), "See brewery cleaning results");
  assert.match(text(section("product-handling-hcr")), /excludes aluminum piping and fittings/);
  assert.match(text(section("product-technical-hcr")), /Non-fuming · zero VOCs/);
});
