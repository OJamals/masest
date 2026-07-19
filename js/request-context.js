export const REQUEST_CONTEXT_MAX_URL_LENGTH = 1800;

const REQUEST_CONTEXT_SOURCE = "customer_chat";
const MAX_CART_ITEMS = 8;
const MAX_IDENTIFIER_LENGTH = 80;
const MAX_NOTES_LENGTH = 1000;
const MAX_PATH_LENGTH = 300;
const SAFE_IDENTIFIER_RE = /^[a-z0-9](?:[a-z0-9 ._-]{0,79})$/i;
const SAFE_PATH_SEGMENT_RE = /^[a-z0-9._~-]*$/i;

function normalizeIdentifier(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH) return "";
  return SAFE_IDENTIFIER_RE.test(normalized) ? normalized : "";
}

function normalizeQty(value) {
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.min(Math.floor(qty), Number.MAX_SAFE_INTEGER);
}

function addSafe(left, right) {
  return Math.min(left + right, Number.MAX_SAFE_INTEGER);
}

function safeCount(value) {
  const text = String(value || "");
  if (!/^[1-9]\d{0,15}$/.test(text)) return 0;
  return normalizeQty(text);
}

export function normalizePagePath(value, siteOrigin) {
  try {
    const origin = new URL(siteOrigin);
    const url = new URL(String(value || ""), origin);
    if (!/^https?:$/.test(origin.protocol) || url.origin !== origin.origin) return "";
    if (/%(?:00|0[ad]|2f|5c)/i.test(url.pathname)) return "";
    const decoded = decodeURIComponent(url.pathname);
    if (
      !decoded.startsWith("/")
      || decoded.length > MAX_PATH_LENGTH
      || /[\u0000-\u001f\u007f\\]/.test(decoded)
    ) return "";
    const segments = decoded.split("/");
    if (segments.some((segment) => !SAFE_PATH_SEGMENT_RE.test(segment))) return "";
    return segments.map((segment) => encodeURIComponent(segment)).join("/") || "/";
  } catch {
    return "";
  }
}

function inferPageProduct(explicitProduct, path) {
  const explicit = normalizeIdentifier(explicitProduct);
  if (explicit) return explicit;
  const match = /^\/products\/([^/]+?)(?:\.html)?$/i.exec(path);
  if (!match) return "";
  try {
    const slug = decodeURIComponent(match[1]);
    return /^index$/i.test(slug) ? "" : normalizeIdentifier(slug);
  } catch {
    return "";
  }
}

function normalizeCart(cartItems) {
  if (!Array.isArray(cartItems)) return [];
  const merged = new Map();
  for (const item of cartItems) {
    const sku = normalizeIdentifier(item?.sku);
    const qty = normalizeQty(item?.qty);
    if (!sku || !qty) continue;
    merged.set(sku, addSafe(merged.get(sku) || 0, qty));
  }
  return [...merged].map(([sku, qty]) => ({ sku, qty }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

function contextParams(context) {
  const params = new URLSearchParams();
  params.set("type", "quote");
  params.set("source", REQUEST_CONTEXT_SOURCE);
  if (context.product) params.set("product", context.product);
  if (context.path) params.set("path", context.path);
  context.cart.forEach(({ sku, qty }) => params.append("cart", `${sku}:${qty}`));
  if (context.omitted.count) {
    params.set("cart_more", String(context.omitted.count));
    params.set("cart_more_qty", String(context.omitted.qty));
  }
  return params;
}

export function buildRequestContextHref({
  pageUrl,
  product = "",
  cartItems = [],
  quoteUrl = "/contact.html",
  maxLength = REQUEST_CONTEXT_MAX_URL_LENGTH,
} = {}) {
  try {
    const page = new URL(pageUrl);
    const quote = new URL(quoteUrl, page);
    if (!/^https?:$/.test(page.protocol) || quote.origin !== page.origin) return "";
    quote.search = "";
    quote.hash = "";

    const path = normalizePagePath(page.href, page.origin);
    const allCart = normalizeCart(cartItems);
    const context = {
      source: REQUEST_CONTEXT_SOURCE,
      product: inferPageProduct(product, path),
      path,
      cart: allCart.slice(0, MAX_CART_ITEMS),
      omitted: {
        count: Math.max(0, allCart.length - MAX_CART_ITEMS),
        qty: allCart.slice(MAX_CART_ITEMS).reduce((sum, item) => addSafe(sum, item.qty), 0),
      },
    };
    const hrefFor = () => `${quote.pathname}?${contextParams(context)}`;
    const absoluteLength = () => new URL(hrefFor(), page).href.length;

    while (absoluteLength() > maxLength && context.cart.length) {
      const item = context.cart.pop();
      context.omitted.count += 1;
      context.omitted.qty = addSafe(context.omitted.qty, item.qty);
    }
    return absoluteLength() <= maxLength ? hrefFor() : "";
  } catch {
    return "";
  }
}

function singleParam(params, name) {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : "";
}

function parseCartPair(value) {
  const separator = value.lastIndexOf(":");
  if (separator < 1) return null;
  const sku = normalizeIdentifier(value.slice(0, separator));
  const qty = safeCount(value.slice(separator + 1));
  return sku && qty ? { sku, qty } : null;
}

export function parseRequestContext(search) {
  const params = new URLSearchParams(search);
  if (
    singleParam(params, "type") !== "quote"
    || singleParam(params, "source") !== REQUEST_CONTEXT_SOURCE
  ) return null;

  const product = normalizeIdentifier(singleParam(params, "product"));
  const path = normalizePagePath(singleParam(params, "path"), "https://request-context.invalid");
  const cart = params.getAll("cart").slice(0, MAX_CART_ITEMS)
    .map(parseCartPair)
    .filter(Boolean);
  const omitted = {
    count: safeCount(singleParam(params, "cart_more")),
    qty: safeCount(singleParam(params, "cart_more_qty")),
  };
  if (!product && !path && !cart.length && !omitted.count) return null;
  return { source: REQUEST_CONTEXT_SOURCE, product, path, cart, omitted };
}

export function requestContextVolume(context) {
  if (!context) return "";
  const count = context.cart.length + context.omitted.count;
  const qty = context.cart.reduce((sum, item) => addSafe(sum, item.qty), context.omitted.qty);
  if (!count || !qty) return "";
  return `${qty} ${qty === 1 ? "unit" : "units"} across ${count} cart ${count === 1 ? "item" : "items"}`;
}

export function requestContextNotes(context) {
  if (!context) return "";
  const lines = ["Request context from customer chat."];
  if (context.path) lines.push(`Page: ${context.path}`);
  if (context.product) lines.push(`Product / SKU: ${context.product}`);

  let omittedCount = context.omitted.count;
  let omittedQty = context.omitted.qty;
  const cartLines = [];
  for (const item of context.cart) {
    const next = `- ${item.sku} x ${item.qty}`;
    const summary = `Additional cart items: ${omittedCount} (${omittedQty} units).`;
    const candidate = [...lines, "Cart:", ...cartLines, next, summary].join("\n");
    if (candidate.length <= MAX_NOTES_LENGTH) cartLines.push(next);
    else {
      omittedCount += 1;
      omittedQty = addSafe(omittedQty, item.qty);
    }
  }
  if (cartLines.length) lines.push("Cart:", ...cartLines);
  if (omittedCount) lines.push(`Additional cart items: ${omittedCount} (${omittedQty} units).`);
  return lines.join("\n").slice(0, MAX_NOTES_LENGTH);
}
