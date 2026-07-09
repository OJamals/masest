import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProduct } from "../functions/api/admin/products.js";

const base = { sku: "cr" };

test("hazmat/taxable accept the common truthy forms", () => {
  for (const v of [true, "true", "on", "1", "yes", 1, "TRUE", "Yes"]) {
    assert.equal(normalizeProduct({ ...base, hazmat: v }).row.hazmat, true, `truthy: ${JSON.stringify(v)}`);
  }
});

test("hazmat/taxable accept the common falsy forms", () => {
  for (const v of [false, "false", "off", "0", "no", 0, ""]) {
    assert.equal(normalizeProduct({ ...base, taxable: v }).row.taxable, false, `falsy: ${JSON.stringify(v)}`);
  }
});

test("ambiguous hazmat/taxable is REJECTED, never silently dropped to false", () => {
  assert.deepEqual(normalizeProduct({ ...base, hazmat: "maybe" }), { error: "invalid_hazmat" });
  assert.deepEqual(normalizeProduct({ ...base, taxable: "2" }), { error: "invalid_taxable" });
  assert.deepEqual(normalizeProduct({ ...base, hazmat: {} }), { error: "invalid_hazmat" });
});

test("omitted flags are left untouched (not defaulted)", () => {
  const { row } = normalizeProduct({ ...base, name: "CR" });
  assert.equal("hazmat" in row, false);
  assert.equal("taxable" in row, false);
});

test("sort coerces to int or null; a float is rejected", () => {
  assert.equal(normalizeProduct({ ...base, sort: "3" }).row.sort, 3);
  assert.equal(normalizeProduct({ ...base, sort: "" }).row.sort, null);
  assert.deepEqual(normalizeProduct({ ...base, sort: "1.5" }), { error: "invalid_sort" });
});
