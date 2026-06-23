// #27 (tax slice) — honor companies.tax_exempt on QBO invoices. A tax-exempt buyer's
// invoice lines must carry TaxCodeRef NON so QuickBooks never assesses sales tax on them;
// non-exempt orders are left exactly as before (no line-level tax marker added).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildInvoicePayload, syncOrder } from "../functions/_lib/qbo.js";
import { companyTaxExemptByIds } from "../functions/api/qbo-sync.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const order = { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", company_id: "c9", tax: 0, total: 100 };
const items = [
  { sku: "crhd", name: "CR-HD - 5 gal", qty: 2, unit_price: 25, line_total: 50 },
  { sku: "sar", name: "SAR - 5 gal", qty: 1, unit_price: 50, line_total: 50 },
];
const itemRefs = { crhd: "101", sar: "102" };

test("tax-exempt invoice marks every line non-taxable (TaxCodeRef NON)", () => {
  const payload = buildInvoicePayload({ order, items, customerRef: "55", itemRefs, taxExempt: true });
  for (const line of payload.Line) {
    assert.equal(line.SalesItemLineDetail.TaxCodeRef.value, "NON");
  }
});

test("non-exempt invoice adds no line-level tax marker (unchanged behavior)", () => {
  const payload = buildInvoicePayload({ order, items, customerRef: "55", itemRefs });
  for (const line of payload.Line) {
    assert.equal(line.SalesItemLineDetail.TaxCodeRef, undefined);
  }
});

// ---- batched exempt lookup: one query for the whole sync batch (no N+1) ----
function fakeCompaniesSb(rows, { error = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, "companies");
      return {
        select() { return this; },
        in(col, ids) { calls.push({ col, ids }); return Promise.resolve({ data: error ? null : rows, error }); },
      };
    },
  };
}

test("companyTaxExemptByIds returns the set of exempt ids in a single query", async () => {
  const sb = fakeCompaniesSb([{ id: "c1", tax_exempt: true }, { id: "c2", tax_exempt: false }]);
  const exempt = await companyTaxExemptByIds(sb, ["c1", "c2"]);
  assert.ok(exempt.has("c1"));
  assert.ok(!exempt.has("c2"));
  assert.equal(sb.calls.length, 1, "one batched query, not one per id");
});

test("companyTaxExemptByIds makes no query for an empty id set", async () => {
  const sb = fakeCompaniesSb([]);
  const exempt = await companyTaxExemptByIds(sb, []);
  assert.equal(exempt.size, 0);
  assert.equal(sb.calls.length, 0);
});

test("companyTaxExemptByIds throws on read error so the caller can requeue", async () => {
  const sb = fakeCompaniesSb(null, { error: { message: "boom" } });
  await assert.rejects(() => companyTaxExemptByIds(sb, ["c1"]), /boom/);
});

// ---- syncOrder threads the exempt flag onto the posted invoice ----
function makeTable(store, table) {
  const state = { field: null, value: null };
  return {
    select() { return this; },
    eq(field, value) { state.field = field; state.value = value; return this; },
    async maybeSingle() {
      const found = Object.values(store[table]).find((row) => row[state.field] === state.value);
      return { data: found || null, error: null };
    },
    async insert(row) { store[table][row.sku || row.key || row.id] = row; return { data: row, error: null }; },
  };
}

test("syncOrder posts non-taxable lines for an exempt buyer", async () => {
  const store = {
    qbo_customers: { "company:c9": { key: "company:c9", qbo_customer_id: "55" } },
    qbo_items: { crhd: { sku: "crhd", qbo_item_id: "101" }, sar: { sku: "sar", qbo_item_id: "102" } },
  };
  const sb = { from(table) { return makeTable(store, table); } };
  const netOrder = { ...order, payment_method: "net" };
  let invoiceBody = null;
  await syncOrder(sb, {}, "tok", "realm", netOrder, items, { c9: "Acme Co" }, {
    taxExempt: true,
    fetchImpl: async (url, init = {}) => {
      if (url.includes("/query?")) return { ok: true, async json() { return { QueryResponse: {} }; } };
      invoiceBody = JSON.parse(init.body);
      return { ok: true, async json() { return { Invoice: { Id: "inv-901" } }; } };
    },
  });
  assert.ok(invoiceBody, "expected an Invoice create");
  assert.equal(invoiceBody.Line[0].SalesItemLineDetail.TaxCodeRef.value, "NON");
});

// ---- source-contract: the sync loop actually wires the exempt flag through ----
const src = readFileSync(join(root, "functions/api/qbo-sync.js"), "utf8");
test("runQboSync batches the exempt lookup and passes taxExempt into syncOrder", () => {
  assert.match(src, /companyTaxExemptByIds\(/);
  assert.match(src, /taxExempt:/);
});
