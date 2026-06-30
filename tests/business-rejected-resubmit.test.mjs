import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync(new URL("../functions/api/account/company.js", import.meta.url), "utf8");

// A rejected business that edits + resubmits ("Update & resubmit") must re-enter the admin
// verification queue. Before this guard, the update branch never reset status, so the company
// stayed 'rejected' forever, never reappeared in the admin pending queue, and the buyer was stuck.
test("rejected business resubmission re-enters the verification queue", () => {
  // The update branch reads the current status before writing.
  assert.match(src, /\.from\('companies'\)\s*\.select\('status'\)\.eq\('id', profile\.company_id\)/);
  // Only rejected -> pending; approved/pending companies are never disturbed.
  assert.match(src, /current\?\.status === 'rejected'/);
  assert.match(src, /patch\.status = 'pending'/);
  assert.match(src, /patch\.submitted_at = new Date\(\)\.toISOString\(\)/);
  // status is a base column — the pre-migration fallback carries the re-entry too.
  assert.match(src, /basePatch\.status = patch\.status/);
});

test("resubmission re-entry is scoped to the update branch, not creation", () => {
  // Creation already starts at pending; the new logic must sit after the create branch returns.
  const createIdx = src.indexOf("business_pending_approval: true");
  const reentryIdx = src.indexOf("current?.status === 'rejected'");
  assert.ok(createIdx > -1 && reentryIdx > createIdx, "re-entry logic belongs in the update branch");
});
