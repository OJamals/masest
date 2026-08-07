import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

// Online checkout is card/ACH only. NET orders are raised by staff from an accepted quote
// (functions/api/admin/quotes.js), so no credit decision may live on the public endpoint —
// a credit check there would be a self-serve NET path by another name.
test("checkout runs no credit decision and places no NET order", () => {
  const src = read("functions/api/checkout.js");
  assert.doesNotMatch(src, /_lib\/credit\.js/, "checkout.js must not import the credit helper");
  assert.doesNotMatch(src, /place_net_order/, "checkout.js must not call any NET ledger RPC");
  assert.doesNotMatch(src, /credit_limit/, "checkout.js must not read or enforce a credit limit");
  assert.doesNotMatch(src, /from\(['"]orders['"]\)\.insert/, "Worker must not insert order headers");
  assert.doesNotMatch(src, /from\(['"]order_items['"]\)\.insert/, "Worker must not insert order items");
});

test("checkout refuses an on-account mode instead of charging the card", () => {
  const src = read("functions/api/checkout.js");
  assert.match(src, /body\.mode\s*!==\s*'pay'/, "any mode other than 'pay' must be rejected outright");
  assert.match(src, /net_checkout_unavailable/, "the refusal must name the unsupported on-account mode");
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

test("checkout tells a buyer where on-account ordering actually happens", () => {
  const checkout = read("js/checkout.js");
  assert.doesNotMatch(checkout, /credit_limit_exceeded/, "the storefront can no longer receive a credit verdict");
  assert.match(checkout, /net_checkout_unavailable/, "checkout must map the on-account refusal");
  assert.match(checkout, /account team/i, "the message must route the buyer to the account team");
});
