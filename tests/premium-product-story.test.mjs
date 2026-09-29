import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("homepage uses the approved stable unveiling with documented proof", () => {
  const html = read("index.html");
  assert.match(html, /class="home-unveiling"/);
  assert.match(html, /id="results"/);
  assert.match(html, /hcr-brevard-hvac-rust-case-study/);
  assert.doesNotMatch(html, /premium-story-hero|replacement-console|home-quick-actions|class="story-object"|id="story"/);
});

test("product listing exposes proof-led premium commerce cards", () => {
  const html = read("products.html");
  const css = read("css/style.css");

  assert.match(html, /proof-led-catalog/, "products page should introduce proof-led catalog framing");
  assert.match(html, /Results library/, "products page should offer results before purchase");
  assert.match(html, /proof#brewery-cip-trials/, "products page should route buyers into relevant proof");
  assert.match(css, /\.proof-led-catalog\b/, "proof-led catalog needs dedicated styling");
  assert.match(css, /\.shop-card\b[\s\S]*\.shop-card-core\b/, "shop cards should gain a double-bezel core");
});
