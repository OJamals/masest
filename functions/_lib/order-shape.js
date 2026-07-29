// Pure persistence-shape helpers for the Stripe webhook (functions/api/stripe-webhook.js).
// No env, no I/O, no SDK imports — so the paid-order / line-item / stock shapes can be
// unit-tested without the Stripe or Supabase packages. The webhook handler imports these,
// so the shapes have a single source of truth that tests pin (tests/stripe-webhook-shape.test.mjs).

// Stripe amounts are integer minor units (cents). Null/undefined → 0.
export function centsToAmount(cents) {
  return (cents ?? 0) / 100;
}

// Production QBO must never receive Stripe sandbox transactions.
export function stripeQboSyncStatus(livemode) {
  return livemode === false ? "skipped" : "pending";
}

// Reassemble the chunked cart metadata (cart, cart2, cart3…) written by
// cartMetadataEntries() back into one JSON string. Single-key legacy sessions
// (pre-chunking) pass through unchanged.
export function assembleCartMetadata(metadata) {
  const md = metadata || {};
  if (md.cart == null) return "";
  let raw = String(md.cart);
  for (let i = 2; md[`cart${i}`] != null; i += 1) raw += String(md[`cart${i}`]);
  return raw;
}

// Parse the cart JSON stashed in checkout-session metadata. Malformed / missing /
// non-array → []. Accepts both the legacy full shape ({sku,name,qty,unit_price,…})
// and the compact chunked shape ({s,ps,q,p,b}) — names are absent in the compact
// shape and re-derived from the DB by the webhook.
export function parseCartMetadata(raw) {
  try {
    const v = JSON.parse(raw || "[]");
    if (!Array.isArray(v)) return [];
    return v.map((c) => ({
      sku: c.sku ?? c.s,
      product_sku: c.product_sku ?? c.ps ?? null,
      name: c.name ?? null,
      qty: c.qty ?? c.q,
      unit_price: c.unit_price ?? c.p,
      backordered: !!(c.backordered ?? c.b),
    }));
  } catch {
    return [];
  }
}

export function normalizeCartQuantities(cart, {
  maxLines = 50,
  maxSkuLength = 80,
  maxQuantity = 999,
} = {}) {
  if (!Array.isArray(cart)) return Object.create(null);
  const qtyBySku = Object.create(null);
  let distinctLines = 0;
  for (const item of cart) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.sku !== "string") return null;
    const sku = item.sku.trim();
    if (!sku || sku.length > maxSkuLength || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > maxQuantity) return null;
    if (qtyBySku[sku] === undefined) {
      if (++distinctLines > maxLines) return null;
      qtyBySku[sku] = 0;
    }
    if ((qtyBySku[sku] += item.qty) > maxQuantity) return null;
  }
  return qtyBySku;
}

// The `orders` row for a paid `checkout.session.completed` event. Mirrors the insert in
// onRequestPost: cents→dollars, QBO mode gate, currency default, ship-address fallback chain.
// customer_email is resolved by the caller (buyerEmailFromStripeSession) and passed in so this
// stays pure (no checkout-session import).
export function orderRowFromSession(session, customerEmail = null) {
  const s = session || {};
  // ACH (us_bank_account) sessions complete while the debit is still processing
  // (payment_status 'unpaid') and can fail days later — those orders start as
  // pending_payment and are promoted/cancelled by the async_payment_* events.
  const settled = !s.payment_status || s.payment_status === "paid";
  return {
    company_id: s.metadata?.company_id || null,
    status: settled ? "paid" : "pending_payment",
    payment_method: "stripe",
    // null keeps unsettled ACH orders out of the QBO claim queue (claim_qbo_orders
    // only takes 'pending'); async_payment_succeeded flips it to 'pending'.
    qbo_sync_status: settled ? stripeQboSyncStatus(s.livemode) : null,
    subtotal: centsToAmount(s.amount_subtotal),
    shipping: centsToAmount(s.shipping_cost?.amount_subtotal ?? s.total_details?.amount_shipping),
    tax: centsToAmount(s.total_details?.amount_tax),
    total: centsToAmount(s.amount_total),
    currency: s.currency || "usd",
    stripe_payment_intent: s.payment_intent,
    customer_email: customerEmail ?? null,
    purchase_order_number: s.metadata?.purchase_order_number || null,
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

// RPC arg objects for `increment_variant_stock` — returns refunded/cancelled line items
// to inventory. Mirrors stockDecrements: backordered lines were never decremented, so
// incrementing them back would inflate stock.
export function stockIncrements(lines) {
  return (lines || [])
    .filter((l) => l.sku && !l.backordered)
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

function stripeId(value) {
  if (typeof value === "string") return value;
  return value?.id || null;
}

// One paid Stripe subscription invoice becomes one idempotent QBO queue row.
// Store the accounting total exactly as Stripe reported it; a single service line
// carries revenue before tax so the eventual QBO invoice and payment reconcile.
export function qboSubscriptionInvoiceRow(invoice, { companyId, tier } = {}) {
  const inv = invoice || {};
  const total = centsToAmount(inv.total);
  const tax = centsToAmount((inv.total_tax_amounts || []).reduce((sum, row) => sum + Number(row?.amount || 0), 0));
  const subtotal = Math.max(0, Number((total - tax).toFixed(2)));
  const description = String(inv.lines?.data?.[0]?.description || `VertKlean ${tier || "Business"} program`).trim();
  return {
    company_id: companyId || null,
    stripe_invoice_id: inv.id || null,
    stripe_subscription_id: stripeId(inv.subscription),
    stripe_customer_id: stripeId(inv.customer),
    stripe_payment_intent: stripeId(inv.payment_intent),
    customer_email: inv.customer_email || null,
    tier: tier || null,
    description,
    subtotal,
    tax,
    total,
    currency: inv.currency || "usd",
    qbo_sync_status: total > 0 ? stripeQboSyncStatus(inv.livemode) : "skipped",
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
