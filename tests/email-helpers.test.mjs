import assert from "node:assert/strict";
import test from "node:test";
import { filterSuppressed } from "../functions/_lib/email.js";

test("filterSuppressed drops suppressed addresses, case-insensitive", () => {
  const out = filterSuppressed(["A@x.com", "keep@x.com"], new Set(["a@x.com"]));
  assert.deepEqual(out, ["keep@x.com"]);
});

test("filterSuppressed returns all when suppression set empty", () => {
  assert.deepEqual(filterSuppressed(["a@x.com"], new Set()), ["a@x.com"]);
});
