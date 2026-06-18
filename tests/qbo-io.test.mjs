import assert from "node:assert/strict";
import test from "node:test";
import { findOrCreateCustomer, findOrCreateItem } from "../functions/_lib/qbo.js";

function makeTable(store, table) {
  const state = { field: null, value: null };
  return {
    select() { return this; },
    eq(field, value) { state.field = field; state.value = value; return this; },
    async maybeSingle() {
      const rows = Object.values(store[table]);
      const found = rows.find((row) => row[state.field] === state.value);
      return { data: found || null, error: null };
    },
    async insert(row) {
      store[table][row.sku || row.key] = row;
      return { data: row, error: null };
    },
  };
}

function fakeSb(seed = {}) {
  const store = {
    qbo_customers: { ...(seed.qbo_customers || {}) },
    qbo_items: { ...(seed.qbo_items || {}) },
  };
  return {
    store,
    from(table) { return makeTable(store, table); },
  };
}

const env = { QBO_ENVIRONMENT: "sandbox", QBO_INCOME_ACCOUNT_ID: "79" };

test("findOrCreateCustomer returns cached mapping without network", async () => {
  const sb = fakeSb({ qbo_customers: { "company:abc": { key: "company:abc", qbo_customer_id: "55" } } });
  const customerId = await findOrCreateCustomer(sb, env, "tok", "realm", {
    key: "company:abc",
    displayName: "Acme Co",
  }, {
    fetchImpl: async () => { throw new Error("fetch should not run"); },
  });

  assert.equal(customerId, "55");
});

test("findOrCreateCustomer queries QBO then caches the found customer", async () => {
  const sb = fakeSb();
  let requestedUrl = "";
  const customerId = await findOrCreateCustomer(sb, env, "tok", "realm", {
    key: "company:abc",
    displayName: "Acme Co",
  }, {
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        async json() { return { QueryResponse: { Customer: [{ Id: "56" }] } }; },
      };
    },
  });

  assert.match(requestedUrl, /\/query\?/);
  assert.equal(customerId, "56");
  assert.equal(sb.store.qbo_customers["company:abc"].qbo_customer_id, "56");
});

test("findOrCreateItem creates a service item and caches it when QBO has no match", async () => {
  const sb = fakeSb();
  const requests = [];
  const itemId = await findOrCreateItem(sb, env, "tok", "realm", {
    sku: "crhd-5",
    name: "CR-HD - 5 gal",
  }, {
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (url.includes("/query?")) {
        return { ok: true, async json() { return { QueryResponse: {} }; } };
      }
      return { ok: true, async json() { return { Item: { Id: "201" } }; } };
    },
  });

  assert.equal(itemId, "201");
  assert.equal(sb.store.qbo_items["crhd-5"].qbo_item_id, "201");
  const create = requests.find((request) => request.url.includes("/item?"));
  assert.ok(create, "expected an Item create request");
  const body = JSON.parse(create.init.body);
  assert.equal(body.Name, "CR-HD - 5 gal");
  assert.equal(body.Sku, "crhd-5");
  assert.equal(body.Type, "Service");
  assert.equal(body.IncomeAccountRef.value, "79");
});

test("findOrCreateItem auto-detects an income account when env id is absent", async () => {
  const sb = fakeSb();
  const requests = [];
  const itemId = await findOrCreateItem(sb, { QBO_ENVIRONMENT: "sandbox" }, "tok", "realm", {
    sku: "crhd-1",
    name: "CR-HD - 1 gal",
  }, {
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (url.includes("/query?") && decodeURIComponent(url).includes("from Item")) {
        return { ok: true, async json() { return { QueryResponse: {} }; } };
      }
      if (url.includes("/query?") && decodeURIComponent(url).includes("from Account")) {
        return { ok: true, async json() { return { QueryResponse: { Account: [{ Id: "401" }] } }; } };
      }
      return { ok: true, async json() { return { Item: { Id: "202" } }; } };
    },
  });

  assert.equal(itemId, "202");
  const create = requests.find((request) => request.url.includes("/item?"));
  assert.ok(create, "expected an Item create request");
  const body = JSON.parse(create.init.body);
  assert.equal(body.IncomeAccountRef.value, "401");
});
