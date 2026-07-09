import test from "node:test";
import assert from "node:assert/strict";
import { isReminderDue } from "../functions/_lib/reviews.js";
import { onRequestPost } from "../functions/api/admin/review-reminders.js";

const NOW = Date.parse("2026-07-08T00:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

test("delivered ≥10d ago, not yet reminded, has email → due", () => {
  assert.equal(isReminderDue({ tracking_status: "delivered", shipped_at: daysAgo(11), customer_email: "a@x.com", review_reminded_at: null }, NOW), true);
});
test("fulfilled ≥10d ago with no delivery tracking → due (fallback)", () => {
  assert.equal(isReminderDue({ status: "fulfilled", updated_at: daysAgo(12), customer_email: "a@x.com", review_reminded_at: null }, NOW), true);
});
test("delivered but <10d → not due", () => {
  assert.equal(isReminderDue({ tracking_status: "delivered", shipped_at: daysAgo(3), customer_email: "a@x.com", review_reminded_at: null }, NOW), false);
});
test("already reminded → not due", () => {
  assert.equal(isReminderDue({ tracking_status: "delivered", shipped_at: daysAgo(30), customer_email: "a@x.com", review_reminded_at: daysAgo(1) }, NOW), false);
});
test("no email → not due", () => {
  assert.equal(isReminderDue({ tracking_status: "delivered", shipped_at: daysAgo(30), customer_email: "", review_reminded_at: null }, NOW), false);
});
test("not delivered/fulfilled → not due", () => {
  assert.equal(isReminderDue({ status: "paid", tracking_status: "shipped", shipped_at: daysAgo(30), customer_email: "a@x.com", review_reminded_at: null }, NOW), false);
});

const reminderReq = (body, secret = null) => ({
  headers: { get: (key) => (key.toLowerCase() === "x-review-crm-secret" ? secret : null) },
  json: async () => body,
});

test("review reminder endpoint rejects unknown actions before cron auth", async () => {
  const res = await onRequestPost({
    request: reminderReq({ action: "nope" }),
    env: { REVIEW_CRM_SECRET: "right" },
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "bad_action" });
});

test("review reminder endpoint requires the cron shared secret", async () => {
  const missing = await onRequestPost({
    request: reminderReq({ action: "sweep_due" }),
    env: { REVIEW_CRM_SECRET: "right" },
  });
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: "unauthorized" });

  const wrong = await onRequestPost({
    request: reminderReq({ action: "sweep_due" }, "wrong"),
    env: { REVIEW_CRM_SECRET: "right" },
  });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { error: "unauthorized" });
});
