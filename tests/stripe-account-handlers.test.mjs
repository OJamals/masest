import assert from "node:assert/strict";
import test from "node:test";
import { STRIPE_API_VERSION } from "../functions/_lib/stripe-client.js";
import { onRequest as subscribe } from "../functions/api/programs/subscribe.js";
import { onRequestPost as billingPortal } from "../functions/api/account/billing-portal.js";
import { onRequest as adminUsers } from "../functions/api/admin/users.js";

// The program, billing-portal, and admin user handlers build their Stripe clients inline, so
// these drive the real handlers and the real stripe package against a stubbed Stripe API and
// a stubbed Supabase. An SDK upgrade that renames a method or changes how these params are
// encoded fails here instead of on a live enrollment.
//
// Both clients read fetch when they are built, so the stub goes in before a handler runs.
// Any host other than the two stubs is refused.
const SUPABASE_URL = "https://supabase.test";
const APP_URL = "https://masest.co";

async function withApis({ stripe, db }, run) {
  const stripeCalls = [];
  const dbCalls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers);
    if (url.origin === "https://api.stripe.com") {
      const call = {
        method,
        path: url.pathname,
        query: decodeURIComponent(url.search),
        version: headers.get("stripe-version"),
        params: Object.fromEntries(new URLSearchParams(typeof init.body === "string" ? init.body : "")),
      };
      stripeCalls.push(call);
      const { status = 200, body } = stripe(call);
      return Response.json(body, { status, headers: { "request-id": "req_test" } });
    }
    if (url.origin === SUPABASE_URL) {
      if (url.pathname === "/auth/v1/user") {
        return Response.json(db.user);
      }
      const table = url.pathname.replace("/rest/v1/", "");
      const call = { method, table, search: decodeURIComponent(url.search), body: init.body ? JSON.parse(init.body) : null };
      dbCalls.push(call);
      if (method === "GET") return Response.json(db.tables[table] || []);
      return new Response(null, { status: method === "POST" ? 201 : 204 });
    }
    throw new Error(`unexpected network call: ${method} ${url}`);
  };
  try {
    return await run({ stripeCalls, dbCalls });
  } finally {
    globalThis.fetch = realFetch;
  }
}

const env = (extra = {}) => ({
  APP_URL,
  SUPABASE_URL,
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  STRIPE_SECRET_KEY: "sk_test_handlers",
  ...extra,
});

const buyerRequest = (path, body) => new Request(`${APP_URL}${path}`, {
  method: "POST",
  headers: { authorization: "Bearer buyer-token", "content-type": "application/json" },
  body: JSON.stringify(body),
});

// A signed-in member of an approved company that already has a Stripe customer.
const companyDb = (programSubscriptions = []) => ({
  user: { id: "user-1", email: "buyer@example.test", aud: "authenticated" },
  tables: {
    profiles: [{ id: "user-1", company_id: "co-1", role: "admin", full_name: "Pat Buyer", phone: null }],
    companies: [{ id: "co-1", name: "Acme HVAC", status: "approved", price_tier: null, tax_exempt: false, stripe_customer_id: "cus_1" }],
    program_subscriptions: programSubscriptions,
  },
});

const stripeCall = ({ method, path, query, version, params }) => ({ method, path, query, version, params });
const writes = (dbCalls) => dbCalls.filter((call) => call.method !== "GET");

function programStripe(call) {
  if (call.path === "/v1/customers/cus_1") return { body: { id: "cus_1", object: "customer" } };
  if (call.path === "/v1/checkout/sessions") {
    return { body: { id: "cs_test_program", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_program" } };
  }
  if (call.path === "/v1/subscriptions/sub_1" && call.method === "GET") {
    return { body: { id: "sub_1", object: "subscription", items: { object: "list", data: [{ id: "si_1", object: "subscription_item" }] } } };
  }
  if (call.path === "/v1/subscriptions/sub_1") return { body: { id: "sub_1", object: "subscription" } };
  if (call.path === "/v1/billing_portal/sessions") {
    return { body: { id: "bps_1", object: "billing_portal.session", url: "https://billing.stripe.com/p/session/bps_1" } };
  }
  return { status: 404, body: { error: { type: "invalid_request_error", code: "resource_missing", message: `No route ${call.path}` } } };
}

test("a first program enrollment opens a subscription Checkout Session through the pinned API version", async () => {
  await withApis({ stripe: programStripe, db: companyDb([]) }, async ({ stripeCalls, dbCalls }) => {
    const response = await subscribe({
      request: buyerRequest("/api/programs/subscribe", { tier: "Gold" }),
      env: env({ PROGRAM_PRICES: JSON.stringify({ Gold: "price_gold" }) }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { url: "https://checkout.stripe.com/c/pay/cs_test_program" });
    assert.deepEqual(stripeCalls.map(stripeCall), [
      { method: "GET", path: "/v1/customers/cus_1", query: "", version: STRIPE_API_VERSION, params: {} },
      {
        method: "POST",
        path: "/v1/checkout/sessions",
        query: "",
        version: STRIPE_API_VERSION,
        params: {
          mode: "subscription",
          customer: "cus_1",
          "line_items[0][price]": "price_gold",
          "line_items[0][quantity]": "1",
          success_url: `${APP_URL}/dashboard.html?program=success#business`,
          cancel_url: `${APP_URL}/dashboard.html#business`,
          "metadata[company_id]": "co-1",
          "metadata[tier]": "Gold",
          "subscription_data[metadata][company_id]": "co-1",
          "subscription_data[metadata][tier]": "Gold",
        },
      },
    ]);
    assert.deepEqual(writes(dbCalls), [{
      method: "POST",
      table: "program_subscriptions",
      search: "",
      body: {
        company_id: "co-1",
        tier: "Gold",
        stripe_customer_id: "cus_1",
        stripe_checkout_session_id: "cs_test_program",
        status: "checkout",
      },
    }]);
  });
});

test("a tier change swaps the price on the live subscription instead of opening a second one", async () => {
  const live = [{ id: "row-1", tier: "Silver", status: "active", stripe_subscription_id: "sub_1" }];
  await withApis({ stripe: programStripe, db: companyDb(live) }, async ({ stripeCalls, dbCalls }) => {
    const response = await subscribe({
      request: buyerRequest("/api/programs/subscribe", { tier: "Gold" }),
      env: env({ PROGRAM_PRICES: JSON.stringify({ Gold: "price_gold" }) }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { swapped: true, tier: "Gold" });
    assert.deepEqual(stripeCalls.map(stripeCall), [
      { method: "GET", path: "/v1/customers/cus_1", query: "", version: STRIPE_API_VERSION, params: {} },
      { method: "GET", path: "/v1/subscriptions/sub_1", query: "", version: STRIPE_API_VERSION, params: {} },
      {
        method: "POST",
        path: "/v1/subscriptions/sub_1",
        query: "",
        version: STRIPE_API_VERSION,
        params: {
          "items[0][id]": "si_1",
          "items[0][price]": "price_gold",
          proration_behavior: "create_prorations",
          "metadata[company_id]": "co-1",
          "metadata[tier]": "Gold",
        },
      },
    ]);
    assert.deepEqual(writes(dbCalls), [
      { method: "PATCH", table: "program_subscriptions", search: "?id=eq.row-1", body: { tier: "Gold" } },
    ]);
  });
});

test("the billing portal deep-links a cancel flow only for a subscription the company owns", async () => {
  const owned = [{ id: "row-1" }];
  await withApis({ stripe: programStripe, db: companyDb(owned) }, async ({ stripeCalls, dbCalls }) => {
    const response = await billingPortal({
      request: buyerRequest("/api/account/billing-portal", { flow: "cancel", subscription: "sub_1" }),
      env: env(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { url: "https://billing.stripe.com/p/session/bps_1" });
    const ownership = dbCalls.find((call) => call.table === "program_subscriptions");
    assert.match(ownership.search, /company_id=eq\.co-1/);
    assert.match(ownership.search, /stripe_subscription_id=eq\.sub_1/);
    assert.deepEqual(stripeCalls.map(stripeCall), [
      { method: "GET", path: "/v1/customers/cus_1", query: "", version: STRIPE_API_VERSION, params: {} },
      {
        method: "POST",
        path: "/v1/billing_portal/sessions",
        query: "",
        version: STRIPE_API_VERSION,
        params: {
          customer: "cus_1",
          return_url: `${APP_URL}/dashboard.html#programs`,
          "flow_data[type]": "subscription_cancel",
          "flow_data[subscription_cancel][subscription]": "sub_1",
          "flow_data[after_completion][type]": "redirect",
          "flow_data[after_completion][redirect][return_url]": `${APP_URL}/dashboard.html#programs`,
        },
      },
    ]);
  });

  await withApis({ stripe: programStripe, db: companyDb([]) }, async ({ stripeCalls }) => {
    const response = await billingPortal({
      request: buyerRequest("/api/account/billing-portal", { flow: "update", subscription: "sub_other" }),
      env: env(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(stripeCalls.at(-1).params, { customer: "cus_1", return_url: `${APP_URL}/dashboard.html#payment` });
  });
});

const staffDb = {
  user: { id: "staff-1", email: "owner@masest.test", aud: "authenticated" },
  tables: {
    companies: [{ id: "co-1", name: "Acme HVAC", status: "approved", net_terms_days: null, credit_limit: null, tax_exempt: false, price_tier: null, stripe_customer_id: "cus_1", created_at: "2026-09-01T00:00:00Z" }],
    addresses: [],
    orders: [],
  },
};

const staffRequest = (path) => new Request(`${APP_URL}${path}`, { headers: { authorization: "Bearer staff-token" } });

test("the admin company console lists saved cards through the pinned API version", async () => {
  const cards = (call) => (call.path === "/v1/payment_methods" ? {
    body: {
      object: "list",
      url: "/v1/payment_methods",
      has_more: false,
      data: [{ id: "pm_1", object: "payment_method", type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } }],
    },
  } : programStripe(call));
  await withApis({ stripe: cards, db: staffDb }, async ({ stripeCalls }) => {
    const response = await adminUsers({ request: staffRequest("/api/admin/users?company=co-1"), env: env({ ADMIN_EMAILS: "owner@masest.test" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.payment_methods, [{ id: "pm_1", brand: "visa", last4: "4242", exp: "12/2030" }]);
    assert.deepEqual(stripeCalls.map(stripeCall), [{
      method: "GET",
      path: "/v1/payment_methods",
      query: "?customer=cus_1&type=card&limit=20",
      version: STRIPE_API_VERSION,
      params: {},
    }]);
  });
});

test("the admin company console still loads when Stripe refuses the card list", async () => {
  await withApis({ stripe: programStripe, db: staffDb }, async ({ stripeCalls }) => {
    const response = await adminUsers({ request: staffRequest("/api/admin/users?company=co-1"), env: env({ ADMIN_EMAILS: "owner@masest.test" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.company.id, "co-1");
    assert.deepEqual(body.payment_methods, []);
    assert.equal(stripeCalls.length, 1);
  });
});
