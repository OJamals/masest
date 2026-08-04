import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const STRIPE = read("../functions/api/stripe-webhook.js");
const STRIPE_EFFECTS = read("../functions/_lib/integration-effects.js");
const TEAM = read("../functions/api/account/team.js");

test("order confirmation email routes through sendEmail (logged + suppressed)", () => {
  assert.match(STRIPE, /checkoutOrderEffects/);
  assert.match(STRIPE_EFFECTS, /sendEmail/);
  assert.match(STRIPE_EFFECTS, /category:\s*'order'/);
  assert.match(STRIPE_EFFECTS, /sendOrderConfirmationEffect/);
  assert.doesNotMatch(STRIPE, /api\.resend\.com/, "no direct Resend fetch anymore");
  assert.doesNotMatch(STRIPE_EFFECTS, /api\.resend\.com/, "no direct Resend fetch in the worker");
});

test("team invite email routes through sendEmail", () => {
  assert.match(TEAM, /sendEmail\(/);
  assert.match(TEAM, /category:\s*'team'/);
  assert.doesNotMatch(TEAM, /api\.resend\.com/, "no direct Resend fetch anymore");
});
