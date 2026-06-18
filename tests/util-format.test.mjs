import assert from "node:assert/strict";
import test from "node:test";
import { esc, money, fmtDate, fmtDT, dateTime } from "../js/util.js";

test("esc escapes HTML-significant characters", () => {
  assert.equal(esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(42), "42");
});

test("money formats currency uppercase with 2 decimals", () => {
  assert.equal(money(1234.5), "USD 1234.50");
  assert.equal(money(10, "usd"), "USD 10.00");
  assert.equal(money(null), "USD 0.00");
  assert.equal(money(5, "eur"), "EUR 5.00");
});

test("date helpers never throw on bad input", () => {
  assert.doesNotThrow(() => fmtDate("not-a-date"));
  assert.doesNotThrow(() => fmtDT(""));
  assert.equal(dateTime(""), "");
  assert.equal(dateTime(null), "");
});
