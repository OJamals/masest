import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const API = readFileSync(new URL("../functions/api/admin/impersonate.js", import.meta.url), "utf8");
const UI = readFileSync(new URL("../js/admin/companies.js", import.meta.url), "utf8");

// #100 read-only view-as: staff-gated, audited, never a write/takeover.
test("endpoint is staff-gated, audited, read-only, and only reads", () => {
  assert.match(API, /requireStaff/);
  assert.match(API, /if \(!staff\) return json\(403/);
  assert.match(API, /recordAudit\([\s\S]*action: 'admin\.impersonate_view'/);
  assert.match(API, /read_only: true/);
  assert.doesNotMatch(API, /\.(insert|update|delete|upsert)\(/); // no writes as the customer
});

test("companies tab wires a read-only View-as snapshot dialog", () => {
  assert.match(UI, /data-company-view-as/);
  assert.match(UI, /\/api\/admin\/impersonate\?company_id=/);
  assert.match(UI, /detailDialog\(viewAsHtml/);
  assert.match(UI, /Read-only support view/);
});
