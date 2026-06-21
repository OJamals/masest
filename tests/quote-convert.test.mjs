import assert from "node:assert/strict";
import test from "node:test";
import { cleanConvertItem, buildConvertItems, netOrderRow } from "../functions/_lib/quote-convert.js";

// Pins the item-cleaning + NET-order shape extracted from the admin
// "convert a quote/lead into a NET order" action (functions/api/admin/quotes.js).
// Behavior must match the inline loop exactly, including: qty clamped to >= 1,
// price finite and >= 0, sku required, line_total to 2dp, and an EMPTY item
// list rejected as invalid_item (no zero-line orders).

test("cleanConvertItem normalizes a valid line", () => {
  assert.deepEqual(cleanConvertItem({ sku: " VK-HCR-5 ", name: " HCR 5gal ", qty: "3", unit_price: 12.5 }), {
    sku: "VK-HCR-5",
    product_sku: "VK-HCR-5",
    name: "HCR 5gal",
    qty: 3,
    unit_price: 12.5,
    line_total: 37.5,
  });
});

test("cleanConvertItem clamps qty to at least 1 and defaults name to sku", () => {
  assert.deepEqual(cleanConvertItem({ sku: "X", qty: 0, unit_price: 10 }), {
    sku: "X", product_sku: "X", name: "X", qty: 1, unit_price: 10, line_total: 10,
  });
  assert.equal(cleanConvertItem({ sku: "X", qty: -4, unit_price: 10 }).qty, 1);
});

test("cleanConvertItem rounds line_total to 2 decimals", () => {
  assert.equal(cleanConvertItem({ sku: "X", qty: 3, unit_price: 0.1 }).line_total, 0.3);
});

test("cleanConvertItem returns null for invalid lines", () => {
  assert.equal(cleanConvertItem({ sku: "", unit_price: 10 }), null);
  assert.equal(cleanConvertItem({ sku: "X", unit_price: -1 }), null);
  assert.equal(cleanConvertItem({ sku: "X", unit_price: "abc" }), null);
  assert.equal(cleanConvertItem({ sku: "  ", unit_price: 5 }), null);
});

test("buildConvertItems sums subtotal across clean lines", () => {
  const out = buildConvertItems([
    { sku: "A", qty: 2, unit_price: 5 },
    { sku: "B", qty: 1, unit_price: 3.33 },
  ]);
  assert.deepEqual(out.items.map((i) => i.line_total), [10, 3.33]);
  assert.equal(out.subtotal, 13.33);
});

test("buildConvertItems rejects any invalid line with invalid_item", () => {
  assert.deepEqual(buildConvertItems([{ sku: "A", qty: 1, unit_price: 5 }, { sku: "", unit_price: 9 }]), {
    error: "invalid_item",
  });
});

test("buildConvertItems rejects an empty or non-array list with invalid_item", () => {
  assert.deepEqual(buildConvertItems([]), { error: "invalid_item" });
  assert.deepEqual(buildConvertItems(undefined), { error: "invalid_item" });
});

test("netOrderRow builds a NET invoice order shape", () => {
  assert.deepEqual(netOrderRow("co-123", 49.99), {
    company_id: "co-123",
    status: "net_open",
    payment_method: "net",
    subtotal: 49.99,
    total: 49.99,
    currency: "usd",
  });
});
