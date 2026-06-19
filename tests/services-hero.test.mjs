import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const servicesHtml = readFileSync(new URL("../services.html", import.meta.url), "utf8");

test("services hero does not repeat the service catalog eyebrow", () => {
  const start = servicesHtml.indexOf('class="hero services-hero product-catalog-hero"');
  const end = servicesHtml.indexOf('<section class="service-catalog-band"', start);
  const hero = servicesHtml.slice(start, end);

  assert.doesNotMatch(hero, /<p class="eyebrow">Service catalog<\/p>/i);
});
