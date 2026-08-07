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

test("checkout sends normalized line items and clears the cart on success", async () => {
  const { store, events } = installBrowserGlobals();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ order_id: "ord_123" }), { status: 201 });
  };

  const cart = await freshCartModule();
  cart.add("hcr", 2);
  const result = await cart.checkout({
    token: "abc",
    purchaseOrderNumber: "PO-1042",
  });

  assert.deepEqual(result, { order_id: "ord_123" });
  assert.equal(calls[0].url, "/api/checkout");
  assert.equal(calls[0].options.headers.Authorization, "Bearer abc");
  const requestBody = JSON.parse(calls[0].options.body);
  assert.deepEqual(requestBody.cart, [{ sku: "hcr", qty: 2 }]);
  assert.equal(requestBody.purchase_order_number, "PO-1042");
  assert.equal(store.get("masest_cart"), "{}");
  assert.equal(events.at(-1).count, 0);
});

// Self-serve NET checkout is gone: on-account orders are raised by staff from an accepted
// quote. The cart must therefore be structurally incapable of asking for anything else,
// whatever a caller passes — no mode override, and no NET request-key idempotency.
test("checkout always asks for card/ACH and never carries a NET request key", async () => {
  const { store } = installBrowserGlobals();
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ order_id: "ord_1" }), { status: 201 });
  };

  const cart = await freshCartModule();
  cart.add("hcr", 1);
  await cart.checkout({ mode: "net", purchaseOrderNumber: "PO-1" });

  assert.equal(bodies[0].mode, "pay", "a caller must not be able to select on-account terms");
  assert.equal("request_key" in bodies[0], false, "no NET idempotency key may be sent");
  assert.equal(store.has("masest_net_request_v1"), false, "no NET request key may be stored");
});

test("accepted quote checkout sends only quote identity and invalidates it on cart changes", async () => {
  installBrowserGlobals();
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ order_id: "ord_quoted" }), { status: 201 });
  };

  const cart = await freshCartModule();
  cart.replaceWithQuote({
    quoteId: "quote-1",
    orderId: "draft-1",
    items: [
      { sku: "VK-1", qty: 2, unit_price: 1 },
      { sku: "VK-2", qty: 1, unit_price: 999 },
    ],
  });
  await cart.checkout();

  assert.deepEqual(bodies[0].cart, [
    { sku: "VK-1", qty: 2 },
    { sku: "VK-2", qty: 1 },
  ]);
  assert.equal(bodies[0].quote_id, "quote-1");
  assert.equal(bodies[0].quote_order_id, "draft-1");
  assert.equal("unit_price" in bodies[0].cart[0], false);

  cart.replaceWithQuote({
    quoteId: "quote-2",
    orderId: "draft-2",
    items: [{ sku: "VK-1", qty: 2 }],
  });
  cart.setQty("VK-1", 3);
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    throw new TypeError("offline");
  };
  await assert.rejects(() => cart.checkout(), /offline/);
  assert.equal(bodies[1].quote_id, undefined);
  assert.equal(bodies[1].quote_order_id, undefined);
});

test("a failed checkout keeps the cart intact for a retry", async () => {
  installBrowserGlobals();
  globalThis.fetch = async () => { throw new TypeError("network response lost"); };

  const cart = await freshCartModule();
  cart.add("hcr", 2);
  await assert.rejects(() => cart.checkout(), /network response lost/);
  assert.equal(cart.count(), 2, "failed response must retain the logical cart");
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
    pageUrl: "https://masest.co/products/hcr",
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
