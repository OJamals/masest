import assert from "node:assert/strict";
import test from "node:test";
import { companyCreditState, exceedsCredit, round2 } from "../functions/_lib/credit.js";

// Fake PostgREST builder: .select().eq().eq() then awaited -> { data, error }.
function fakeSb(orders = []) {
  return {
    from(table) {
      let rows = table === "orders" ? [...orders] : [];
      const b = {
        select() { return b; },
        eq(field, value) { rows = rows.filter((r) => r[field] === value); return b; },
        then(resolve) { resolve({ data: rows, error: null }); },
      };
      return b;
    },
  };
}
function errSb() {
  return {
    from() {
      const b = { select: () => b, eq: () => b, then: (res) => res({ data: null, error: { message: "boom" } }) };
      return b;
    },
  };
}

const ORDERS = [
  { company_id: "c1", status: "net_open", total: 100 },
  { company_id: "c1", status: "net_open", total: 50 },
  { company_id: "c1", status: "net_paid", total: 999 },   // settled — excluded
  { company_id: "c1", status: "paid", total: 999 },        // stripe — excluded
  { company_id: "c1", status: "cancelled", total: 999 },   // excluded
  { company_id: "c2", status: "net_open", total: 7 },      // other company — excluded
];

test("outstanding sums only net_open orders for the company", async () => {
  const s = await companyCreditState(fakeSb(ORDERS), "c1", 1000);
  assert.equal(s.outstanding, 150);
  assert.equal(s.credit_limit, 1000);
  assert.equal(s.available, 850);
  assert.equal(s.unlimited, false);
});

test("null credit_limit => unlimited (no enforcement)", async () => {
  const s = await companyCreditState(fakeSb(ORDERS), "c1", null);
  assert.equal(s.unlimited, true);
  assert.equal(s.credit_limit, null);
  assert.equal(s.available, null);
  assert.equal(s.outstanding, 150);
  assert.equal(exceedsCredit(s, 1e9), false);
});

test("zero credit_limit blocks any NET order", async () => {
  const s = await companyCreditState(fakeSb([]), "c1", 0);
  assert.equal(s.unlimited, false);
  assert.equal(s.outstanding, 0);
  assert.equal(s.available, 0);
  assert.equal(exceedsCredit(s, 0.01), true);
});

test("at-limit allowed, strictly-over blocked", async () => {
  const s = await companyCreditState(fakeSb(ORDERS), "c1", 1000); // outstanding 150
  assert.equal(exceedsCredit(s, 850), false);    // 150+850 == 1000 -> allowed
  assert.equal(exceedsCredit(s, 850.01), true);  // > 1000 -> blocked
});

test("empty orders => zero outstanding, full credit available", async () => {
  const s = await companyCreditState(fakeSb([]), "c1", 500);
  assert.equal(s.outstanding, 0);
  assert.equal(s.available, 500);
});

test("query error throws (caller decides how to fail)", async () => {
  await assert.rejects(() => companyCreditState(errSb(), "c1", 500));
});

test("round2 avoids float drift", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
});
