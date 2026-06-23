import assert from "node:assert/strict";
import test from "node:test";
import { parseInventoryRows } from "../functions/_lib/inventory.js";

test("parses vsku,stock rows, skips header + blanks", () => {
  const { rows, errors } = parseInventoryRows("vsku,stock\nVK-1,120\n\nVK-2,0\n");
  assert.deepEqual(rows, [{ vsku: "VK-1", stock: 120 }, { vsku: "VK-2", stock: 0 }]);
  assert.deepEqual(errors, []);
});

test("a first data row that is numeric is NOT treated as a header", () => {
  const { rows } = parseInventoryRows("VK-1,5");
  assert.deepEqual(rows, [{ vsku: "VK-1", stock: 5 }]);
});

test("rejects non-integer, negative, and missing stock; keeps good rows", () => {
  const { rows, errors } = parseInventoryRows("VK-1,12\nVK-2,-3\nVK-3,abc\nVK-4,\n,9");
  assert.deepEqual(rows, [{ vsku: "VK-1", stock: 12 }]);
  assert.deepEqual(errors.map((e) => e.reason), ["invalid_stock", "invalid_stock", "invalid_stock", "missing_vsku"]);
});

test("strips quotes and whitespace", () => {
  const { rows } = parseInventoryRows('  "VK-9" , "42" ');
  assert.deepEqual(rows, [{ vsku: "VK-9", stock: 42 }]);
});
