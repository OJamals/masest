// Canonical derived order lifecycle.
//
// The database `orders.status` field still carries accounting state: `net_open`
// means an open receivable, and must not be overwritten by shipment progress.
// This module gives staff and buyers a single operational lifecycle without
// changing those ledger-safe status values.

const CLOSED_STATUSES = new Set(["cart", "cancelled", "refunded"]);
const SETTLED_STATUSES = new Set(["paid", "net_paid", "fulfilled"]);
const TRACKING_STATUSES = new Set(["processing", "packing", "shipped", "delivered", "blocked"]);

const STAGE_LABELS = {
  cart: "Cart",
  payment_pending: "Payment pending",
  unfulfilled: "Unfulfilled",
  fulfilling: "Fulfilling",
  shipped: "Shipped",
  fulfilled: "Fulfilled",
  delivered_payment_due: "Delivered, payment due",
  complete: "Complete",
  blocked: "Fulfillment hold",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

function clean(value) {
  return String(value || "").trim();
}

function normalizedTracking(order) {
  const status = clean(order?.tracking_status) || "processing";
  return TRACKING_STATUSES.has(status) ? status : "processing";
}

function paymentStage(order, status) {
  const method = clean(order?.payment_method);
  if (status === "cart" || status === "cancelled" || status === "refunded") return status;
  if (status === "pending_payment") return "pending_payment";
  if (status === "net_open") return "net_open";
  if (method === "net" && (status === "net_paid" || status === "fulfilled")) return "net_paid";
  if (SETTLED_STATUSES.has(status)) return "paid";
  return status || "unknown";
}

function fulfillmentStage(status, tracking) {
  if (CLOSED_STATUSES.has(status)) return "closed";
  if (tracking === "blocked") return "blocked";
  if (tracking === "delivered") return "delivered";
  if (tracking === "shipped") return "shipped";
  if (tracking === "packing") return "packing";
  if (status === "fulfilled") return "fulfilled";
  return "unfulfilled";
}

function stageFor({ status, payment, fulfillment }) {
  if (status === "cart") return "cart";
  if (status === "cancelled") return "cancelled";
  if (status === "refunded") return "refunded";
  if (payment === "pending_payment") return "payment_pending";
  if (fulfillment === "blocked") return "blocked";
  if (fulfillment === "delivered") return SETTLED_STATUSES.has(status) ? "complete" : "delivered_payment_due";
  if (fulfillment === "shipped") return "shipped";
  if (fulfillment === "packing") return "fulfilling";
  if (fulfillment === "fulfilled") return "fulfilled";
  return "unfulfilled";
}

function nextAction(stage, payment) {
  if (stage === "payment_pending") return "collect_payment";
  if (stage === "unfulfilled") return "fulfill_order";
  if (stage === "fulfilling") return "add_tracking";
  if (stage === "shipped" || stage === "fulfilled") return "monitor_delivery";
  if (stage === "delivered_payment_due") return "record_payment";
  if (stage === "blocked") return "resolve_hold";
  if (stage === "complete") return "complete";
  if (stage === "cancelled" || stage === "refunded" || stage === "cart") return "closed";
  if (payment === "net_open") return "record_payment";
  return "review_order";
}

export function orderLifecycle(order = {}) {
  const status = clean(order.status);
  const tracking = normalizedTracking(order);
  const payment = paymentStage(order, status);
  const fulfillment = fulfillmentStage(status, tracking);
  const stage = stageFor({ status, payment, fulfillment });
  const isComplete = stage === "complete";
  const closed = stage === "cart" || stage === "cancelled" || stage === "refunded";

  return {
    stage,
    label: STAGE_LABELS[stage] || stage,
    payment_stage: payment,
    fulfillment_stage: fulfillment,
    next_action: nextAction(stage, payment),
    requires_payment: payment === "pending_payment" || payment === "net_open",
    requires_fulfillment: !closed && !isComplete && fulfillment !== "delivered",
    is_active: !closed && !isComplete,
    is_complete: isComplete,
  };
}

export function decorateOrderLifecycle(order = {}) {
  return { ...order, lifecycle: orderLifecycle(order) };
}

export function shouldPromoteToFulfilled(order = {}, trackingStatus, trackingNumber = null) {
  const status = clean(order.status);
  const tracking = clean(trackingStatus);
  if (!SETTLED_STATUSES.has(status)) return false;
  if (tracking === "delivered") return true;
  return tracking === "shipped" && Boolean(clean(trackingNumber));
}

export function settledOrderStatus(order = {}, settledStatus = "net_paid") {
  const status = clean(settledStatus) || "net_paid";
  const settledOrder = { ...order, status };
  return shouldPromoteToFulfilled(settledOrder, settledOrder.tracking_status, settledOrder.tracking_number)
    ? "fulfilled"
    : status;
}
