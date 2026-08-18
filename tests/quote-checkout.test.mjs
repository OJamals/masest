import assert from "node:assert/strict";
import test from "node:test";
import { createCheckoutHandler } from "../functions/api/checkout.js";

const QUOTE_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const ATTEMPT_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-08-17T12:00:00.000Z";

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

function quoteCheckoutDb({ quoteCompanyId = COMPANY_ID, expiresAt = "2099-01-01T00:00:00.000Z" } = {}) {
  const quote = {
    id: QUOTE_ID,
    source: "requisition",
    status: "contacted",
    pipeline_stage: "proposal",
    offer_revision: 1,
    checkout_mutation_id: null,
    payload: {
      company_id: quoteCompanyId,
      requester_id: USER_ID,
      offer_order_id: DRAFT_ID,
      offer_status: "accepted",
      offer_expires_at: expiresAt,
    },
  };
  const db = {
    from(table) {
      if (table === "profiles") {
        return chain({ company_id: COMPANY_ID });
      }
      if (table === "quotes") {
        return chain(quote);
      }
      if (table === "orders") {
        return chain({
          id: DRAFT_ID,
          company_id: COMPANY_ID,
          user_id: USER_ID,
          status: "cart",
          requisition_name: null,
          subtotal: 24,
          total: 24,
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
  db.quote = quote;
  return db;
}

function chain(data) {
  return {
    select() { return this; },
    update(patch) { Object.assign(data, patch); return this; },
    eq() { return this; },
    neq() { return this; },
    is() { return this; },
    contains() { return this; },
    async maybeSingle() { return { data, error: null }; },
  };
}

function handler(capture, db = quoteCheckoutDb()) {
  return createCheckoutHandler({
    adminClient: () => db,
    userFromRequest: async () => ({ user: { id: USER_ID, email: "buyer@example.com" } }),
    tierForRequest: async () => { throw new Error("accepted quotes must bypass tier pricing"); },
    ensureCompanyStripeCustomer: async () => "cus_buyer",
    now: () => new Date(NOW),
    quoteCheckoutAttemptStore: {
      async claim(input) {
        capture.claim = input;
        return {
          action: "created",
          attempt_id: ATTEMPT_ID,
          status: "creating",
          request_params: input.requestParams,
        };
      },
      async attach(input) {
        capture.attach = input;
        return {
          status: "open",
          stripe_session_id: input.session.id,
          stripe_session_url: input.session.url,
        };
      },
      async finish() { throw new Error("unexpected finish"); },
    },
    randomUUID: () => ATTEMPT_ID,
    createStripe: () => ({
      customers: { async update() {} },
      checkout: { sessions: { async create(params, options) {
        capture.params = params;
        capture.options = options;
        return {
          id: "cs_quote_1",
          status: "open",
          expires_at: 4070908800,
          url: "https://checkout.stripe.test/quoted",
        };
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
  assert.equal(capture.params.metadata.quote_checkout_attempt_id, ATTEMPT_ID);
  assert.equal(capture.params.metadata.quote_offer_revision, "1");
  assert.deepEqual(capture.options, {
    idempotencyKey: `quote-checkout-attempt:${ATTEMPT_ID}`,
  });
  assert.equal(capture.claim.identity.requesterId, USER_ID);
  assert.equal(capture.claim.identity.offerRevision, 1);
  assert.deepEqual(capture.claim.identity.orderSnapshot.items, [{
    sku: "VK-1",
    product_sku: "VK",
    name: "Quoted VertKleen",
    qty: 2,
    unit_price: 12,
    line_total: 24,
  }]);
  assert.equal(capture.attach.session.id, "cs_quote_1");
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

test("quoted checkout enforces current Company ownership without email authority", async () => {
  const capture = {};
  const response = await handler(capture, quoteCheckoutDb({
    quoteCompanyId: "66666666-6666-4666-8666-666666666666",
  }))({ request: request(), env: {} });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "quote_unavailable" });
  assert.equal(capture.params, undefined);
});

test("quoted checkout persists expiry and refuses the exact offer boundary", async () => {
  const capture = {};
  const db = quoteCheckoutDb({ expiresAt: NOW });
  const response = await handler(capture, db)({ request: request(), env: {} });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "quote_unavailable" });
  assert.equal(db.quote.payload.offer_status, "expired");
  assert.equal(capture.params, undefined);
});

test("quoted checkout preserves Stripe's minimum-expiry transport margin", async () => {
  const capture = {};
  const expiresAt = new Date(Date.parse(NOW) + (30 * 60 * 1000)).toISOString();
  const response = await handler(capture, quoteCheckoutDb({ expiresAt }))({
    request: request(),
    env: {},
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "quote_checkout_window_too_short",
    message: "This offer expires too soon to open a secure payment session. Ask your account team for a revision.",
  });
  assert.equal(capture.params, undefined);
});
