import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("home page opens directly into the verified field-job scrolly story", () => {
  const html = read("index.html");
  const css = read("css/style.css");

  assert.doesNotMatch(html, /premium-story-hero/, "home should not include the rejected premium intro scene");
  assert.doesNotMatch(html, /replacement-console/, "home should not include the rejected replacement console scene");
  assert.doesNotMatch(html, /home-quick-actions/, "home should not show the removed quick-action switcher");
  assert.match(html, /<div class="story" id="story"/, "home should open directly into the field-job story");
  assert.equal((html.match(/class="story-object"/g) || []).length, 1, "story should keep one persistent visual object");
  assert.deepEqual(
    [...html.matchAll(/data-scene="(kitchen-grease|cip-vessel|labelle-fermenter|shower-track|airboat-panel|pool-cartridge)"/g)].map((match) => match[1]),
    ["kitchen-grease", "cip-vessel", "labelle-fermenter", "shower-track", "airboat-panel", "pool-cartridge"],
  );
  assert.match(html, /class="story-object__range" type="range"/);
  assert.doesNotMatch(html, /supabase\.co\/storage\/v1\/object/i);
  assert.doesNotMatch(css, /\.premium-story-hero\b/, "removed intro scene should not leave active styling behind");
  assert.doesNotMatch(css, /\.replacement-console\b/, "removed replacement console should not leave active styling behind");
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
