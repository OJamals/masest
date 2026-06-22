import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Customer-facing endpoints (public + account/*) must not leak raw DB error
// messages to untrusted callers — they return a generic code instead. Admin/*
// endpoints are staff-only and intentionally keep detail for debugging.
const CUSTOMER_FACING = [
  "functions/api/checkout.js",
  "functions/api/products.js",
  "functions/api/account/orders.js",
  "functions/api/account/order.js",
  "functions/api/account/profile.js",
  "functions/api/account/messages.js",
  "functions/api/account/notifications.js",
  "functions/api/account/addresses.js",
  "functions/api/account/team.js",
  "functions/api/account/register.js",
];

test("customer-facing endpoints do not return any raw DB error.message on 5xx", () => {
  for (const path of CUSTOMER_FACING) {
    const src = read(path);
    // Catch the raw-message leak whatever the error variable is named (error/jErr/coErr/...).
    assert.doesNotMatch(src, /json\(5\d\d,\s*\{\s*error:\s*\w+\.message/, `${path} leaks raw DB error to client`);
  }
});

test("customer-facing endpoints use a generic server_error code", () => {
  for (const path of CUSTOMER_FACING) {
    const src = read(path);
    if (/json\(500,/.test(src)) {
      assert.match(src, /error:\s*'server_error'/, `${path} should return generic server_error`);
    }
  }
});
