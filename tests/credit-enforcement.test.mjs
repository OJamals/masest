import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("checkout imports credit helper at the correct depth", () => {
  const src = read("functions/api/checkout.js");
  assert.match(src, /from\s+['"]\.\.\/_lib\/credit\.js['"]/, "checkout.js must import ../_lib/credit.js");
});

test("checkout NET branch delegates credit and ledger writes to place_net_order_v2", () => {
  const src = read("functions/api/checkout.js");
  assert.match(src, /\.rpc\(\s*['"]place_net_order_v2['"]/, "must call the complete NET ledger RPC");
  assert.match(src, /credit_limit_exceeded/, "must return the credit_limit_exceeded error");
  assert.match(src, /net_order_unavailable/, "must 503 when the v2 RPC is unavailable");
  // company select must load credit_limit
  assert.match(src, /select\('id,status,net_terms_days,credit_limit'\)/, "net company select must include credit_limit");
  assert.doesNotMatch(src, /from\(['"]orders['"]\)\.insert/, "Worker must not insert NET order headers");
  assert.doesNotMatch(src, /from\(['"]order_items['"]\)\.insert/, "Worker must not insert NET order items");
});

test("account/me imports credit helper at the correct depth and returns a credit block", () => {
  const src = read("functions/api/account/me.js");
  assert.match(src, /from\s+['"]\.\.\/\.\.\/_lib\/credit\.js['"]/, "me.js must import ../../_lib/credit.js");
  assert.match(src, /companyCreditState\(/, "me.js must compute credit state");
  assert.match(src, /net_outstanding/, "me.js must expose net_outstanding");
  assert.match(src, /credit_available/, "me.js must expose credit_available");
});

test("dashboard renders balance owed + credit available from ACCOUNT.credit", () => {
  const js = read("js/dashboard.js");
  assert.match(js, /ACCOUNT\??\.credit/, "dashboard must read ACCOUNT.credit");
  assert.match(js, /Balance owed/, "dashboard must label the outstanding balance");
  assert.match(js, /Credit available/, "dashboard must label available credit");
});

test("cart surfaces a credit_limit_exceeded buyer message", () => {
  const html = read("cart.html");
  assert.match(html, /credit_limit_exceeded/, "cart must handle the credit_limit_exceeded code");
  assert.match(html, /available credit/i, "cart message must mention available credit");
});
