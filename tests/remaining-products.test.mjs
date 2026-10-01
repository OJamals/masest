import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "parse5";
import { PRODUCTS, CATALOG_ORDER } from "../js/main/catalog-data.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))];
}
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const text = node => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(text).join("");
const page = id => parse(read(`products/${id}.html`));
const section = (doc, id, suffix) => all(doc, node => attr(node, "aria-labelledby") === `product-${suffix}-${id}`)[0];

test("MultiWash keeps general-label recipes separate from specialty packages", () => {
  const doc = page("multiwash");
  const main = text(all(doc, n => n.tagName === "main")[0]);
  assert.equal(PRODUCTS.multiwash.cat, "specialty");
  assert.match(main, /mineral cleaning for scale, degreasing for oily residue, and odor control/);
  assert.match(main, /10:1/);
  assert.match(main, /5:1/);
  assert.match(main, /2:1/);
  assert.match(main, /Gym and marine packages have their own application directions/);
  assert.doesNotMatch(main, /neutral.pH|33 gallons|17 gallons|NSF.certified/i);
  assert.ok(all(doc, n => attr(n, "href")?.startsWith("../contact?type=quote&product=VertKleen%20MultiWash&message=")).length);
});

test("LAM3 attributes genuine concrete photos without inventing their test conditions", () => {
  const html = read("products/lam3.html");
  const main = text(all(page("lam3"), n => n.tagName === "main")[0]);
  assert.match(main, /Spray and leave/);
  assert.match(main, /Brush and rinse/);
  assert.match(main, /one to two weeks/);
  assert.match(html, /proof#lam3-concrete-cleaning/);
  assert.match(html, /moss-before.webp/);
  assert.match(html, /moss-after.webp/);
  assert.doesNotMatch(html, /proof#property-grout-moss|stays wet longer/);
  const proof = JSON.parse(read("data/content/proof.json"));
  const cards = proof.proof_cards;
  const lam = cards.find(card => card.slug === "lam3-concrete-cleaning");
  assert.deepEqual(lam.chips, ["VertKleen LAM3"]);
  assert.doesNotMatch(JSON.stringify(lam), /14.days|1:5|10:1/);
  assert.deepEqual(cards.find(card => card.slug === "property-grout-moss").chips, ["VertKleen CR"]);
});

test("Purgo separates surface application from system dosing and offers technical data", () => {
  const doc = page("purgo");
  const main = text(all(doc, n => n.tagName === "main")[0]);
  assert.match(main, /Surface and water-system applications use different dosing methods/);
  assert.match(main, /Commercial fogging/);
  assert.match(main, /occupancy schedule/);
  assert.doesNotMatch(main, /Purgo N|no respirator|safe to inhale|freely dump/i);
  assert.ok(all(doc, n => attr(n, "href")?.startsWith("../contact?type=quote&product=Purgo&message=")).length);
});

test("remaining products retain focused technical inquiries and withdraw staged scenes", () => {
  for (const id of ["multiwash", "lam3", "purgo"]) {
    const doc = page(id);
    assert.equal(PRODUCTS[id].application_image, undefined);
    const link = all(section(doc, id, "technical"), n => n.tagName === "a")[0];
    const url = new URL(attr(link, "href"), "https://masest.co");
    assert.equal(url.hash, "#quoteForm");
    assert.match(url.searchParams.get("product"), new RegExp(id, "i"));
    assert.ok(url.searchParams.get("message"));
  }
  for (const id of ["multiwash"]) {
    assert.equal(PRODUCTS[id].image_review_pending, undefined);
    const media = all(page(id), n => attr(n, "data-commerce-media") === id)[0];
    const image = all(media, n => n.tagName === "img")[0];
    assert.equal(attr(image, "src"), "../img/products/multiwash-general-studio-v2.webp");
    assert.match(text(media), /Specialty packages have their own directions/);
  }
  assert.equal(PRODUCTS.lam3.image_review_pending, undefined);
  const lam3Media = all(page("lam3"), n => attr(n, "data-commerce-media") === "lam3")[0];
  const lam3Image = all(lam3Media, n => n.tagName === "img")[0];
  assert.equal(attr(lam3Image, "src"), "../img/products/lam3-studio-v2.webp");
  assert.equal(attr(lam3Image, "width"), "1092");
  assert.equal(attr(lam3Image, "height"), "1441");
  assert.match(text(lam3Media), /2.5-gallon package rendering/);
});

test("all fifteen public products have application, evidence, and purchasing content", () => {
  assert.equal(CATALOG_ORDER.length, 15);
  assert.ok(!CATALOG_ORDER.includes("cr60"));
  for (const id of CATALOG_ORDER) {
    const doc = page(id);
    assert.equal(all(doc, n => n.tagName === "h1").length, 1, `${id}: heading`);
    assert.ok(section(doc, id, "technical"), `${id}: technical profile`);
    assert.ok(section(doc, id, "reference") || all(doc, n => n.tagName === "a" && /docs\/sds\/|contact\?type=quote.*message=/.test(attr(n, "href") || "")).length, `${id}: source reference`);
    assert.match(read(`products/${id}.html`), /data-commerce-price/);
  }
});
