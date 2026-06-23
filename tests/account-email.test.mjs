import assert from "node:assert/strict";
import test from "node:test";
import { isValidEmail } from "../functions/api/account/me.js";

// Email-change is a trust boundary: reject malformed input before handing to Supabase.
test("isValidEmail accepts plausible addresses, rejects malformed", () => {
  for (const ok of ["a@b.co", "user.name+tag@sub.example.com", "  X@Y.COM  "]) {
    assert.equal(isValidEmail(ok), true, ok);
  }
  for (const bad of ["", "no-at", "a@b", "a@ b.co", "a b@c.co", "@b.co", "a@.co", null, undefined]) {
    assert.equal(isValidEmail(bad), false, String(bad));
  }
});
