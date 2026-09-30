import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "parse5";
import { CATALOG_GROUPS, PRODUCTS } from "../js/main/catalog-data.js";

const html = readFileSync(new URL("../products/sar.html", import.meta.url), "utf8");
const doc = parse(html);
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap((child) => all(child, predicate))];
}
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(text).join("");
const byId = (id) => all(doc, (node) => attr(node, "id") === id)[0];
const main = all(doc, (node) => node.tagName === "main")[0];

test("SAR is offered for pH control and appears in the water-treatment group", () => {
  assert.match(text(main), /sulfuric acid replacement/i);
  assert.match(text(main), /Lower process-water pH/);
  assert.doesNotMatch(text(main), /stubborn rust|specialty scale remover|Check the surface|Before you clean/);
  assert.ok(CATALOG_GROUPS.find((group) => group.key === "water").ids.includes("sar"));
  assert.ok(!CATALOG_GROUPS.find((group) => group.key === "descale").ids.includes("sar"));
  assert.ok(all(doc, (node) => attr(node, "href")?.includes("product=VertKleen%20SAR") && text(node) === "Plan my SAR dosing program").length);
});

test("SAR keeps titration strength separate from field dosing and specifies feed materials", () => {
  const reference = byId("product-reference-sar")?.parentNode;
  assert.ok(reference);
  assert.match(text(reference), /40% sulfuric acid/);
  assert.match(text(reference), /technical sheet reports/);
  assert.match(text(reference), /measured demand and target pH/);
  const guide = byId("product-application-sar")?.parentNode;
  assert.ok(guide);
  for (const phrase of ["Bench-titrate", "316 stainless steel", "polypropylene", "Schedule 80 PVC", "Do not use aluminum", "mix, and check pH"]) {
    assert.ok(text(guide).includes(phrase), phrase);
  }
  assert.doesNotMatch(text(main), /1:1|\d+:\d+|ready-to-use gallons|less product than|no PPE/i);
  const source = all(reference, (node) => node.tagName === "a")[0];
  assert.match(attr(source, "href"), /^\.\.\/contact\?type=quote&product=VertKleen%20SAR/);
  assert.equal(attr(source, "target"), undefined);
});

test("SAR omits the flagged synthetic scene and does not borrow another product's result", () => {
  assert.equal(PRODUCTS.sar.application_image, undefined);
  assert.doesNotMatch(html, /sar-application-engineering-v1|product-application-media|product-hero-proof|yellowfin-torque-wash|airboat-alumibrite/);
  const handling = byId("product-handling-sar")?.parentNode.parentNode;
  assert.ok(handling);
  assert.match(text(handling), /Before you dose/);
  assert.match(text(handling), /calibrated pH meter/);
  assert.match(text(handling), /measured endpoint/);
});
