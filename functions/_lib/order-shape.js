// Pure persistence-shape helpers for the Stripe webhook (functions/api/stripe-webhook.js).
// No env, no I/O, no SDK imports — so the paid-order / line-item / stock shapes can be
// unit-tested without the Stripe or Supabase packages. The webhook handler imports these,
// so the shapes have a single source of truth that tests pin (tests/stripe-webhook-shape.test.mjs).

// Stripe amounts are integer minor units (cents). Null/undefined → 0.
export function centsToAmount(cents) {
  return (cents ?? 0) / 100;
}

// Parse the cart JSON stashed in checkout-session metadata. Malformed / missing / non-array → [].
export function parseCartMetadata(raw) {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// The `orders` row for a paid `checkout.session.completed` event. Mirrors the insert in
// onRequestPost: cents→dollars, qbo sync queued, currency default, ship-address fallback chain.
// customer_email is resolved by the caller (buyerEmailFromStripeSession) and passed in so this
// stays pure (no checkout-session import).
export function orderRowFromSession(session, customerEmail = null) {
  const s = session || {};
  return {
    company_id: s.metadata?.company_id || null,
    status: "paid",
    payment_method: "stripe",
    qbo_sync_status: "pending",
    subtotal: centsToAmount(s.amount_subtotal),
    tax: centsToAmount(s.total_details?.amount_tax),
    total: centsToAmount(s.amount_total),
    currency: s.currency || "usd",
    stripe_payment_intent: s.payment_intent,
    customer_email: customerEmail ?? null,
    ship_address: s.shipping_details || s.customer_details || null,
  };
}

// Normalize raw cart entries (keyed by variant SKU) → order line items.
export function cartLines(cart) {
  return (cart || []).map((c) => ({
    sku: c.sku,
    product_sku: c.product_sku || null,
    name: c.name || c.sku,
    qty: c.qty,
    unit_price: c.unit_price,
    backordered: !!c.backordered,
  }));
}

// `order_items` rows for a created order. line_total = unit_price * qty (raw, no rounding).
export function orderItemRows(lines, orderId) {
  return (lines || []).map((l) => ({
    order_id: orderId,
    sku: l.sku,
    product_sku: l.product_sku,
    name: l.name,
    qty: l.qty,
    unit_price: l.unit_price,
    line_total: l.unit_price * l.qty,
    backordered: !!l.backordered,
  }));
}

// RPC arg objects for `decrement_variant_stock`. Lines without a SKU are skipped
// (matches the webhook's `if (!l.sku) continue`); backordered lines are skipped too —
// their stock is already at/below zero, so decrementing would fail the whole order.
export function stockDecrements(lines) {
  return (lines || [])
    .filter((l) => l.sku && !l.backordered)
    .map((l) => ({ p_vsku: l.sku, p_qty: Number(l.qty || 0) }));
}

// RPC arg objects for `increment_variant_stock` — returns refunded line items to
// inventory on a full refund. Same shape as the decrement args (only the RPC differs).
export function stockIncrements(lines) {
  return (lines || [])
    .filter((l) => l.sku)
    .map((l) => ({ p_vsku: l.sku, p_qty: Number(l.qty || 0) }));
}

// Subscription-mode checkout takes the program-enrollment path, not the order path.
export function isSubscriptionCheckout(session) {
  return session?.mode === "subscription";
}

// `program_subscriptions` upsert row for a subscription-mode checkout.
export function subscriptionRow(session) {
  const s = session || {};
  return {
    company_id: s.metadata?.company_id || null,
    tier: s.metadata?.tier || null,
    stripe_subscription_id: s.subscription || null,
    stripe_customer_id: s.customer || null,
    status: "active",
  };
}

// A subscription is live (bills the customer) until terminally canceled. A tier
// change for any of these MUST swap the price on the SAME Stripe subscription —
// creating a second one would double-bill.
const LIVE_SUB_STATUSES = ["active", "trialing", "past_due", "checkout"];

// Decide what POST /api/programs/subscribe should do for `tier`, given the
// company's most-recent subscription row (or null). Pure: no Stripe/DB calls —
// the handler executes the verdict. Guards the double-billing risk: an existing
// live subscription is updated in place, never duplicated.
export function subscribeAction(existing, tier) {
  if (existing && LIVE_SUB_STATUSES.includes(existing.status) && existing.stripe_subscription_id) {
    if (existing.tier === tier) return { action: "unchanged" };
    return { action: "swap", subscriptionId: existing.stripe_subscription_id };
  }
  return { action: "checkout" };
}
