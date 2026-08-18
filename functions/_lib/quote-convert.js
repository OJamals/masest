// Pure item-cleaning + order-shape for the admin "convert a quote/lead into a NET order"
// action (functions/api/admin/quotes.js). No I/O — unit-tested by tests/quote-convert.test.mjs.
import { normalizeCartQuantities } from "./order-shape.js";

// Validate + normalize one requested line. Returns null if invalid (caller → 400 invalid_item).
// qty is clamped to >= 1; price must be a finite number >= 0; sku is required.
export function cleanConvertItem(it) {
  const qty = Math.max(1, parseInt(it?.qty, 10) || 0);
  const price = Number(it?.unit_price);
  const sku = String(it?.sku || "").trim();
  const productSku = String(it?.product_sku || sku).trim();
  if (!sku || !Number.isFinite(price) || price < 0 || qty < 1) return null;
  return {
    sku,
    product_sku: productSku,
    name: String(it?.name || sku).trim(),
    qty,
    unit_price: price,
    line_total: +(price * qty).toFixed(2),
  };
}

// Clean every requested line. Any invalid line — or an empty/non-array list — yields
// { error: 'invalid_item' } (no partial or zero-line orders, matching the inline guard).
// On success → { items: <clean rows>, subtotal: <2dp sum of line_total> }.
export function buildConvertItems(items) {
  const list = Array.isArray(items) ? items : [];
  const clean = [];
  for (const it of list) {
    const row = cleanConvertItem(it);
    if (!row) return { error: "invalid_item" };
    clean.push(row);
  }
  if (!clean.length) return { error: "invalid_item" };
  const quantities = normalizeCartQuantities(clean);
  if (!quantities || Object.keys(quantities).length !== clean.length) {
    return { error: "invalid_item" };
  }
  const subtotal = +clean.reduce((s, i) => s + i.line_total, 0).toFixed(2);
  return { items: clean, subtotal };
}

// The `orders` row for a NET (invoice) order created from a quote.
export function netOrderRow(companyId, subtotal) {
  return {
    company_id: companyId,
    status: "net_open",
    payment_method: "net",
    qbo_sync_status: "pending",
    subtotal,
    total: subtotal,
    currency: "usd",
  };
}

// A quote offer stays in the existing orders/order_items model. It is a buyer-owned
// cart draft until checkout creates the final tracked order.
export function quoteOrderRow({
  companyId,
  userId,
  email,
  subtotal,
  currency = "usd",
}) {
  return {
    company_id: companyId,
    user_id: userId,
    customer_email: email,
    status: "cart",
    payment_method: "stripe",
    qbo_sync_status: null,
    subtotal,
    total: subtotal,
    currency: String(currency || "usd").toLowerCase(),
  };
}

export function quotePayloadWithOffer(payload, {
  orderId,
  status,
  at,
  finalOrderId,
  expiresAt,
}) {
  const next = payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...payload }
    : {};
  next.offer_order_id = orderId;
  next.offer_status = status;
  if (at) next[`offer_${status}_at`] = at;
  if (finalOrderId) next.final_order_id = finalOrderId;
  if (expiresAt) next.offer_expires_at = expiresAt;
  return next;
}
