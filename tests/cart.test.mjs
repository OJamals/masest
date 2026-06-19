import assert from "node:assert/strict";
import test from "node:test";

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
  const result = await cart.checkout({ mode: "net", token: "abc" });

  assert.deepEqual(result, { net: true, order_id: "ord_123" });
  assert.equal(calls[0].url, "/api/checkout");
  assert.equal(calls[0].options.headers.Authorization, "Bearer abc");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    mode: "net",
    cart: [{ sku: "hcr", qty: 2 }]
  });
  assert.equal(store.get("masest_cart"), "{}");
  assert.equal(events.at(-1).count, 0);
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
