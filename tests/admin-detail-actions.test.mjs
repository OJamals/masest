import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync(new URL("../js/admin.js", import.meta.url), "utf8");

test("company detail panel exposes direct action buttons", () => {
  assert.match(src, /company-detail-actions/, "detail actions should be grouped for scanning");
  assert.match(src, /data-company-detail-action="approve"/, "detail panel should approve one company");
  assert.match(src, /data-company-detail-action="suspend"/, "detail panel should suspend one company");
  assert.match(src, /data-company-detail-tab="messages"/, "detail panel should jump to company messages");
  assert.match(src, /data-company-detail-tab="orders"/, "detail panel should jump to company orders");
  assert.match(src, /wireCompanyDetailActions\(/, "detail action buttons should be wired after render");
});
