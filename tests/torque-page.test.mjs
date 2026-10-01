import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "parse5";

const html = readFileSync(new URL("../products/torque.html", import.meta.url), "utf8");
const doc = parse(html);
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap((child) => all(child, predicate))];
}
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(text).join("");
const byId = (id) => all(doc, (node) => attr(node, "id") === id)[0];

test("Torque publishes the supplied label ratios with rinse instructions", () => {
  const panel = byId("product-dilution-torque")?.parentNode;
  assert.ok(panel);
  const rows = all(panel, (node) => node.tagName === "tr").map((row) =>
    all(row, (node) => ["td", "th"].includes(node.tagName)).map(text));
  assert.deepEqual(rows, [
    ["Vehicle condition", "Label dilution"], ["New or reconditioned vehicles", "20:1"],
    ["Moderate soil", "15:1"], ["Heavy soil", "10:1"], ["Severe soil", "5:1"],
  ]);
  assert.match(text(panel), /Follow your package directions/);
  const guide = byId("product-application-torque")?.parentNode;
  assert.ok(guide);
  assert.match(text(guide), /foaming applicator/);
  assert.match(text(guide), /thorough water rinse/);
  assert.match(text(guide), /distributes the wax and anti-stick coating/);
});

test("Torque's featured evidence is its own vessel wash and retains product navigation", () => {
  const result = byId("yellowfin-torque-wash");
  assert.ok(result);
  assert.match(text(result), /VertKleen Torque cleaned and finished/);
  assert.equal(all(doc, (node) => attr(node, "id") === "yellowfin-torque-wash").length, 1);
  assert.ok(all(doc, (node) => attr(node, "class") === "product-hero-proof" && attr(node, "href") === "#yellowfin-torque-wash").length);
  assert.ok(all(result, (node) => node.tagName === "img").every((node) => attr(node, "alt") && attr(node, "width") && attr(node, "height")));
  assert.ok(all(doc, (node) => attr(node, "href") === "../products/alumibrite").length);
  assert.equal(byId("airboat-alumibrite"), undefined);
  assert.equal(byId("product-brightening-torque"), undefined);
});

test("Torque keeps named fleet evidence separate from manufacturer technical classifications", () => {
  const reference = byId("product-reference-torque")?.parentNode;
  assert.ok(reference);
  assert.match(text(reference), /Manufacturer data identifies Torque/);
  assert.match(text(reference), /Blue Bird/);
  assert.match(text(reference), /PPG/);
  assert.ok(all(reference, (node) => attr(node, "href")?.startsWith("../contact?type=quote&product=VertKleen%20Torque&message=")).length);
  const technical = byId("product-technical-torque")?.parentNode.parentNode;
  assert.ok(technical);
  assert.match(text(technical), /Non-corrosive; non-DOT regulated/);
  assert.match(text(technical), /100% biodegradable/);
  assert.ok(all(technical, (node) => attr(node, "href")?.startsWith("../contact?type=quote&product=VertKleen%20Torque&message=")).length);
  assert.doesNotMatch(text(all(doc, (node) => node.tagName === "main")[0]), /EPA approved|Safer Choice certified|NSF certified|no rinse|freely dump/i);
});
