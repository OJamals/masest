import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUEST_CONTEXT_MAX_URL_LENGTH,
  buildRequestContextHref,
  normalizePagePath,
  parseRequestContext,
  requestContextNotes,
} from "../js/request-context.js";

function installBrowserGlobals() {
  const store = new Map();
  const events = [];
  globalThis.localStorage = {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
    clear: () => store.clear()
  };
  globalThis.document = new EventTarget();
  globalThis.document.addEventListener("cart:updated", event => events.push(event.detail));
  globalThis.window = { MASEST: {} };
  return { store, events };
}

async function freshCartModule() {
  return import(`../js/cart.js?test=${Date.now()}-${Math.random()}`);
}

test("cart recovers from corrupt storage and emits updated totals", async () => {
  const { store, events } = installBrowserGlobals();
  store.set("masest_cart", "{not json");

  const cart = await freshCartModule();
  cart.add("hcr", 2.8);
  cart.add("hcr", 1);
  cart.setQty("dbnpa", "3");
  cart.setQty("bad", -1);

  assert.deepEqual(cart.items(), [
    { sku: "hcr", qty: 3 },
    { sku: "dbnpa", qty: 3 }
  ]);
  assert.equal(cart.count(), 6);
  assert.deepEqual(JSON.parse(store.get("masest_cart")), { hcr: 3, dbnpa: 3 });
  assert.equal(events.at(-1).count, 6);
  assert.deepEqual(events.at(-1).items, cart.items());
});

test("checkout sends normalized line items and clears NET orders", async () => {
  const { store, events } = installBrowserGlobals();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ net: true, order_id: "ord_123" }), { status: 201 });
  };

  const cart = await freshCartModule();
  cart.add("hcr", 2);
  const result = await cart.checkout({
    mode: "net",
    token: "abc",
    purchaseOrderNumber: "PO-1042",
  });

  assert.deepEqual(result, { net: true, order_id: "ord_123" });
  assert.equal(calls[0].url, "/api/checkout");
  assert.equal(calls[0].options.headers.Authorization, "Bearer abc");
  const requestBody = JSON.parse(calls[0].options.body);
  assert.deepEqual(requestBody.cart, [{ sku: "hcr", qty: 2 }]);
  assert.equal(requestBody.mode, "net");
  assert.equal(requestBody.purchase_order_number, "PO-1042");
  assert.match(requestBody.request_key, /^[a-zA-Z0-9-]+$/);
  assert.equal(store.get("masest_cart"), "{}");
  assert.equal(store.has("masest_net_request_v1"), false);
  assert.equal(events.at(-1).count, 0);
});

test("NET checkout retains one request key across response-loss retries", async () => {
  const { store } = installBrowserGlobals();
  const requestKeys = [];
  let attempts = 0;
  globalThis.fetch = async (_url, options) => {
    requestKeys.push(JSON.parse(options.body).request_key);
    attempts += 1;
    if (attempts === 1) throw new TypeError("network response lost");
    return new Response(JSON.stringify({
      net: true,
      order_id: "ord_123",
      duplicate: true
    }), { status: 200 });
  };

  const cart = await freshCartModule();
  cart.add("hcr", 2);
  await assert.rejects(() => cart.checkout({ mode: "net" }), /network response lost/);
  assert.equal(cart.count(), 2, "failed response must retain the logical cart");
  assert.ok(store.get("masest_net_request_v1"), "failed response must retain its request key");

  const result = await cart.checkout({ mode: "net" });
  assert.equal(result.duplicate, true);
  assert.equal(requestKeys[0], requestKeys[1]);
});

test("cart mutation starts a new NET logical attempt", async () => {
  installBrowserGlobals();
  const requestKeys = [];
  globalThis.fetch = async (_url, options) => {
    requestKeys.push(JSON.parse(options.body).request_key);
    throw new TypeError("offline");
  };

  const cart = await freshCartModule();
  cart.add("hcr", 1);
  await assert.rejects(() => cart.checkout({ mode: "net" }), /offline/);
  cart.setQty("hcr", 2);
  await assert.rejects(() => cart.checkout({ mode: "net" }), /offline/);

  assert.notEqual(requestKeys[0], requestKeys[1]);
});

test("changing the purchase-order number starts a new NET logical attempt", async () => {
  installBrowserGlobals();
  const requestKeys = [];
  globalThis.fetch = async (_url, options) => {
    requestKeys.push(JSON.parse(options.body).request_key);
    throw new TypeError("offline");
  };

  const cart = await freshCartModule();
  cart.add("hcr", 1);
  await assert.rejects(
    () => cart.checkout({ mode: "net", purchaseOrderNumber: "PO-1" }),
    /offline/,
  );
  await assert.rejects(
    () => cart.checkout({ mode: "net", purchaseOrderNumber: "PO-2" }),
    /offline/,
  );

  assert.notEqual(requestKeys[0], requestKeys[1]);
});

test("checkout exposes server rejection details for bulk freight messaging", async () => {
  installBrowserGlobals();
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: "not_purchasable",
    message: "These SKUs need bulk freight review.",
    skus: ["hcr"]
  }), { status: 409 });

  const cart = await freshCartModule();
  cart.add("hcr", 1);

  await assert.rejects(
    () => cart.checkout({ mode: "pay" }),
    err => {
      assert.equal(err.name, "CheckoutError");
      assert.equal(err.code, "not_purchasable");
      assert.equal(err.status, 409);
      assert.deepEqual(err.skus, ["hcr"]);
      assert.match(err.message, /bulk freight/);
      return true;
    }
  );
});

test("request context carries only stable product, cart, path, and source fields", () => {
  const href = buildRequestContextHref({
    pageUrl: "https://masest.co/products/hcr.html?email=buyer%40example.com&token=secret#history",
    quoteUrl: "https://masest.co/contact.html",
    cartItems: [],
  });
  const url = new URL(href, "https://masest.co");

  assert.equal(url.pathname, "/contact.html");
  assert.deepEqual([...url.searchParams.keys()], ["type", "source", "product", "path"]);
  assert.equal(url.searchParams.get("type"), "quote");
  assert.equal(url.searchParams.get("source"), "customer_chat");
  assert.equal(url.searchParams.get("product"), "hcr");
  assert.equal(url.searchParams.get("path"), "/products/hcr.html");
  assert.equal(url.searchParams.has("email"), false);
  assert.equal(url.searchParams.has("token"), false);
  assert.equal(url.searchParams.has("history"), false);

  assert.deepEqual(parseRequestContext(url.search), {
    source: "customer_chat",
    product: "hcr",
    path: "/products/hcr.html",
    cart: [],
    omitted: { count: 0, qty: 0 },
  });
});

test("request context handles general, unknown, and malicious pages without query leakage", () => {
  const general = new URL(buildRequestContextHref({
    pageUrl: "https://masest.co/products.html?message=private",
    quoteUrl: "/contact.html",
  }), "https://masest.co");
  assert.equal(general.searchParams.has("product"), false);
  assert.equal(general.searchParams.get("path"), "/products.html");
  assert.equal(general.searchParams.has("message"), false);

  const unknown = new URL(buildRequestContextHref({
    pageUrl: "https://masest.co/products/not-in-catalog",
    quoteUrl: "/contact.html",
  }), "https://masest.co");
  assert.equal(unknown.searchParams.get("product"), "not-in-catalog");
  const explicitProduct = new URL(buildRequestContextHref({
    pageUrl: "https://masest.co/product.html",
    product: "VK-HCR-5G",
    quoteUrl: "/contact.html",
  }), "https://masest.co");
  assert.equal(explicitProduct.searchParams.get("product"), "VK-HCR-5G");

  const malicious = new URL(buildRequestContextHref({
    pageUrl: "https://masest.co/products/%3Cscript%3E?email=buyer%40example.com",
    product: "VK-HCR\r\nX-Injected: yes",
    quoteUrl: "/contact.html",
  }), "https://masest.co");
  assert.equal(malicious.searchParams.has("product"), false);
  assert.equal(malicious.searchParams.has("path"), false);
  assert.equal(normalizePagePath("https://evil.example/products/hcr?token=secret", "https://masest.co"), "");
  assert.equal(buildRequestContextHref({
    pageUrl: "https://masest.co/products/hcr",
    quoteUrl: "https://evil.example/contact",
  }), "");
});

test("request context caps sorted cart pairs and degrades overflow to a count summary", () => {
  const cartItems = Array.from({ length: 12 }, (_, index) => ({
    sku: `VK-${String(index).padStart(2, "0")}-${"X".repeat(70)}`,
    qty: index + 1,
  }));
  cartItems.push(
    { sku: "<script>alert(1)</script>", qty: 4 },
    { sku: "VK-BAD", qty: -2 },
  );

  const href = buildRequestContextHref({
    pageUrl: "https://masest.co/products/hcr",
    quoteUrl: "/contact.html",
    cartItems: cartItems.reverse(),
  });
  const context = parseRequestContext(new URL(href, "https://masest.co").search);

  const absoluteHref = new URL(href, "https://masest.co").href;
  assert.ok(absoluteHref.length <= REQUEST_CONTEXT_MAX_URL_LENGTH, `URL length ${absoluteHref.length}`);
  assert.ok(context.cart.length <= 8);
  assert.deepEqual(context.cart, [...context.cart].sort((a, b) => a.sku.localeCompare(b.sku)));
  assert.ok(context.omitted.count > 0);
  assert.ok(context.omitted.qty > 0);
  assert.equal(context.cart.some(({ sku }) => sku.includes("<")), false);
  assert.match(requestContextNotes(context), /additional cart items/i);
  assert.ok(requestContextNotes(context).length <= 1000);
});
