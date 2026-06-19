import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("home page leads with a premium replacement story instead of a buried headline", () => {
  const html = read("index.html");
  const css = read("css/style.css");

  assert.match(html, /class="[^"]*\bpremium-story-hero\b[^"]*"/, "home needs a first-viewport premium story hero");
  assert.match(html, /class="[^"]*\breplacement-console\b[^"]*"/, "home needs a replacement console before the scrollytelling acts");
  assert.match(html, /HMIS 3-0-1[\s\S]*HMIS 0-0-0/, "home should show the hazard-to-zero replacement arc");
  assert.match(css, /\.premium-story-hero\b/, "premium story hero needs dedicated styling");
  assert.match(css, /\.replacement-console\b/, "replacement console needs dedicated styling");
  assert.match(css, /\.island-arrow\b/, "CTAs should use nested button-in-button arrow treatment");
});

test("product listing exposes proof-led premium commerce cards", () => {
  const html = read("products.html");
  const css = read("css/style.css");

  assert.match(html, /proof-led-catalog/, "products page should introduce proof-led catalog framing");
  assert.match(html, /Proof before paperwork/, "products page should foreground evidence before purchase");
  assert.match(css, /\.proof-led-catalog\b/, "proof-led catalog needs dedicated styling");
  assert.match(css, /\.shop-card\b[\s\S]*\.shop-card-core\b/, "shop cards should gain a double-bezel core");
});
