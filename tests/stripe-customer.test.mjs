import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ensureCompanyStripeCustomer } from "../functions/_lib/stripe-customer.js";

function fakeStripe(customerId = "cus_created", options = {}) {
  const calls = [];
  return {
    calls,
    customers: {
      async retrieve(id) {
        calls.push({ retrieve: id });
        if (options.missingIds?.includes(id)) {
          const error = new Error("No such customer");
          error.code = "resource_missing";
          throw error;
        }
        return { id, deleted: options.deletedIds?.includes(id) === true };
      },
      async create(payload, options) {
        calls.push({ payload, options });
        return { id: customerId };
      },
    },
  };
}

function fakeCompanyStore(initialCustomerId = null, options = {}) {
  let storedCustomerId = initialCustomerId;
  const calls = { update: null, updateFilters: [], reads: 0 };

  return {
    calls,
    sb: {
      from(table) {
        assert.equal(table, "companies");
        let operation = "read";
        return {
          update(payload) {
            operation = "update";
            calls.update = payload;
            return this;
          },
          select() { return this; },
          eq(column, value) {
            if (operation === "update") calls.updateFilters.push(["eq", column, value]);
            return this;
          },
          is(column, value) {
            if (operation === "update") calls.updateFilters.push(["is", column, value]);
            return this;
          },
          async maybeSingle() {
            if (operation === "update") {
              if (options.updateError) return { data: null, error: options.updateError };
              if (options.loseRace) {
                storedCustomerId = options.raceWinner ?? null;
                return { data: null, error: null };
              }
              storedCustomerId = calls.update.stripe_customer_id;
              return { data: { stripe_customer_id: storedCustomerId }, error: null };
            }
            calls.reads += 1;
            return { data: { stripe_customer_id: storedCustomerId }, error: null };
          },
        };
      },
    },
  };
}

const company = { id: "company_123", name: "MASEST Industries", stripe_customer_id: null };

test("existing Stripe customer is reused without a create call", async () => {
  const stripe = fakeStripe();
  const { sb, calls } = fakeCompanyStore("cus_existing");

  const customerId = await ensureCompanyStripeCustomer({
    stripe,
    sb,
    company: { ...company, stripe_customer_id: "cus_existing" },
    email: "billing@example.com",
  });

  assert.equal(customerId, "cus_existing");
  assert.deepEqual(stripe.calls, [{ retrieve: "cus_existing" }]);
  assert.equal(calls.update, null);
});

test("stale test-mode customer is replaced for the active Stripe account", async () => {
  const stripe = fakeStripe("cus_live", { missingIds: ["cus_test_stale"] });
  const { sb, calls } = fakeCompanyStore("cus_test_stale");

  const customerId = await ensureCompanyStripeCustomer({
    stripe,
    sb,
    company: { ...company, stripe_customer_id: "cus_test_stale" },
    email: "billing@example.com",
  });

  assert.equal(customerId, "cus_live");
  assert.deepEqual(stripe.calls, [
    { retrieve: "cus_test_stale" },
    {
      payload: {
        email: "billing@example.com",
        name: "MASEST Industries",
        metadata: { company_id: "company_123" },
      },
      options: { idempotencyKey: "company-customer:company_123:replace:cus_test_stale" },
    },
  ]);
  assert.deepEqual(calls.updateFilters, [
    ["eq", "id", "company_123"],
    ["eq", "stripe_customer_id", "cus_test_stale"],
  ]);
});

test("missing customer is created idempotently and conditionally persisted", async () => {
  const stripe = fakeStripe();
  const { sb, calls } = fakeCompanyStore();

  const customerId = await ensureCompanyStripeCustomer({
    stripe, sb, company, email: "billing@example.com",
  });

  assert.equal(customerId, "cus_created");
  assert.deepEqual(stripe.calls, [{
    payload: {
      email: "billing@example.com",
      name: "MASEST Industries",
      metadata: { company_id: "company_123" },
    },
    options: { idempotencyKey: "company-customer:company_123" },
  }]);
  assert.deepEqual(calls.update, { stripe_customer_id: "cus_created" });
  assert.deepEqual(calls.updateFilters, [
    ["eq", "id", "company_123"],
    ["is", "stripe_customer_id", null],
  ]);
  assert.equal(calls.reads, 0);
});

test("lost conditional update returns the stored race winner", async () => {
  const stripe = fakeStripe();
  const { sb, calls } = fakeCompanyStore(null, {
    loseRace: true,
    raceWinner: "cus_winner",
  });

  const customerId = await ensureCompanyStripeCustomer({ stripe, sb, company, email: null });

  assert.equal(customerId, "cus_winner");
  assert.equal(stripe.calls.length, 1);
  assert.equal(calls.reads, 1);
});

test("persistence error rejects with a stable error code", async () => {
  const stripe = fakeStripe();
  const { sb } = fakeCompanyStore(null, { updateError: new Error("write failed") });

  await assert.rejects(
    () => ensureCompanyStripeCustomer({ stripe, sb, company, email: "billing@example.com" }),
    { message: "stripe_customer_persist_failed" },
  );
});

test("missing winner rejects with a stable error code", async () => {
  const stripe = fakeStripe();
  const { sb, calls } = fakeCompanyStore(null, { loseRace: true });

  await assert.rejects(
    () => ensureCompanyStripeCustomer({ stripe, sb, company, email: "billing@example.com" }),
    { message: "stripe_customer_persist_failed" },
  );
  assert.equal(calls.reads, 1);
});

test("all company billing routes use the shared customer helper", async () => {
  const routes = [
    "functions/api/account/billing-portal.js",
    "functions/api/programs/subscribe.js",
    "functions/api/checkout.js",
  ];

  for (const route of routes) {
    const source = await readFile(new URL(`../${route}`, import.meta.url), "utf8");
    assert.match(source, /import \{ ensureCompanyStripeCustomer \} from ['"][^'"]+stripe-customer\.js['"]/);
    if (route.endsWith('/checkout.js')) {
      assert.match(source, /dependencies\.ensureCompanyStripeCustomer\s*\|\|\s*ensureCompanyStripeCustomer/);
      assert.equal(source.match(/getStripeCustomer\s*\(/g)?.length, 1, route);
    } else {
      assert.equal(source.match(/ensureCompanyStripeCustomer\s*\(/g)?.length, 1, route);
    }
  }
});
