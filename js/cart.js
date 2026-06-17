/* MASEST commerce cart.
 * Browser storage is only a convenience; the checkout API re-prices every line.
 */
const KEY = "masest_cart";

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

function write(cart) {
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

export async function checkout({ mode = "pay", email, token } = {}) {
  const line = items();
  if (!line.length) throw new Error("cart_empty");

  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch("/api/checkout", {
    method: "POST",
    headers,
    body: JSON.stringify({ mode, email, items: line }),
  });
  const out = await response.json().catch(() => ({}));
  if (!response.ok) throw new CheckoutError(response.status, out);

  if (out.url) {
    window.location.href = out.url;
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
