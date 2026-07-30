import assert from "node:assert/strict";
import test from "node:test";
import { createCheckoutHandler } from "../functions/api/checkout.js";

const QUOTE_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

function request(qty = 2) {
  return new Request("https://masest.test/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cart: [{ sku: "VK-1", qty }],
      quote_id: QUOTE_ID,
      quote_order_id: DRAFT_ID,
    }),
  });
}

function quoteCheckoutDb() {
  return {
    from(table) {
      if (table === "profiles") {
        return chain({ company_id: COMPANY_ID });
      }
      if (table === "quotes") {
        return chain({
          id: QUOTE_ID,
          status: "contacted",
          payload: {
            company_id: COMPANY_ID,
            requester_id: USER_ID,
            offer_order_id: DRAFT_ID,
            offer_status: "accepted",
          },
        });
      }
      if (table === "orders") {
        return chain({
          id: DRAFT_ID,
          company_id: COMPANY_ID,
          user_id: USER_ID,
          status: "cart",
          requisition_name: null,
          currency: "usd",
          order_items: [{
            sku: "VK-1",
            product_sku: "VK",
            name: "Quoted VertKleen",
            qty: 2,
            unit_price: 12,
            line_total: 24,
          }],
        });
      }
      if (table === "product_variants") {
        return {
          select() { return this; },
          async in() {
            return {
              data: [{
                vsku: "VK-1",
                product_sku: "VK",
                label: "1 gal",
                price: 25,
                currency: "usd",
                stripe_price_id: "price_catalog",
                active: true,
                stock: 10,
                track_stock: true,
                allow_backorder: false,
                products: { name: "VertKleen", mode: "buy", active: true, taxable: true },
              }],
              error: null,
            };
          },
        };
      }
      if (table === "content_entries") {
        return {
          select() { return this; },
          eq() { return this; },
          async order() { return { data: [], error: null }; },
        };
      }
      if (table === "companies") {
        return chain({
          id: COMPANY_ID,
          name: "Buyer Co",
          tax_exempt: false,
          stripe_customer_id: "cus_buyer",
        });
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function chain(data) {
  return {
    select() { return this; },
    eq() { return this; },
    neq() { return this; },
    is() { return this; },
    async maybeSingle() { return { data, error: null }; },
  };
}

function handler(capture) {
  return createCheckoutHandler({
    adminClient: quoteCheckoutDb,
    userFromRequest: async () => ({ user: { id: USER_ID, email: "buyer@example.com" } }),
    tierForRequest: async () => { throw new Error("accepted quotes must bypass tier pricing"); },
    ensureCompanyStripeCustomer: async () => "cus_buyer",
    createStripe: () => ({
      customers: { async update() {} },
      checkout: { sessions: { async create(params, options) {
        capture.params = params;
        capture.options = options;
        return { url: "https://checkout.stripe.test/quoted" };
      } } },
    }),
  });
}

test("quoted checkout ignores client/catalog prices and carries exact server identity", async () => {
  const capture = {};
  const response = await handler(capture)({
    request: request(),
    env: {
      STRIPE_SECRET_KEY: "sk_test",
      STRIPE_SHIPPING_RATE_IDS: "shr_ground",
      APP_URL: "https://masest.test",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(capture.params.line_items[0].price_data.unit_amount, 1200);
  assert.equal(capture.params.line_items[0].price_data.product_data.name, "Quoted VertKleen");
  assert.equal(capture.params.allow_promotion_codes, false);
  assert.equal(capture.params.metadata.quote_id, QUOTE_ID);
  assert.equal(capture.params.metadata.quote_order_id, DRAFT_ID);
  assert.deepEqual(capture.options, {
    idempotencyKey: `quote-checkout:${DRAFT_ID}`,
  });
});

test("quoted checkout rejects a cart quantity changed after acceptance", async () => {
  const capture = {};
  const response = await handler(capture)({
    request: request(3),
    env: {},
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "quote_cart_changed" });
  assert.equal(capture.params, undefined);
});
