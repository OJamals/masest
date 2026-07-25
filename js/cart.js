/* MASEST commerce cart.
 * Browser storage is only a convenience; the checkout API re-prices every line.
 */
import { safeUrl } from "./util.js";

const KEY = "masest_cart";
const NET_REQUEST_KEY = "masest_net_request_v1";

export class CheckoutError extends Error {
  constructor(status, payload = {}) {
    super(payload.message || payload.error || "checkout_failed");
    this.name = "CheckoutError";
    this.status = status;
    this.code = payload.error || "checkout_failed";
    Object.assign(this, payload);
  }
}

function normalizeQty(qty) {
  const number = Number(qty);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.floor(number));
}

function safeReadCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([sku, qty]) => [String(sku), normalizeQty(qty)])
        .filter(([sku, qty]) => sku && qty > 0)
    );
  } catch (err) {
    localStorage.removeItem(KEY);
    return {};
  }
}

function cartSignature(lines) {
  return JSON.stringify(
    lines
      .map(({ sku, qty }) => ({ sku: String(sku), qty: normalizeQty(qty) }))
      .sort((a, b) => a.sku.localeCompare(b.sku))
  );
}

function newRequestKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function netRequestKey(lines, purchaseOrderNumber) {
  const cart = JSON.stringify({
    cart: cartSignature(lines),
    purchase_order_number: String(purchaseOrderNumber || "").trim(),
  });
  try {
    const stored = JSON.parse(localStorage.getItem(NET_REQUEST_KEY) || "null");
    if (
      stored
      && typeof stored === "object"
      && typeof stored.key === "string"
      && stored.key.length > 0
      && stored.key.length <= 128
      && stored.cart === cart
    ) {
      return stored.key;
    }
  } catch {
    // Replace malformed convenience storage below.
  }

  const key = newRequestKey();
  localStorage.setItem(NET_REQUEST_KEY, JSON.stringify({ key, cart }));
  return key;
}

function write(cart) {
  localStorage.removeItem(NET_REQUEST_KEY);
  localStorage.setItem(KEY, JSON.stringify(cart));
  const detail = { count: count(), items: items() };
  document.dispatchEvent(new CustomEvent("cart:updated", { detail }));
  document.dispatchEvent(new CustomEvent("masest:cart", { detail }));
}

export function add(sku, qty = 1) {
  const cleanSku = String(sku || "").trim();
  if (!cleanSku) throw new Error("sku_required");
  const cart = safeReadCart();
  cart[cleanSku] = Math.max(1, (cart[cleanSku] || 0) + normalizeQty(qty || 1));
  write(cart);
}

export function setQty(sku, qty) {
  const cleanSku = String(sku || "").trim();
  if (!cleanSku) return;
  const cart = safeReadCart();
  const cleanQty = normalizeQty(qty);
  if (cleanQty <= 0) delete cart[cleanSku];
  else cart[cleanSku] = cleanQty;
  write(cart);
}

export function remove(sku) {
  setQty(sku, 0);
}

export function clear() {
  write({});
}

export function items() {
  return Object.entries(safeReadCart()).map(([sku, qty]) => ({ sku, qty }));
}

export function count() {
  return Object.values(safeReadCart()).reduce((total, qty) => total + qty, 0);
}

export async function checkout({
  mode = "pay",
  email,
  token,
  purchaseOrderNumber,
} = {}) {
  const line = items();
  if (!line.length) throw new Error("cart_empty");

  // Funnel event: checkout initiated (best-effort; no-op if track.js absent).
  try { if (typeof window !== "undefined" && typeof window.mtrack === "function") window.mtrack("checkout_start"); } catch (e) { /* best-effort */ }

  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const payload = {
    mode,
    email,
    purchase_order_number: purchaseOrderNumber,
    cart: line,
  };
  if (mode === "net") payload.request_key = netRequestKey(line, purchaseOrderNumber);

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
    cart: { add, setQty, remove, clear, items, count, checkout },
  });
}
