import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync(new URL("../js/business.js", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../js/dashboard.js", import.meta.url), "utf8");

test("Stripe payment portal renders explicit setup and launch states", () => {
  assert.match(src, /data-payment-state=/, "payment setup card should expose setup state");
  assert.match(src, /Opening Stripe/, "portal launch should show in-progress copy");
  assert.match(src, /openReservedTab/, "portal launch should reserve a new tab before awaiting Stripe");
  assert.match(src, /Payment portal opened in a new tab/, "successful launch should announce the new-tab handoff");
  assert.match(src, /Stripe is not configured for this workspace yet/, "not-configured copy should be specific");
  assert.match(src, /button\.textContent = originalText/, "button label should recover after failure");
});

test("dashboard payment portal uses the same explicit states", () => {
  assert.match(dashboard, /Opening Stripe/, "dashboard portal launch should show Stripe-specific progress");
  assert.match(dashboard, /openReservedTab/, "dashboard portal should reserve a new tab before awaiting Stripe");
  assert.match(dashboard, /Payment portal opened in a new tab/, "dashboard portal should announce the new-tab handoff");
  assert.match(dashboard, /Stripe is not configured for this workspace yet/, "dashboard not-configured copy should be specific");
  assert.match(dashboard, /btn\.textContent = originalText/, "dashboard button label should recover after failure");
});
