import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "parse5";
import { PRODUCTS } from "../js/main/catalog-data.js";

const html = readFileSync(new URL("../products/cr.html", import.meta.url), "utf8");
const doc = parse(html);
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))];
}
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const text = node => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(text).join("");
const section = id => all(doc, node => attr(node, "aria-labelledby") === id)[0];

test("CIP CR keeps the brewery SKU strength and exact label dose units", () => {
  const dilution = section("product-dilution-cr");
  assert.ok(dilution);
  const rows = all(dilution, node => node.tagName === "tr").map(row => all(row, node => ["th", "td"].includes(node.tagName)).map(text));
  assert.deepEqual(rows, [["Soil load", "Product per 10 gal"], ["Light / krausen soil", "0.5 L"], ["Moderate soil", "1 L"], ["Severe soil", "1.5 L"]]);
  assert.match(text(dilution), /above 140°F/);
  assert.match(PRODUCTS.cr.replaces, /50% caustic/);
  assert.doesNotMatch(text(dilution), /Vehicle condition|RTU gallon/);
});

test("CIP CR separates trial conditions from label directions and credits the HCR step", () => {
  const trial = section("product-reference-cr");
  for (const value of ["5 L", "55 gal", "160–170°F", "25 minutes", "separate 30-minute HCR"]) assert.ok(text(trial).includes(value), value);
  const source = all(trial, node => node.tagName === "a")[0];
  assert.equal(attr(source, "href"), "../docs/brewery-cip-trial-brewlando.pdf");
  assert.ok(attr(source, "data-document-id"));
  const cycle = section("product-application-cr");
  assert.match(text(cycle), /no separate acid-neutralizing step/);
  assert.match(text(cycle), /sanitation and release procedure/);
  const result = section("product-result-cr");
  assert.ok(all(result, node => attr(node, "href") === "../products/hcr").length);
});

test("CIP CR links current EMS data and real brewery evidence without the synthetic skid", () => {
  const technical = section("product-technical-cr");
  assert.ok(all(technical, node => attr(node, "href") === "https://www.enviromfg.com/s/elevate-tds.pdf").length);
  const hero = all(doc, node => attr(node, "class") === "product-hero-proof")[0];
  assert.equal(attr(hero, "href"), "#product-result-cr");
  assert.equal(text(hero), "See brewery cleaning results");
  assert.equal(PRODUCTS.cr.application_image, undefined);
  assert.doesNotMatch(html, /cip-cycle-skid-v1|product-application-media/);
  assert.match(text(section("product-handling-cr")), /excludes aluminum piping and fittings/);
});
