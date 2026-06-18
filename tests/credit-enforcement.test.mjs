import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("checkout imports credit helper at the correct depth", () => {
  const src = read("functions/api/checkout.js");
  assert.match(src, /from\s+['"]\.\.\/_lib\/credit\.js['"]/, "checkout.js must import ../_lib/credit.js");
});

test("checkout net branch enforces credit before inserting the order", () => {
  const src = read("functions/api/checkout.js");
  assert.match(src, /companyCreditState\(/, "must compute credit state");
  assert.match(src, /exceedsCredit\(/, "must test the over-limit predicate");
  assert.match(src, /credit_limit_exceeded/, "must return the credit_limit_exceeded error");
  assert.match(src, /credit_check_unavailable/, "must 503 on a credit query error");
  // company select must load credit_limit
  assert.match(src, /select\('id,status,net_terms_days,credit_limit'\)/, "net company select must include credit_limit");
  // enforcement must run BEFORE the order insert
  const checkIdx = src.indexOf("credit_limit_exceeded");
  const insertIdx = src.indexOf("from('orders').insert");
  assert.ok(checkIdx > -1 && insertIdx > -1 && checkIdx < insertIdx,
    "credit check must precede the order insert");
});

test("account/me imports credit helper at the correct depth and returns a credit block", () => {
  const src = read("functions/api/account/me.js");
  assert.match(src, /from\s+['"]\.\.\/\.\.\/_lib\/credit\.js['"]/, "me.js must import ../../_lib/credit.js");
  assert.match(src, /companyCreditState\(/, "me.js must compute credit state");
  assert.match(src, /net_outstanding/, "me.js must expose net_outstanding");
  assert.match(src, /credit_available/, "me.js must expose credit_available");
});
