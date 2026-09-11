import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("home page opens on a text-led hero and leaves retired scenes retired", () => {
  const html = read("index.html");
  const css = read("css/style.css");

  // Retired-feature guards. These predate the scrollybook and outlive it: each names a
  // homepage opener that was tried and rejected, and the guard is what stops it returning.
  assert.doesNotMatch(html, /premium-story-hero/, "home should not include the rejected premium intro scene");
  assert.doesNotMatch(html, /replacement-console/, "home should not include the rejected replacement console scene");
  assert.doesNotMatch(html, /home-quick-actions/, "home should not show the removed quick-action switcher");
  assert.doesNotMatch(css, /\.premium-story-hero\b/, "removed intro scene should not leave active styling behind");
  assert.doesNotMatch(css, /\.replacement-console\b/, "removed replacement console should not leave active styling behind");

  // The scrollybook is now one of them. It led with a 177KB photograph as the LCP element;
  // the homepage opens on a text hero instead and the six field results live on /proof.
  assert.doesNotMatch(html, /class="story"|story-object|class="act"/, "the scrollybook should not return to the homepage");

  assert.match(html, /<section class="hero-split">/, "home should open on the text-led hero");
  assert.equal((html.match(/<h1\b/g) || []).length, 1, "the hero supplies the page's only h1");
  assert.doesNotMatch(html, /supabase\.co\/storage\/v1\/object/i);
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
