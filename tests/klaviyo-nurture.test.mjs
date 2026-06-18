import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("newsletter.js subscribes via the shared helper, not an inline job payload", () => {
  const src = read("functions/api/newsletter.js");
  assert.match(src, /from\s+['"]\.\.\/_lib\/klaviyo\.js['"]/, "must import ../_lib/klaviyo.js");
  assert.match(src, /klaviyoSubscribe\(/, "must call klaviyoSubscribe");
  assert.doesNotMatch(src, /profile-subscription-bulk-create-job/, "inline bulk-job payload should move into the helper");
  // contract preserved
  assert.match(src, /newsletter_not_configured/);
  assert.match(src, /klaviyo_error/);
});
