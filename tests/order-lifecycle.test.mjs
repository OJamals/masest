import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as lifecycle from "../functions/_lib/order-lifecycle.js";

const { orderLifecycle, decorateOrderLifecycle, shouldPromoteToFulfilled } = lifecycle;

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("paid Stripe orders enter the unfulfilled queue until fulfillment starts", () => {
  const lifecycle = orderLifecycle({ status: "paid", payment_method: "stripe", tracking_status: "processing" });
  assert.equal(lifecycle.stage, "unfulfilled");
  assert.equal(lifecycle.label, "Unfulfilled");
  assert.equal(lifecycle.payment_stage, "paid");
  assert.equal(lifecycle.fulfillment_stage, "unfulfilled");
  assert.equal(lifecycle.next_action, "fulfill_order");
  assert.equal(lifecycle.is_active, true);
  assert.equal(lifecycle.is_complete, false);
});

test("NET paid orders remain active until delivered", () => {
  const lifecycle = orderLifecycle({ status: "net_paid", payment_method: "net", tracking_status: "processing" });
  assert.equal(lifecycle.stage, "unfulfilled");
  assert.equal(lifecycle.payment_stage, "net_paid");
  assert.equal(lifecycle.next_action, "fulfill_order");
  assert.equal(lifecycle.is_active, true);
});

test("delivered settled orders are complete even without a carrier tracking number", () => {
  const lifecycle = orderLifecycle({ status: "paid", payment_method: "stripe", tracking_status: "delivered" });
  assert.equal(lifecycle.stage, "complete");
  assert.equal(lifecycle.label, "Complete");
  assert.equal(lifecycle.is_complete, true);
  assert.equal(lifecycle.is_active, false);
  assert.equal(shouldPromoteToFulfilled({ status: "paid" }, "delivered", ""), true);
});

test("shipped NET-open orders stay financially open until payment is recorded", () => {
  const lifecycle = orderLifecycle({ status: "net_open", payment_method: "net", tracking_status: "delivered" });
  assert.equal(lifecycle.stage, "delivered_payment_due");
  assert.equal(lifecycle.label, "Delivered, payment due");
  assert.equal(lifecycle.requires_payment, true);
  assert.equal(lifecycle.is_complete, false);
  assert.equal(lifecycle.next_action, "record_payment");
  assert.equal(shouldPromoteToFulfilled({ status: "net_open" }, "delivered", "BOL-42"), false);
});

test("settling already shipped or delivered NET orders closes fulfillment", () => {
  assert.equal(typeof lifecycle.settledOrderStatus, "function");
  const { settledOrderStatus } = lifecycle;
  assert.equal(settledOrderStatus({ status: "net_open", tracking_status: "delivered" }), "fulfilled");
  assert.equal(settledOrderStatus({ status: "net_open", tracking_status: "shipped", tracking_number: "1Z999" }), "fulfilled");
  assert.equal(settledOrderStatus({ status: "net_open", tracking_status: "packing" }), "net_paid");
});

test("decorating an order preserves original fields and adds lifecycle", () => {
  const order = decorateOrderLifecycle({ id: "ord-1", status: "net_paid", payment_method: "net" });
  assert.equal(order.id, "ord-1");
  assert.equal(order.lifecycle.stage, "unfulfilled");
});

test("admin and account APIs expose the same derived lifecycle to staff and buyers", () => {
  for (const path of ["functions/api/admin/orders.js", "functions/api/account/orders.js", "functions/api/account/order.js"]) {
    const src = read(path);
    assert.match(src, /decorateOrderLifecycle/);
  }
});

test("buyer order lists carry QuickBooks invoice state for NET orders", () => {
  const src = read("functions/api/account/orders.js");
  assert.match(src, /qbo_invoice_id/);
  assert.match(src, /qbo_sync_status/);
});

test("NET settlement actions preserve shipment completion when payment arrives after delivery", () => {
  const src = read("functions/api/admin/orders.js");
  assert.match(src, /settledOrderStatus/);
  assert.match(src, /tracking_status,tracking_number/);
});

test("generic order edits cannot settle open NET receivables", () => {
  assert.equal(typeof lifecycle.planOrderStatusWrite, "function");
  const { planOrderStatusWrite } = lifecycle;
  assert.deepEqual(planOrderStatusWrite({ status: "net_open", payment_method: "net" }, "fulfilled"), {
    ok: false,
    error: "use_net_settlement_action",
  });
  assert.deepEqual(planOrderStatusWrite({ status: "net_open", payment_method: "net" }, "net_paid"), {
    ok: false,
    error: "use_net_settlement_action",
  });
  assert.deepEqual(planOrderStatusWrite({ status: "net_open", payment_method: "net" }, "paid"), {
    ok: false,
    error: "use_net_settlement_action",
  });
  assert.deepEqual(planOrderStatusWrite({ status: "net_open", payment_method: "net" }, "cancelled"), {
    ok: true,
    status: "cancelled",
  });
});

test("admin generic status writes use the NET receivable guard", () => {
  const src = read("functions/api/admin/orders.js");
  assert.match(src, /planOrderStatusWrite\(before,\s*normalized\.patch\.status\)/);
  assert.match(src, /planOrderStatusWrite\(before,\s*body\.status\)/);
});

test("admin status dropdown narrows open NET orders to safe generic transitions", () => {
  const src = read("js/admin/orders.js");
  assert.match(src, /OPEN_NET_STATUS_OPTIONS/);
  assert.match(src, /function orderStatusOptions\(selected,\s*order = \{\}\)/);
  assert.match(src, /orderStatusOptions\(order\.status,\s*order\)/g);
});

test("dashboard actions use the server lifecycle aggregate", () => {
  const src = read("js/dashboard.js");
  assert.match(src, /renderBuyerActionRail\(\{ activeTotal = 0/);
  assert.match(src, /detail: `\$\{activeTotal\} active/);
  assert.doesNotMatch(src, /function orderIsActive/);
  assert.doesNotMatch(src, /TERMINAL_ORDER_STATES/);
});

test("admin orders UI surfaces lifecycle stage and next action", () => {
  const src = read("js/admin/orders.js");
  assert.match(src, /function lifecycleFor/);
  assert.match(src, /function lifecycleSummary/);
  assert.match(src, /nextActionLabel/);
});
