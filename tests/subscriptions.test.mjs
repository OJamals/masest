import assert from "node:assert/strict";
import test from "node:test";
import { subscribeAction } from "../functions/_lib/order-shape.js";
import { portalFlowData } from "../functions/api/account/billing-portal.js";

// subscribeAction is the double-billing guard: a live subscription is updated in
// place (swap), never duplicated. Only first-time / non-live rows create a checkout.

test("no existing subscription → checkout", () => {
  assert.deepEqual(subscribeAction(null, "Gold"), { action: "checkout" });
  assert.deepEqual(subscribeAction(undefined, "Gold"), { action: "checkout" });
});

test("live subscription + different tier → swap on same subscription (no duplicate)", () => {
  for (const status of ["active", "trialing", "past_due", "checkout"]) {
    assert.deepEqual(
      subscribeAction({ tier: "Silver", status, stripe_subscription_id: "sub_1" }, "Gold"),
      { action: "swap", subscriptionId: "sub_1" },
    );
  }
});

test("live subscription + same tier → unchanged (no Stripe call)", () => {
  assert.deepEqual(
    subscribeAction({ tier: "Gold", status: "active", stripe_subscription_id: "sub_1" }, "Gold"),
    { action: "unchanged" },
  );
});

test("canceled subscription → re-enroll via checkout", () => {
  assert.deepEqual(
    subscribeAction({ tier: "Gold", status: "canceled", stripe_subscription_id: "sub_1" }, "Gold"),
    { action: "checkout" },
  );
});

test("stale checkout placeholder (no subscription id) does not block / mis-swap", () => {
  assert.deepEqual(
    subscribeAction({ tier: "Gold", status: "checkout", stripe_subscription_id: null }, "Gold"),
    { action: "checkout" },
  );
});

// portalFlowData deep-links the Customer Portal into a cancel/update flow only when
// given a subscription id; otherwise the portal opens on its landing page.

test("portalFlowData builds cancel/update flows, null without a subscription", () => {
  const url = "https://masest.co/dashboard.html#programs";
  assert.equal(portalFlowData("cancel", "", url), null);
  assert.equal(portalFlowData("update", undefined, url), null);
  assert.equal(portalFlowData("bogus", "sub_1", url), null);

  assert.deepEqual(portalFlowData("cancel", "sub_1", url), {
    type: "subscription_cancel",
    subscription_cancel: { subscription: "sub_1" },
    after_completion: { type: "redirect", redirect: { return_url: url } },
  });
  assert.deepEqual(portalFlowData("update", "sub_1", url), {
    type: "subscription_update",
    subscription_update: { subscription: "sub_1" },
    after_completion: { type: "redirect", redirect: { return_url: url } },
  });
});
