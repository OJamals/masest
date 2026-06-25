import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync(new URL("../js/business.js", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../js/dashboard.js", import.meta.url), "utf8");

test("Stripe payment portal moved out of the business hub into the user context", () => {
  // Stripe card management now lives only on the user-context Payment methods tab (dashboard.js);
  // the business hub keeps the QuickBooks invoicing portal instead.
  assert.doesNotMatch(src, /data-payment-state=/, "business hub should no longer render the Stripe payment-setup card");
  assert.doesNotMatch(src, /function renderPaymentSetup/, "business hub should not own the Stripe portal");
  assert.match(src, /function renderInvoicing/, "business hub should render the QuickBooks invoicing portal");
  // The user-context portal still keeps its explicit launch states (covered fully below).
  assert.match(dashboard, /Opening Stripe/, "user payment portal should show in-progress copy");
  assert.match(dashboard, /Payment portal opened in a new tab/, "successful launch should announce the new-tab handoff");
});

test("dashboard payment portal uses the same explicit states", () => {
  assert.match(dashboard, /Opening Stripe/, "dashboard portal launch should show Stripe-specific progress");
  assert.match(dashboard, /openReservedTab/, "dashboard portal should reserve a new tab before awaiting Stripe");
  assert.match(dashboard, /Payment portal opened in a new tab/, "dashboard portal should announce the new-tab handoff");
  assert.match(dashboard, /Stripe is not configured for this workspace yet/, "dashboard not-configured copy should be specific");
  assert.match(dashboard, /btn\.textContent = originalText/, "dashboard button label should recover after failure");
});
