import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { maskEmail } from "../functions/api/order.js";

const API = readFileSync(new URL("../functions/api/order.js", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("../order-confirmed.html", import.meta.url), "utf8");
const TRACK = readFileSync(new URL("../js/track.js", import.meta.url), "utf8");

test("confirmation endpoint exposes only a masked email and no shipping address", () => {
  assert.equal(maskEmail("buyer@example.com"), "b•••@example.com");
  assert.equal(maskEmail("x@example.com"), "x•••@example.com");
  assert.equal(maskEmail("invalid"), null);
  assert.doesNotMatch(API, /\n\s*email:\s*s\./, "must not return the buyer's exact email");
  assert.doesNotMatch(API, /\n\s*shipping:\s*/, "must not return a shipping address");
  assert.match(API, /email_hint:\s*maskEmail\(/);
});

test("confirmation endpoint requires a completed Checkout Session and minimizes errors", () => {
  assert.match(API, /s\.status\s*!==\s*'complete'/,
    "an open or expired session must not reveal an order summary");
  assert.doesNotMatch(API, /detail:\s*err/,
    "Stripe error details must not be reflected to anonymous callers");
  assert.match(API, /'cache-control':\s*'private, no-store'/);
  assert.match(API, /'referrer-policy':\s*'no-referrer'/);
});

test("confirmation page does not leak the capability URL or expect a raw email", () => {
  assert.match(PAGE, /<meta\s+name="referrer"\s+content="no-referrer">/);
  assert.match(PAGE, /o\.email_hint/);
  assert.doesNotMatch(PAGE, /o\.email(?!_hint)/);
  assert.doesNotMatch(TRACK, /path:\s*location\.pathname\s*\+\s*location\.search/,
    "first-party analytics must not copy sensitive query strings into beacon payloads");
});
