import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync(new URL("../js/business.js", import.meta.url), "utf8");

test("Stripe payment portal renders explicit setup and launch states", () => {
  assert.match(src, /data-payment-state=/, "payment setup card should expose setup state");
  assert.match(src, /Opening Stripe/, "portal launch should show in-progress copy");
  assert.match(src, /Payment portal opened in this tab/, "successful launch should announce redirect");
  assert.match(src, /Stripe is not configured for this workspace yet/, "not-configured copy should be specific");
  assert.match(src, /button\.textContent = originalText/, "button label should recover after failure");
});
