import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { internalServerError } from "../functions/_lib/supabase.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Reviewed customer-facing plus support/CMS/CRM responses never expose raw
// provider/database detail. Staff auth is not a safe place to publish schema or
// SQL failures; operational detail belongs in server logs.
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

const STAFF_WORKFLOWS = [
  "functions/api/admin/messages.js",
  "functions/api/admin/content.js",
  "functions/api/admin/content-revisions.js",
  "functions/api/admin/content-assets.js",
  "functions/api/admin/crm/contacts.js",
  "functions/api/admin/crm/notes.js",
  "functions/api/admin/crm/tasks.js",
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

test("admin support, CMS, and CRM endpoints keep internal errors out of responses", () => {
  for (const path of STAFF_WORKFLOWS) {
    const src = read(path);
    assert.doesNotMatch(src, /json\(5\d\d,[\s\S]{0,120}?error:\s*\w+\.message/, `${path} leaks raw internal error detail`);
    assert.doesNotMatch(src, /return\s*\{\s*ok:\s*false,\s*error:\s*\w+\.message/, `${path} leaks raw automation error detail`);
    assert.doesNotMatch(src, /detail:\s*await\s+upload\.text/, `${path} leaks raw storage response detail`);
    assert.match(src, /internalServerError|reportInternalError/, `${path} should log internally and return a stable error code`);
  }
});

test("internalServerError logs scoped detail but returns only a stable client code", async () => {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const response = internalServerError("admin.crm.contacts", new Error("relation private_contacts does not exist"));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "server_error" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    console.error = original;
  }
  assert.match(logged.join("\n"), /admin\.crm\.contacts/);
  assert.match(logged.join("\n"), /private_contacts/);
});
