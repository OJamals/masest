import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("home page opens directly into the original scrolly story", () => {
  const html = read("index.html");
  const css = read("css/style.css");

  assert.doesNotMatch(html, /premium-story-hero/, "home should not include the rejected premium intro scene");
  assert.doesNotMatch(html, /replacement-console/, "home should not include the rejected replacement console scene");
  assert.match(html, /<nav class="home-quick-actions"[\s\S]*<div class="story" id="story"/, "quick actions should hand off directly to the original scrolly");
  assert.doesNotMatch(css, /\.premium-story-hero\b/, "removed intro scene should not leave active styling behind");
  assert.doesNotMatch(css, /\.replacement-console\b/, "removed replacement console should not leave active styling behind");
});

test("product listing exposes proof-led premium commerce cards", () => {
  const html = read("products.html");
  const css = read("css/style.css");

  assert.match(html, /proof-led-catalog/, "products page should introduce proof-led catalog framing");
  assert.match(html, /Proof before paperwork/, "products page should foreground evidence before purchase");
  assert.match(css, /\.proof-led-catalog\b/, "proof-led catalog needs dedicated styling");
  assert.match(css, /\.shop-card\b[\s\S]*\.shop-card-core\b/, "shop cards should gain a double-bezel core");
});
