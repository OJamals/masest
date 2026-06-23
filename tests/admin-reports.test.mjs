import assert from "node:assert/strict";
import test from "node:test";
import { toCsv, revenueReport, parseRange } from "../functions/_lib/reports.js";

test("toCsv quotes fields, escapes quotes, CRLF rows", () => {
  assert.equal(toCsv([["a", 'b"c'], [1, null]]), '"a","b""c"\r\n"1",""');
});

test("revenueReport sums only paid statuses; counts all", () => {
  const r = revenueReport([
    { status: "paid", total: 100, tax: 8, payment_method: "stripe" },
    { status: "net_paid", total: 50, tax: 4, payment_method: "net" },
    { status: "cancelled", total: 999, tax: 80, payment_method: "stripe" },
    { status: "net_open", total: 30, tax: 0, payment_method: "net" },
  ]);
  assert.equal(r.orders, 4);
  assert.equal(r.paid_orders, 2);
  assert.equal(r.revenue, 150);
  assert.equal(r.tax, 12);
  assert.equal(r.average_order_value, 75);
  assert.deepEqual(r.by_status, { paid: 1, net_paid: 1, cancelled: 1, net_open: 1 });
  assert.deepEqual(r.by_payment, { stripe: 2, net: 2 });
});

test("revenueReport handles empty set without dividing by zero", () => {
  const r = revenueReport([]);
  assert.equal(r.revenue, 0);
  assert.equal(r.average_order_value, 0);
});

test("parseRange: bare date 'to' is end-of-day inclusive; invalid -> null", () => {
  const { fromIso, toIso } = parseRange("2026-01-01", "2026-01-31");
  assert.equal(fromIso, "2026-01-01T00:00:00.000Z");
  assert.equal(toIso, "2026-01-31T23:59:59.999Z");
  assert.deepEqual(parseRange(null, "garbage"), { fromIso: null, toIso: null });
});
