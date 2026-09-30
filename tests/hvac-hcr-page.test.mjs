import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "parse5";
import { PRODUCTS } from "../js/main/catalog-data.js";

const html = readFileSync(new URL("../products/hcr-t16.html", import.meta.url), "utf8");
const doc = parse(html);
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))];
}
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const text = node => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(text).join("");
const section = id => all(doc, node => attr(node, "aria-labelledby") === id)[0];

test("HVAC HCR separates surface label directions from isolated-system dosing", () => {
  const panel = section("product-dilution-hcr-t16");
  const rows = all(panel, node => node.tagName === "tr").map(row => all(row, node => ["th", "td"].includes(node.tagName)).map(text));
  assert.deepEqual(rows, [["Label soil level", "Dilution / contact time"], ["Light", "10:1 · dwell 10–15 min"], ["Moderate", "5:1 · dwell, then rinse"], ["Severe", "2:1 · dwell 20 min"]]);
  assert.match(text(panel), /separate from the volume, concentration, and circulation time/);
  assert.match(text(section("product-mode-hcr-t16-2")), /Isolate, drain, and flush/);
  assert.doesNotMatch(text(section("product-mode-hcr-t16-2")), /10:1|500-200|per ton|30 minutes/);
});

test("HVAC HCR presents the Brevard surface job with actual before-and-after imagery", () => {
  const result = section("product-result-hcr-t16");
  for (const term of ["Brevard County", "30 minutes", "garden hose", "exposed-surface restoration"]) assert.ok(text(result).includes(term), term);
  const images = all(result, node => node.tagName === "img").map(node => attr(node, "src"));
  assert.ok(images.some(src => src.includes("farm-rust-before.webp")));
  assert.ok(images.some(src => src.includes("farm-rust-after.webp")));
  const hero = all(doc, node => attr(node, "class") === "product-hero-proof")[0];
  assert.equal(attr(hero, "href"), "#product-result-hcr-t16");
  assert.equal(text(hero), "See the HVAC before & after");
  assert.equal(PRODUCTS["hcr-t16"].application_image, undefined);
  assert.doesNotMatch(html, /hvac-descaling-loop-v1|product-application-media/);
});

test("HVAC HCR supports small packs, material checks, and manufacturer technology", () => {
  assert.match(text(section("product-technical-hcr-t16")), /Small packs through bulk/);
  assert.match(text(section("product-handling-hcr-t16")), /excludes aluminum piping and fittings/);
  assert.ok(all(section("product-reference-hcr-t16"), node => attr(node, "href") === "https://www.enviromfg.com/our-juice2").length);
  const main = text(all(doc, node => node.tagName === "main")[0]);
  assert.doesNotMatch(main, /Tote supply lowers delivered cost|NSF\/ANSI\/CAN 60|280×|sixteen drums/);
});
