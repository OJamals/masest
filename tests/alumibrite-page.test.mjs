import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "parse5";
import { CATALOG_ORDER } from "../js/main/catalog-data.js";

const read = (id) => readFileSync(new URL(`../products/${id}.html`, import.meta.url), "utf8");
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap((child) => all(child, predicate))];
}
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(text).join("");
const doc = parse(read("alumibrite"));
const byId = (id) => all(doc, (node) => attr(node, "id") === id)[0];

test("AlumiBrite comparison keeps score, source and test conditions together", () => {
  const panel = byId("product-brightening-alumibrite")?.parentNode;
  assert.ok(panel);
  const rows = all(panel, (node) => node.tagName === "tr").map((row) =>
    all(row, (node) => ["td", "th"].includes(node.tagName)).map(text));
  assert.deepEqual(rows, [
    ["Cleaner", "Score"], ["Alumi-Brite", "90.1"],
    ["Hydrofluoric acid (HF)", "92.5"], ["Hydrochloric acid (HCl)", "86.3"],
  ]);
  for (const phrase of ["Manufacturer-reported", "not percentages", "5% active", "7075-Y6", "3 minutes at 70°F", "not mixing or dwell-time directions"]) {
    assert.ok(text(panel).includes(phrase), phrase);
  }
  assert.ok(all(panel, (node) => attr(node, "href")?.startsWith("../contact?type=quote&product=VertKleen%20AlumiBrite&message=")).length);
  assert.equal(all(panel, (node) => node.tagName === "caption").length, 1);
});

test("AlumiBrite restoration guide distinguishes finish types and label directions", () => {
  const guide = byId("product-application-alumibrite")?.parentNode;
  assert.ok(guide);
  const content = text(guide);
  for (const phrase of ["bare, polished, anodized, or coated", "after rinsing and drying", "label dilution", "Rinse thoroughly", "Torque"]) {
    assert.ok(content.includes(phrase), phrase);
  }
  assert.equal(all(guide, (node) => node.tagName === "ol").length, 1);
  const main = all(doc, (node) => node.tagName === "main")[0];
  assert.doesNotMatch(text(main), /acid-free|90\.1%|NSF certified|EPA approved|safe on every|\d+:\d+/i);
});

test("AlumiBrite shows actual paired evidence with both products attributed", () => {
  const result = byId("airboat-alumibrite");
  assert.ok(result);
  const images = all(result, (node) => node.tagName === "img");
  assert.equal(images.length, 2);
  assert.match(attr(images[0], "src"), /airboat-panel-before-aligned/);
  assert.match(attr(images[1], "src"), /airboat-panel-after-aligned/);
  assert.ok(images.every((image) => attr(image, "alt") && attr(image, "width") && attr(image, "height")));
  assert.match(text(result), /AlumiBrite/);
  assert.match(text(result), /Torque/);
  assert.equal(all(doc, (node) => attr(node, "id") === "airboat-alumibrite").length, 1);
  assert.ok(all(doc, (node) => attr(node, "class") === "product-hero-proof" && attr(node, "href") === "#airboat-alumibrite").length);
  for (const id of CATALOG_ORDER.filter((id) => id !== "alumibrite")) {
    assert.doesNotMatch(read(id), /id="product-brightening-/);
  }
});

test("AlumiBrite technical advantages retain manufacturer attribution and document requests", () => {
  const panel = byId("product-technical-alumibrite")?.parentNode.parentNode;
  assert.ok(panel);
  for (const phrase of ["HMIS 0-0-0", "Non-DOT regulated", "No VOCs or phosphates", "OECD 404", "Paint and glass"]) {
    assert.ok(text(panel).includes(phrase), phrase);
  }
  assert.ok(all(panel, (node) => attr(node, "href")?.startsWith("../contact?type=quote&product=VertKleen%20AlumiBrite&message=")).length);
});
