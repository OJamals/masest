import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { STRIPE_API_VERSION, createStripeClient } from "../functions/_lib/stripe-client.js";
import { storefrontPromotionCodesReady } from "../functions/_lib/coupons.js";
import { onRequestGet as orderSummary } from "../functions/api/order.js";

// These run the real stripe package against a stubbed Stripe API, so an SDK upgrade that
// renames a method, changes how params are encoded, or stops sending the pinned version
// fails here instead of on the first live payment.
//
// The SDK's fetch transport captures fetch when a client is built, so the stub goes in
// before any client exists. Anything other than api.stripe.com is refused.
async function withStripeApi(respond, run) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(String(url));
    if (target.origin !== "https://api.stripe.com") throw new Error(`unexpected network call: ${target}`);
    const headers = new Headers(init.headers);
    const call = {
      method: init.method || "GET",
      path: target.pathname,
      query: decodeURIComponent(target.search),
      version: headers.get("stripe-version"),
      idempotencyKey: headers.get("idempotency-key"),
      body: typeof init.body === "string" ? decodeURIComponent(init.body) : "",
    };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "request-id": "req_test" },
    });
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("every Stripe method the Functions call exists on the pinned SDK client", () => {
  const client = createStripeClient("sk_test_methods");
  const used = [
    "checkout.sessions.create", "checkout.sessions.retrieve", "checkout.sessions.update",
    "checkout.sessions.expire", "customers.create", "customers.retrieve", "customers.update",
    "paymentIntents.retrieve", "refunds.create", "subscriptions.retrieve", "subscriptions.update",
    "billingPortal.sessions.create", "promotionCodes.list", "promotionCodes.create",
    "promotionCodes.update", "coupons.create", "paymentMethods.list", "paymentMethods.detach",
    "webhooks.constructEventAsync",
  ];
  const missing = used.filter((path) => (
    typeof path.split(".").reduce((node, key) => node?.[key], client) !== "function"
  ));
  assert.deepEqual(missing, []);
});

test("the order summary reads its Checkout Session through the pinned API version", async () => {
  const session = {
    id: "cs_test_1",
    object: "checkout.session",
    status: "complete",
    payment_status: "paid",
    currency: "usd",
    amount_total: 5750,
    amount_subtotal: 5000,
    shipping_cost: { amount_subtotal: 750 },
    total_details: { amount_discount: 0, amount_tax: 0 },
    metadata: { order_number: "MST-00000042", shipping_service_code: "ups_ground" },
    customer_details: { email: "buyer@example.com" },
    line_items: { object: "list", data: [{ description: "VertKleen CR-HD - 1 gal", quantity: 2, amount_total: 5000 }] },
  };
  await withStripeApi(() => ({ body: session }), async (calls) => {
    const response = await orderSummary({
      request: new Request("https://masest.co/api/order?session_id=cs_test_1"),
      env: { STRIPE_SECRET_KEY: "sk_test_order" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.order_number, "MST-00000042");
    assert.equal(body.amount_total, 57.5);
    assert.equal(body.amount_shipping, 7.5);
    assert.deepEqual(body.lines, [{ name: "VertKleen CR-HD - 1 gal", qty: 2, amount_total: 50 }]);
    assert.deepEqual(
      calls.map(({ method, path, query, version }) => ({ method, path, query, version })),
      [{ method: "GET", path: "/v1/checkout/sessions/cs_test_1", query: "?expand[0]=line_items", version: STRIPE_API_VERSION }],
    );
  });
});

test("storefront promotion readiness expands the coupon where clover moved it", async () => {
  const vk5 = {
    id: "promo_VK5",
    object: "promotion_code",
    code: "VK5",
    active: true,
    promotion: {
      type: "coupon",
      coupon: { id: "coupon_VK5", object: "coupon", percent_off: 5, amount_off: null, valid: true },
    },
  };
  await withStripeApi(() => ({ body: { object: "list", data: [vk5], has_more: false, url: "/v1/promotion_codes" } }), async (calls) => {
    assert.equal(await storefrontPromotionCodesReady(createStripeClient("sk_test_promo")), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/v1/promotion_codes");
    assert.match(calls[0].query, /expand\[0\]=data\.promotion\.coupon/);
    assert.equal(calls[0].version, STRIPE_API_VERSION);
  });
});

test("a promotion code is created with the promotion parameter and one idempotency key", async () => {
  await withStripeApi(
    () => ({ body: { id: "promo_new", object: "promotion_code", code: "SPRING", promotion: { type: "coupon", coupon: "coupon_1" } } }),
    async (calls) => {
      const stripe = createStripeClient("sk_test_create");
      const promo = await stripe.promotionCodes.create(
        { promotion: { type: "coupon", coupon: "coupon_1" }, code: "SPRING" },
        { idempotencyKey: "promotion-code:request-1" },
      );
      assert.equal(promo.id, "promo_new");
      assert.equal(calls[0].method, "POST");
      assert.equal(calls[0].path, "/v1/promotion_codes");
      assert.equal(calls[0].body, "promotion[type]=coupon&promotion[coupon]=coupon_1&code=SPRING");
      assert.equal(calls[0].idempotencyKey, "promotion-code:request-1");
      assert.equal(calls[0].version, STRIPE_API_VERSION);
    },
  );
});

test("webhook signatures verify on the Web Crypto path with the pinned SDK", async () => {
  const client = createStripeClient("sk_test_webhook");
  const cryptoProvider = Stripe.createSubtleCryptoProvider();
  const payload = JSON.stringify({
    id: "evt_test",
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_1", object: "checkout.session" } },
  });
  const secret = "whsec_test_secret";
  const header = await client.webhooks.generateTestHeaderStringAsync({ payload, secret, cryptoProvider });
  const event = await client.webhooks.constructEventAsync(payload, header, secret, undefined, cryptoProvider);
  assert.equal(event.id, "evt_test");
  await assert.rejects(
    client.webhooks.constructEventAsync(payload, header, "whsec_wrong", undefined, cryptoProvider),
    /signature/i,
  );
});
