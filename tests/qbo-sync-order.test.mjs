import assert from "node:assert/strict";
import test from "node:test";
import { documentPlanFor, syncOrder } from "../functions/_lib/qbo.js";

function makeTable(store, table) {
  const state = { field: null, value: null, patch: null };
  return {
    select() { return this; },
    eq(field, value) { state.field = field; state.value = value; return this; },
    async maybeSingle() {
      const rows = Object.values(store[table]);
      const found = rows.find((row) => row[state.field] === state.value);
      return { data: found || null, error: null };
    },
    async insert(row) {
      store[table][row.sku || row.key || row.id] = row;
      return { data: row, error: null };
    },
    update(patch) { state.patch = patch; return this; },
    async single() {
      const row = Object.values(store[table]).find((item) => item[state.field] === state.value);
      return { data: row ? { ...row, ...state.patch } : null, error: null };
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

const paidOrder = {
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  payment_method: "stripe",
  company_id: "c9",
  tax: 7.5,
  total: 107.5,
};

const netOrder = {
  ...paidOrder,
  payment_method: "net",
  company_id: "c1",
};

const items = [
  { sku: "crhd-5", name: "CR-HD - 5 gal", qty: 2, unit_price: 25, line_total: 50 },
  { sku: "sar-5", name: "SAR - 5 gal", qty: 1, unit_price: 50, line_total: 50 },
];

test("documentPlanFor maps paid and NET orders to the right QBO document/customer", () => {
  assert.deepEqual(documentPlanFor(paidOrder, { c9: "Acme Co" }), {
    docType: "sales_receipt",
    entity: "SalesReceipt",
    customer: { key: "company:c9", displayName: "Acme Co" },
  });

  assert.deepEqual(documentPlanFor({ ...paidOrder, company_id: null }, {}), {
    docType: "sales_receipt",
    entity: "SalesReceipt",
    customer: { key: "generic", displayName: "Online Sales (MASEST)" },
  });

  assert.deepEqual(documentPlanFor(netOrder, { c1: "Beta LLC" }), {
    docType: "invoice",
    entity: "Invoice",
    customer: { key: "company:c1", displayName: "Beta LLC" },
  });
});

test("syncOrder resolves mappings, posts a sales receipt, and returns document ids", async () => {
  const sb = fakeSb({
    qbo_customers: { "company:c9": { key: "company:c9", qbo_customer_id: "55" } },
    qbo_items: {
      "crhd-5": { sku: "crhd-5", qbo_item_id: "101" },
      "sar-5": { sku: "sar-5", qbo_item_id: "102" },
    },
  });
  const requests = [];

  const result = await syncOrder(sb, {}, "tok", "realm", paidOrder, items, { c9: "Acme Co" }, {
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      return { ok: true, async json() { return { SalesReceipt: { Id: "sr-900" } }; } };
    },
  });

  assert.deepEqual(result, { docId: "sr-900", docType: "sales_receipt" });
  const post = requests.find((request) => request.url.includes("/salesreceipt?"));
  assert.ok(post, "expected a SalesReceipt create request");
  const body = JSON.parse(post.init.body);
  assert.equal(body.CustomerRef.value, "55");
  assert.equal(body.Line.length, 2);
  assert.equal(body.Line[0].SalesItemLineDetail.ItemRef.value, "101");
});

test("syncOrder posts NET orders as invoices", async () => {
  const sb = fakeSb({
    qbo_customers: { "company:c1": { key: "company:c1", qbo_customer_id: "56" } },
    qbo_items: {
      "crhd-5": { sku: "crhd-5", qbo_item_id: "101" },
      "sar-5": { sku: "sar-5", qbo_item_id: "102" },
    },
  });

  const result = await syncOrder(sb, {}, "tok", "realm", netOrder, items, { c1: "Beta LLC" }, {
    fetchImpl: async (url, init = {}) => {
      assert.match(url, /\/invoice\?/);
      const body = JSON.parse(init.body);
      assert.equal(body.Balance, 107.5);
      return { ok: true, async json() { return { Invoice: { Id: "inv-901" } }; } };
    },
  });

  assert.deepEqual(result, { docId: "inv-901", docType: "invoice" });
});
