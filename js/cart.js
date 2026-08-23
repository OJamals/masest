/* MASEST commerce cart.
 * Browser storage is only a convenience; the checkout API re-prices every line.
 */
import { safeUrl } from "./util.js";
import { normalizeCartLines, normalizeCartQty } from "./cart-shape.js";

const KEY = "masest_cart";
const QUOTE_KEY = "masest_quote_checkout_v1";
const PRESENTATION_KEY = "masest_cart_presentation_v1";

export class CheckoutError extends Error {
  constructor(status, payload = {}) {
    super(payload.message || payload.error || "checkout_failed");
    this.name = "CheckoutError";
    this.status = status;
    this.code = payload.error || "checkout_failed";
    Object.assign(this, payload);
  }
}

function safeReadCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([sku, qty]) => [String(sku), normalizeCartQty(qty)])
        .filter(([sku, qty]) => sku && qty > 0)
    );
  } catch (err) {
    localStorage.removeItem(KEY);
    return {};
  }
}

function normalizePresentationContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (String(value.market || "").trim().toLowerCase() !== "marine") return null;
  const name = String(value.name || "").trim().replace(/\s+/g, " ").slice(0, 120);
  const product = String(value.product || "").trim().toLowerCase();
  if (!name || !/^[a-z0-9-]{1,80}$/.test(product)) return null;
  return { market: "marine", name, product };
}

function safeReadPresentation() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRESENTATION_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).slice(0, 100)
        .map(([sku, value]) => [String(sku), normalizePresentationContext(value)])
        .filter(([sku, value]) => sku && sku.length <= 160 && value)
    );
  } catch {
    localStorage.removeItem(PRESENTATION_KEY);
    return {};
  }
}

function cartSignature(lines) {
  return JSON.stringify(
    lines
      .map(({ sku, qty }) => ({ sku: String(sku), qty: normalizeCartQty(qty) }))
      .sort((a, b) => a.sku.localeCompare(b.sku))
  );
}

function write(cart, presentation = safeReadPresentation()) {
  localStorage.removeItem(QUOTE_KEY);
  localStorage.setItem(KEY, JSON.stringify(cart));
  const activePresentation = Object.fromEntries(
    Object.entries(presentation)
      .filter(([sku]) => Object.hasOwn(cart, sku))
      .map(([sku, value]) => [sku, normalizePresentationContext(value)])
      .filter(([, value]) => value)
  );
  if (Object.keys(activePresentation).length) {
    localStorage.setItem(PRESENTATION_KEY, JSON.stringify(activePresentation));
  } else {
    localStorage.removeItem(PRESENTATION_KEY);
  }
  const detail = { count: count(), items: items() };
  document.dispatchEvent(new CustomEvent("cart:updated", { detail }));
  document.dispatchEvent(new CustomEvent("masest:cart", { detail }));
}

export function add(sku, qty = 1, context = null) {
  const cleanSku = String(sku || "").trim();
  if (!cleanSku) throw new Error("sku_required");
  const cart = safeReadCart();
  const presentation = safeReadPresentation();
  const normalizedContext = normalizePresentationContext(context);
  if (normalizedContext) presentation[cleanSku] = normalizedContext;
  cart[cleanSku] = Math.max(1, (cart[cleanSku] || 0) + normalizeCartQty(qty || 1));
  write(cart, presentation);
}

export function setQty(sku, qty, context = null) {
  const cleanSku = String(sku || "").trim();
  if (!cleanSku) return;
  const cart = safeReadCart();
  const presentation = safeReadPresentation();
  const normalizedContext = normalizePresentationContext(context);
  if (normalizedContext) presentation[cleanSku] = normalizedContext;
  const cleanQty = normalizeCartQty(qty);
  if (cleanQty <= 0) delete cart[cleanSku];
  else cart[cleanSku] = cleanQty;
  write(cart, presentation);
}

export function remove(sku) {
  setQty(sku, 0);
}

export function clear() {
  write({}, {});
}

export function items() {
  return Object.entries(safeReadCart()).map(([sku, qty]) => ({ sku, qty }));
}

export function count() {
  return Object.values(safeReadCart()).reduce((total, qty) => total + qty, 0);
}

export function presentationContext(sku) {
  const cleanSku = String(sku || "").trim();
  return cleanSku ? safeReadPresentation()[cleanSku] || null : null;
}

export function replaceWithQuote({ quoteId, orderId, items: offerItems } = {}) {
  const cleanQuoteId = String(quoteId || "").trim();
  const cleanOrderId = String(orderId || "").trim();
  if (!cleanQuoteId || !cleanOrderId || !Array.isArray(offerItems)) {
    throw new Error("quote_offer_invalid");
  }
  const lines = normalizeCartLines(offerItems, { merge: false });
  if (!lines.length || lines.length !== offerItems.length) throw new Error("quote_offer_invalid");
  const cart = Object.fromEntries(lines.map(({ sku, qty }) => [sku, qty]));
  write(cart, {});
  localStorage.setItem(QUOTE_KEY, JSON.stringify({
    quote_id: cleanQuoteId,
    quote_order_id: cleanOrderId,
    cart: cartSignature(items()),
  }));
}

export function acceptedQuoteContext(lines) {
  try {
    const value = JSON.parse(localStorage.getItem(QUOTE_KEY) || "null");
    if (!value || typeof value !== "object"
      || !value.quote_id || !value.quote_order_id
      || value.cart !== cartSignature(lines)) return null;
    return {
      quote_id: String(value.quote_id),
      quote_order_id: String(value.quote_order_id),
    };
  } catch {
    localStorage.removeItem(QUOTE_KEY);
    return null;
  }
}

// Card/ACH only. Ordering on NET terms is not self-serve — sales raises those orders
// from an accepted quote, so this never asks /api/checkout for anything but 'pay'.
export async function checkout({
  email,
  token,
  purchaseOrderNumber,
  shippingQuoteToken,
  applyStoreCredit = false,
  checkoutIntentId = null,
} = {}) {
  const line = items();
  if (!line.length) throw new Error("cart_empty");

  // Funnel event: checkout initiated (best-effort; no-op if track.js absent).
  try { if (typeof window !== "undefined" && typeof window.mtrack === "function") window.mtrack("checkout_start"); } catch (e) { /* best-effort */ }

  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const payload = {
    mode: "pay",
    email,
    purchase_order_number: purchaseOrderNumber,
    shipping_quote_token: shippingQuoteToken || undefined,
    cart: line,
  };
  const quote = acceptedQuoteContext(line);
  if (quote) {
    Object.assign(payload, quote);
  } else if (applyStoreCredit === true) {
    const intentId = String(checkoutIntentId || '').trim();
    if (!intentId) throw new Error('checkout_intent_id_required');
    payload.apply_store_credit = true;
    payload.checkout_intent_id = intentId;
  }

  const response = await fetch("/api/checkout", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const out = await response.json().catch(() => ({}));
  if (!response.ok) throw new CheckoutError(response.status, out);

  if (out.url) {
    window.location.href = safeUrl(out.url);
    return out;
  }

  clear();
  return out;
}

if (typeof window !== "undefined") {
  window.MASEST = Object.assign(window.MASEST || {}, {
    cart: { add, setQty, remove, clear, items, count, presentationContext, replaceWithQuote, checkout },
  });
}
