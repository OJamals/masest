import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "parse5";
import { PRODUCTS } from "../js/main/catalog-data.js";

const html = readFileSync(new URL("../products/watersafe60.html", import.meta.url), "utf8");
const doc = parse(html);
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap((child) => all(child, predicate))];
}
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(text).join("");
const byId = (id) => all(doc, (node) => attr(node, "id") === id)[0];

test("WaterSafe60 shows exact NSF use scope and offers certification documentation", () => {
  const cert = byId("product-certification-watersafe60")?.parentNode.parentNode;
  assert.ok(cert);
  for (const phrase of ["NSF/ANSI/CAN 60", "Watersafe 60", "80 mg/L", "Flush the product out"]) {
    assert.ok(text(cert).includes(phrase), phrase);
  }
  const listing = all(cert, (node) => node.tagName === "a")[0];
  const request = new URL(attr(listing, "href"), "https://masest.co/products/watersafe60");
  assert.equal(request.pathname, "/contact");
  assert.equal(request.searchParams.get("product"), "WaterSafe60");
  assert.match(request.searchParams.get("message"), /certification documentation/);
  assert.equal(request.hash, "#quoteForm");
  const hero = all(doc, (node) => attr(node, "class") === "product-hero-proof")[0];
  assert.equal(attr(hero, "href"), "#product-certification-watersafe60");
  assert.match(text(hero), /certification/);
  assert.doesNotMatch(text(hero), /real job result/);
});

test("WaterSafe60 separates metered use limits from isolated cleaning and flushing", () => {
  const online = byId("product-mode-watersafe60-1")?.parentNode;
  const offline = byId("product-mode-watersafe60-2")?.parentNode;
  assert.ok(online && offline);
  for (const phrase of ["2–10 mg/L", "normal or below-normal hardness", "80 mg/L maximum", "not a default operating dose", "Bench-titrate"]) {
    assert.ok(text(online).includes(phrase), phrase);
  }
  for (const phrase of ["Shut off or disconnect", "at least 30 minutes", "flush with fresh water", "pH has returned to normal"]) {
    assert.ok(text(offline).includes(phrase), phrase);
  }
  assert.doesNotMatch(text(offline), /80 mg\/L|2–10 mg\/L/);
  const handling = byId("product-handling-watersafe60")?.parentNode.parentNode;
  assert.match(text(handling), /Do not use aluminum/);
  assert.doesNotMatch(text(handling), /Check the surface|Before you clean/);
});

test("WaterSafe60 identifies the titration sample and omits fabricated application imagery", () => {
  const study = byId("product-reference-watersafe60")?.parentNode;
  assert.ok(study);
  assert.match(text(study), /Sigma sample report starts at pH 8/);
  assert.match(text(study), /your own treatment demand/);
  assert.ok(all(study, (node) => attr(node, "href") === "../docs/sds/watersafe60-titration-test.pdf").length);
  assert.equal(PRODUCTS.watersafe60.application_image, undefined);
  assert.doesNotMatch(html, /watersafe60-water-program-v1|product-application-media/);
  assert.doesNotMatch(text(all(doc, (node) => node.tagName === "main")[0]), /Legionella|ASHRAE 188|15% faster|EPA approved|Safer Choice certified/i);
});
