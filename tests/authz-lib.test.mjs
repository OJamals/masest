import assert from "node:assert/strict";
import test from "node:test";
import { parseAdminEmails, isStaffEmail } from "../functions/_lib/authz.js";

// Pins the platform-staff allow-list decision extracted from requireStaff()
// (functions/_lib/supabase.js) so it can be unit-tested without a live auth
// round-trip. ADMIN_EMAILS is authoritative; ADMIN_EMAIL is a single-value
// fallback; matching is comma-split, trimmed, lowercased, de-duped.

test("parseAdminEmails splits, trims, lowercases, drops blanks, dedupes", () => {
  assert.deepEqual(
    parseAdminEmails({ ADMIN_EMAILS: "A@x.com, b@Y.com ,, a@x.com " }),
    ["a@x.com", "b@y.com"],
  );
});

test("parseAdminEmails falls back to ADMIN_EMAIL when ADMIN_EMAILS is blank", () => {
  assert.deepEqual(parseAdminEmails({ ADMIN_EMAIL: "Solo@Z.com" }), ["solo@z.com"]);
  // ADMIN_EMAILS wins when both present
  assert.deepEqual(
    parseAdminEmails({ ADMIN_EMAILS: "list@x.com", ADMIN_EMAIL: "solo@z.com" }),
    ["list@x.com"],
  );
});

test("parseAdminEmails returns [] for missing/empty env", () => {
  assert.deepEqual(parseAdminEmails({}), []);
  assert.deepEqual(parseAdminEmails(undefined), []);
  assert.deepEqual(parseAdminEmails({ ADMIN_EMAILS: "  ,  , " }), []);
});

test("isStaffEmail matches case-insensitively", () => {
  const env = { ADMIN_EMAILS: "boss@x.com, ops@y.com" };
  assert.equal(isStaffEmail("BOSS@x.com", env), true);
  assert.equal(isStaffEmail("ops@y.com", env), true);
  assert.equal(isStaffEmail("nobody@z.com", env), false);
});

test("isStaffEmail rejects blank/missing email", () => {
  const env = { ADMIN_EMAILS: "boss@x.com" };
  assert.equal(isStaffEmail("", env), false);
  assert.equal(isStaffEmail(null, env), false);
  assert.equal(isStaffEmail(undefined, env), false);
  assert.equal(isStaffEmail("  ", env), false);
});
