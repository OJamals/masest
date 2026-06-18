import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const TRACK = read("../js/track.js");
const API = read("../functions/api/track.js");
const ENG = read("../js/main/engagement.js");
const CART = read("../js/cart.js");
const CONFIRM = read("../order-confirmed.html");

test("track.js captures first-touch UTM and exposes mtrack + masestUtm", () => {
  assert.match(TRACK, /masest_utm/);
  assert.match(TRACK, /utm_source['"]?\s*,\s*['"]utm_medium['"]?\s*,\s*['"]utm_campaign/);
  assert.match(TRACK, /window\.mtrack\s*=/);
  assert.match(TRACK, /window\.masestUtm\s*=/);
  assert.match(TRACK, /beacon\(['"]pageview['"]\)/, "still auto-fires pageview (back-compat)");
});

test("/api/track stores event + utm columns, defaulting event to pageview", () => {
  assert.match(API, /event:\s*String\(body\.event\s*\|\|\s*'pageview'\)/);
  assert.match(API, /utm_source:/);
  assert.match(API, /utm_medium:/);
  assert.match(API, /utm_campaign:/);
});

test("quote submit attaches UTM and fires quote_submit funnel event", () => {
  assert.match(ENG, /masestUtm\(/, "must read attribution");
  assert.match(ENG, /mtrack\(["']quote_submit["']\)/);
});

test("cart checkout fires checkout_start", () => {
  assert.match(CART, /mtrack\(["']checkout_start["']\)/);
});

test("order-confirmed loads track.js and fires order_complete", () => {
  assert.match(CONFIRM, /src="js\/track\.js"/);
  assert.match(CONFIRM, /mtrack\(["']order_complete["']\)/);
});
