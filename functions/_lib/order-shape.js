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
  }));
}

// RPC arg objects for `decrement_variant_stock`. Lines without a SKU are skipped
// (matches the webhook's `if (!l.sku) continue`).
export function stockDecrements(lines) {
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
